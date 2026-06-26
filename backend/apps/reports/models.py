import uuid

from django.db import models
from django.utils import timezone

from apps.bitrix.models import BitrixPortal, PortalUser, SyncRun
from apps.common.models import (
    ActiveBaseModel,
    ActiveModel,
    BaseModel,
    PublicBaseModel,
    SortableModel,
)


class PeriodKey(models.TextChoices):
    """
    Период группировки отчета.

    Используется для состояния отчета, сессии отчета и фонового построения.
    """

    HOURS = "hours", "Часы"
    DAYS = "days", "Дни"
    WEEKS = "weeks", "Недели"
    MONTHS = "months", "Месяцы"


class CrmSource(ActiveBaseModel):
    """
    Источник данных для отчета.

    Одна запись = один источник внутри конкретного портала Битрикс24.
    Например:
    - Лиды
    - Сделки / Продажи
    - Сделки / Холодная база
    - Смарт-процесс / Договоры
    - Счета
    """

    class SourceType(models.TextChoices):
        LEAD = "lead", "Лиды"
        DEAL = "deal", "Сделки"
        SMART_PROCESS = "smart_process", "Смарт-процесс"
        INVOICE = "invoice", "Счета"
        TASK = "task", "Задачи"
        CALL = "call", "Звонки"
        ACTIVITY = "activity", "Дела"
        EMAIL = "email", "Письма"
        MESSAGE = "message", "Сообщения"
        COMPANY = "company", "Компании"
        CONTACT = "contact", "Контакты"
        OTHER = "other", "Другое"

    portal = models.ForeignKey(
        BitrixPortal,
        on_delete=models.CASCADE,
        related_name="crm_sources",
        verbose_name="Портал",
    )

    external_key = models.CharField(
        max_length=150,
        db_index=True,
        verbose_name="Внешний ключ источника",
        help_text="Например: lead-default, deal-0, smart-180-0, invoice-default.",
    )
    source_type = models.CharField(
        max_length=50,
        choices=SourceType.choices,
        db_index=True,
        verbose_name="Тип источника",
    )

    entity_type_id = models.IntegerField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Entity Type ID",
        help_text="Используется для смарт-процессов и CRM-сущностей Битрикс24.",
    )
    category_id = models.IntegerField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="ID категории / воронки",
    )

    title = models.CharField(
        max_length=255,
        verbose_name="Название",
    )
    source_label = models.CharField(
        max_length=255,
        blank=True,
        verbose_name="Отображаемое название",
    )

    is_available = models.BooleanField(
        default=True,
        db_index=True,
        verbose_name="Доступен в Битрикс24",
    )

    last_synced_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Дата последней синхронизации",
    )

    raw_data = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Исходные данные источника",
    )

    class Meta:
        verbose_name = "Источник CRM"
        verbose_name_plural = "Источники CRM"
        ordering = ["source_type", "category_id", "title"]
        constraints = [
            models.UniqueConstraint(
                fields=["portal", "external_key"],
                name="unique_crm_source_external_key",
            ),
        ]
        indexes = [
            models.Index(fields=["portal", "source_type"]),
            models.Index(fields=["portal", "is_active"]),
            models.Index(fields=["portal", "is_available"]),
            models.Index(fields=["portal", "entity_type_id", "category_id"]),
        ]

    def __str__(self):
        return f"{self.portal.domain} — {self.source_label or self.title}"


class MetricSection(ActiveBaseModel, SortableModel):
    """
    Раздел метрик.

    Например:
    - Сделки
    - Лиды
    - Счета
    - Звонки
    - Задачи
    - Воронки
    """

    code = models.CharField(
        max_length=100,
        unique=True,
        db_index=True,
        verbose_name="Код раздела",
    )
    label = models.CharField(
        max_length=255,
        verbose_name="Название раздела",
    )
    description = models.TextField(
        blank=True,
        verbose_name="Описание",
    )

    class Meta:
        verbose_name = "Раздел метрик"
        verbose_name_plural = "Разделы метрик"
        ordering = ["sort_order", "label"]

    def __str__(self):
        return self.label


class Metric(ActiveBaseModel, SortableModel):
    """
    Метрика отчета.

    Одна запись = один показатель.
    Например:
    - Количество новых сделок
    - Количество успешных сделок
    - Сумма успешных сделок
    - Количество оплаченных счетов
    - Сумма оплаченных счетов

    Здесь храним справочник метрик, но не рассчитанные значения.
    Рассчитанные значения будут жить временно в Redis/cache.
    """

    class ValueType(models.TextChoices):
        NUMBER = "number", "Число"
        MONEY = "money", "Деньги"
        PERCENT = "percent", "Процент"
        DURATION = "duration", "Длительность"

    code = models.CharField(
        max_length=150,
        unique=True,
        db_index=True,
        verbose_name="Код метрики",
        help_text="Например: deals_created, deals_won_sum, invoices_paid_sum.",
    )
    label = models.CharField(
        max_length=255,
        verbose_name="Название метрики",
    )
    description = models.TextField(
        blank=True,
        verbose_name="Описание",
    )

    section = models.ForeignKey(
        MetricSection,
        on_delete=models.PROTECT,
        related_name="metrics",
        verbose_name="Раздел",
    )

    value_type = models.CharField(
        max_length=30,
        choices=ValueType.choices,
        default=ValueType.NUMBER,
        db_index=True,
        verbose_name="Тип значения",
    )

    calculation_key = models.CharField(
        max_length=150,
        db_index=True,
        verbose_name="Ключ расчета",
        help_text="Ключ, по которому backend выбирает функцию расчета метрики.",
    )

    source_types = models.JSONField(
        default=list,
        blank=True,
        verbose_name="Типы источников",
        help_text="Например: ['deal', 'lead', 'invoice'].",
    )

    is_pro = models.BooleanField(
        default=False,
        db_index=True,
        verbose_name="Только для Pro",
    )

    unit = models.CharField(
        max_length=50,
        blank=True,
        verbose_name="Единица измерения",
        help_text="Например: RUB, %, шт.",
    )

    default_settings = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Настройки по умолчанию",
    )

    class Meta:
        verbose_name = "Метрика"
        verbose_name_plural = "Метрики"
        ordering = ["section__sort_order", "sort_order", "label"]
        indexes = [
            models.Index(fields=["section", "sort_order"]),
            models.Index(fields=["value_type"]),
            models.Index(fields=["is_active", "is_pro"]),
            models.Index(fields=["calculation_key"]),
        ]

    def __str__(self):
        return self.label


class ReportState(PublicBaseModel, ActiveModel):
    """
    Сохраненное состояние отчета.

    Это не результаты отчета.

    Здесь храним только настройки интерфейса:
    - выбранный период;
    - выбранные источники;
    - выбранные метрики;
    - фильтры;
    - состояние таблицы;
    - тип графика;
    - настройки отображения.

    Сохраняется только для Pro / Trial / Manual Pro.
    В Free-версии backend не должен создавать или обновлять эту запись.
    """

    class StateType(models.TextChoices):
        LAST_USED = "last_used", "Последнее состояние"
        CUSTOM = "custom", "Пользовательское состояние"

    portal = models.ForeignKey(
        BitrixPortal,
        on_delete=models.CASCADE,
        related_name="report_states",
        verbose_name="Портал",
    )
    user = models.ForeignKey(
        PortalUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="report_states",
        verbose_name="Пользователь",
    )

    bitrix_user_id = models.CharField(
        max_length=100,
        db_index=True,
        verbose_name="ID пользователя в Битрикс24",
    )
    user_name = models.CharField(
        max_length=350,
        blank=True,
        verbose_name="Имя пользователя",
    )

    state_type = models.CharField(
        max_length=30,
        choices=StateType.choices,
        default=StateType.LAST_USED,
        db_index=True,
        verbose_name="Тип состояния",
    )
    state_key = models.CharField(
        max_length=100,
        default="default",
        db_index=True,
        verbose_name="Ключ состояния",
        help_text="Например: default, sales_report, manager_report.",
    )

    period_key = models.CharField(
        max_length=30,
        choices=PeriodKey.choices,
        default=PeriodKey.MONTHS,
        db_index=True,
        verbose_name="Тип периода",
    )

    state = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Состояние отчета",
        help_text="Фильтры, выбранные метрики, источники, вид графика, настройки таблицы.",
    )

    filters_hash = models.CharField(
        max_length=128,
        blank=True,
        db_index=True,
        verbose_name="Хэш фильтров",
    )

    last_saved_at = models.DateTimeField(
        default=timezone.now,
        db_index=True,
        verbose_name="Дата последнего сохранения",
    )

    class Meta:
        verbose_name = "Состояние отчета"
        verbose_name_plural = "Состояния отчетов"
        ordering = ["portal", "bitrix_user_id", "state_key"]
        constraints = [
            models.UniqueConstraint(
                fields=["portal", "bitrix_user_id", "state_type", "state_key"],
                name="unique_report_state_per_user",
            ),
        ]
        indexes = [
            models.Index(fields=["portal", "bitrix_user_id"]),
            models.Index(fields=["portal", "state_type"]),
            models.Index(fields=["portal", "period_key"]),
            models.Index(fields=["last_saved_at"]),
        ]

    def __str__(self):
        return f"{self.portal.domain} — {self.bitrix_user_id} — {self.state_key}"


class ReportSession(BaseModel):
    """
    Открытая сессия отчета.

    Одна запись = пользователь открыл приложение и работает с отчетом.

    Важно:
    сами результаты отчета здесь не хранятся.
    Здесь хранится только cache_key, по которому backend найдет временные результаты в Redis/cache.

    Когда приложение закрывается и heartbeat прекращается,
    сессия истекает, а временные результаты удаляются из Redis/cache по TTL.
    """

    class Status(models.TextChoices):
        OPENED = "opened", "Открыта"
        ACTIVE = "active", "Активна"
        IDLE = "idle", "Без активности"
        CLOSED = "closed", "Закрыта"
        EXPIRED = "expired", "Истекла"
        ERROR = "error", "Ошибка"

    session_key = models.UUIDField(
        default=uuid.uuid4,
        unique=True,
        editable=False,
        db_index=True,
        verbose_name="Ключ сессии",
    )

    portal = models.ForeignKey(
        BitrixPortal,
        on_delete=models.CASCADE,
        related_name="report_sessions",
        verbose_name="Портал",
    )
    user = models.ForeignKey(
        PortalUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="report_sessions",
        verbose_name="Пользователь",
    )

    bitrix_user_id = models.CharField(
        max_length=100,
        db_index=True,
        verbose_name="ID пользователя в Битрикс24",
    )
    user_name = models.CharField(
        max_length=350,
        blank=True,
        verbose_name="Имя пользователя",
    )

    status = models.CharField(
        max_length=30,
        choices=Status.choices,
        default=Status.OPENED,
        db_index=True,
        verbose_name="Статус",
    )

    period_key = models.CharField(
        max_length=30,
        choices=PeriodKey.choices,
        default=PeriodKey.MONTHS,
        db_index=True,
        verbose_name="Тип периода",
    )

    state_snapshot = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Снимок настроек",
        help_text="Текущие фильтры и настройки сессии на момент расчета.",
    )

    filters_hash = models.CharField(
        max_length=128,
        blank=True,
        db_index=True,
        verbose_name="Хэш фильтров",
    )

    cache_key = models.CharField(
        max_length=500,
        blank=True,
        db_index=True,
        verbose_name="Ключ временных результатов в cache / Redis",
    )

    cache_ttl_seconds = models.PositiveIntegerField(
        default=1800,
        verbose_name="TTL кеша в секундах",
        help_text="По умолчанию 30 минут.",
    )

    opened_at = models.DateTimeField(
        default=timezone.now,
        db_index=True,
        verbose_name="Дата открытия",
    )
    last_activity_at = models.DateTimeField(
        default=timezone.now,
        db_index=True,
        verbose_name="Последняя активность",
    )
    last_calculated_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Последний расчет",
    )
    closed_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Дата закрытия",
    )
    expires_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Дата истечения",
    )

    result_size_bytes = models.PositiveIntegerField(
        default=0,
        verbose_name="Размер временного результата",
    )

    metadata = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Дополнительные данные",
    )
    error_message = models.TextField(
        blank=True,
        verbose_name="Ошибка",
    )

    class Meta:
        verbose_name = "Сессия отчета"
        verbose_name_plural = "Сессии отчетов"
        ordering = ["-opened_at"]
        indexes = [
            models.Index(fields=["portal", "bitrix_user_id"]),
            models.Index(fields=["portal", "status"]),
            models.Index(fields=["status", "expires_at"]),
            models.Index(fields=["last_activity_at"]),
            models.Index(fields=["cache_key"]),
        ]

    def __str__(self):
        return f"{self.portal.domain} — {self.bitrix_user_id} — {self.status}"

    @property
    def is_expired(self):
        if not self.expires_at:
            return False

        return self.expires_at <= timezone.now()

    @property
    def is_open(self):
        return self.status in [self.Status.OPENED, self.Status.ACTIVE, self.Status.IDLE]


class ReportPreset(PublicBaseModel, ActiveModel):
    """
    Сохраненная настройка отчета.

    Например:
    пользователь настроил источники, метрики, период, график,
    отображение таблицы и сохранил это как 'Отчет по продажам'.

    Сохраняется только для Pro / Trial / Manual Pro.
    В Free-версии backend не должен создавать такие записи.
    """

    portal = models.ForeignKey(
        BitrixPortal,
        on_delete=models.CASCADE,
        related_name="report_presets",
        verbose_name="Портал",
    )

    name = models.CharField(
        max_length=255,
        verbose_name="Название",
    )

    settings = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Настройки отчета",
        help_text="Источники, метрики, период, вид графика, таблица, фильтры и другие настройки.",
    )

    is_default = models.BooleanField(
        default=False,
        db_index=True,
        verbose_name="Отчет по умолчанию",
    )

    created_by = models.ForeignKey(
        PortalUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_report_presets",
        verbose_name="Создал",
    )
    created_by_bitrix_user_id = models.CharField(
        max_length=100,
        blank=True,
        db_index=True,
        verbose_name="ID создателя в Битрикс24",
    )
    created_by_name = models.CharField(
        max_length=350,
        blank=True,
        verbose_name="Имя создателя",
    )

    class Meta:
        verbose_name = "Сохраненный отчет"
        verbose_name_plural = "Сохраненные отчеты"
        ordering = ["portal", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["portal", "name"],
                name="unique_report_preset_name_per_portal",
            ),
        ]
        indexes = [
            models.Index(fields=["portal", "is_active"]),
            models.Index(fields=["portal", "is_default"]),
            models.Index(fields=["portal", "created_by_bitrix_user_id"]),
        ]

    def __str__(self):
        return f"{self.portal.domain} — {self.name}"


class ReportBuild(BaseModel):
    """
    История построения отчета.

    Нужна для тяжелых расчетов, которые могут выполняться в фоне.

    Важно:
    результат отчета здесь не сохраняется.
    Если расчет успешен, результат кладется во временный cache / Redis,
    а здесь хранится только cache_key.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Ожидает"
        RUNNING = "running", "Выполняется"
        SUCCESS = "success", "Успешно"
        FAILED = "failed", "Ошибка"
        CANCELED = "canceled", "Отменено"
        EXPIRED = "expired", "Истекло"

    portal = models.ForeignKey(
        BitrixPortal,
        on_delete=models.CASCADE,
        related_name="report_builds",
        verbose_name="Портал",
    )

    session = models.ForeignKey(
        ReportSession,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="builds",
        verbose_name="Сессия отчета",
    )

    requested_by = models.ForeignKey(
        PortalUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="report_builds",
        verbose_name="Запросил",
    )
    requested_by_bitrix_user_id = models.CharField(
        max_length=100,
        blank=True,
        db_index=True,
        verbose_name="ID пользователя Битрикс24",
    )

    period_key = models.CharField(
        max_length=30,
        choices=PeriodKey.choices,
        default=PeriodKey.MONTHS,
        db_index=True,
        verbose_name="Тип периода",
    )
    date_from = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Дата с",
    )
    date_to = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Дата по",
    )

    sources = models.JSONField(
        default=list,
        blank=True,
        verbose_name="Источники",
    )
    metrics = models.JSONField(
        default=list,
        blank=True,
        verbose_name="Метрики",
    )
    options = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Опции отчета",
    )

    filters_hash = models.CharField(
        max_length=128,
        blank=True,
        db_index=True,
        verbose_name="Хэш фильтров",
    )
    cache_key = models.CharField(
        max_length=500,
        blank=True,
        db_index=True,
        verbose_name="Ключ результата в cache / Redis",
    )

    status = models.CharField(
        max_length=30,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
        verbose_name="Статус",
    )

    celery_task_id = models.CharField(
        max_length=255,
        blank=True,
        db_index=True,
        verbose_name="ID фоновой задачи",
    )

    error_message = models.TextField(
        blank=True,
        verbose_name="Ошибка",
    )

    started_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Дата начала",
    )
    finished_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Дата завершения",
    )

    class Meta:
        verbose_name = "Построение отчета"
        verbose_name_plural = "Построения отчетов"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["portal", "status"]),
            models.Index(fields=["portal", "created_at"]),
            models.Index(fields=["period_key", "date_from", "date_to"]),
            models.Index(fields=["celery_task_id"]),
            models.Index(fields=["cache_key"]),
            models.Index(fields=["filters_hash"]),
        ]

    def __str__(self):
        return f"{self.portal.domain} — {self.period_key} — {self.status}"
