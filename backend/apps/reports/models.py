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
    - CRM
    - Продажи
    - Счета
    - Активности
    - Сотрудники
    - Конверсии
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


class ReportData(BaseModel):
    """
    Готовое рассчитанное значение отчета.

    Одна запись = значение одной метрики по одному источнику за один период.

    Например:
    Портал: company.bitrix24.ru
    Источник: Сделки / Продажи
    Метрика: Сумма успешных сделок
    Период: май 2026
    Значение: 850000
    """

    class PeriodKey(models.TextChoices):
        HOURS = "hours", "Часы"
        DAYS = "days", "Дни"
        WEEKS = "weeks", "Недели"
        MONTHS = "months", "Месяцы"
        QUARTERS = "quarters", "Кварталы"
        YEARS = "years", "Годы"

    portal = models.ForeignKey(
        BitrixPortal,
        on_delete=models.CASCADE,
        related_name="report_data",
        verbose_name="Портал",
    )
    source = models.ForeignKey(
        CrmSource,
        on_delete=models.CASCADE,
        related_name="report_data",
        verbose_name="Источник",
    )
    metric = models.ForeignKey(
        Metric,
        on_delete=models.PROTECT,
        related_name="report_data",
        verbose_name="Метрика",
    )

    period_key = models.CharField(
        max_length=30,
        choices=PeriodKey.choices,
        db_index=True,
        verbose_name="Тип периода",
    )
    period_start = models.DateTimeField(
        db_index=True,
        verbose_name="Начало периода",
    )
    period_end = models.DateTimeField(
        db_index=True,
        verbose_name="Конец периода",
    )

    metric_value = models.DecimalField(
        max_digits=24,
        decimal_places=4,
        default=0,
        verbose_name="Значение метрики",
    )
    currency = models.CharField(
        max_length=10,
        blank=True,
        db_index=True,
        verbose_name="Валюта",
    )

    calculated_at = models.DateTimeField(
        default=timezone.now,
        db_index=True,
        verbose_name="Дата расчета",
    )

    sync_run = models.ForeignKey(
        SyncRun,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="report_data",
        verbose_name="Синхронизация",
    )

    metadata = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Дополнительные данные",
    )

    class Meta:
        verbose_name = "Данные отчета"
        verbose_name_plural = "Данные отчетов"
        ordering = ["portal", "source", "metric", "period_start"]
        constraints = [
            models.UniqueConstraint(
                fields=[
                    "portal",
                    "source",
                    "metric",
                    "period_key",
                    "period_start",
                    "period_end",
                ],
                name="unique_report_data_period_value",
            ),
        ]
        indexes = [
            models.Index(fields=["portal", "period_key", "period_start", "period_end"]),
            models.Index(fields=["portal", "source", "metric"]),
            models.Index(fields=["portal", "metric", "period_start"]),
            models.Index(fields=["source", "period_start"]),
            models.Index(fields=["calculated_at"]),
        ]

    def __str__(self):
        return (
            f"{self.portal.domain} — {self.source.title} — "
            f"{self.metric.label} — {self.period_start:%Y-%m-%d}"
        )


class MetricDetail(BaseModel):
    """
    Детализация значения метрики.

    Одна запись = конкретная сущность Битрикс24,
    которая попала в расчет метрики.

    Например:
    если метрика — 'Сумма оплаченных счетов',
    то здесь будут конкретные счета, которые попали в эту сумму.
    """

    class EntityType(models.TextChoices):
        LEAD = "lead", "Лид"
        DEAL = "deal", "Сделка"
        SMART_PROCESS = "smart_process", "Смарт-процесс"
        INVOICE = "invoice", "Счет"
        TASK = "task", "Задача"
        CALL = "call", "Звонок"
        OTHER = "other", "Другое"

    portal = models.ForeignKey(
        BitrixPortal,
        on_delete=models.CASCADE,
        related_name="metric_details",
        verbose_name="Портал",
    )
    source = models.ForeignKey(
        CrmSource,
        on_delete=models.CASCADE,
        related_name="metric_details",
        verbose_name="Источник",
    )
    metric = models.ForeignKey(
        Metric,
        on_delete=models.PROTECT,
        related_name="details",
        verbose_name="Метрика",
    )

    period_key = models.CharField(
        max_length=30,
        choices=ReportData.PeriodKey.choices,
        db_index=True,
        verbose_name="Тип периода",
    )
    period_start = models.DateTimeField(
        db_index=True,
        verbose_name="Начало периода",
    )
    period_end = models.DateTimeField(
        db_index=True,
        verbose_name="Конец периода",
    )

    entity_type = models.CharField(
        max_length=50,
        choices=EntityType.choices,
        db_index=True,
        verbose_name="Тип сущности",
    )
    entity_id = models.CharField(
        max_length=100,
        db_index=True,
        verbose_name="ID сущности в Битрикс24",
    )
    entity_title = models.CharField(
        max_length=500,
        blank=True,
        verbose_name="Название сущности",
    )
    entity_url = models.URLField(
        max_length=700,
        blank=True,
        verbose_name="Ссылка на сущность в Битрикс24",
    )

    responsible = models.ForeignKey(
        PortalUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="metric_details",
        verbose_name="Ответственный",
    )
    responsible_bitrix_user_id = models.CharField(
        max_length=100,
        blank=True,
        db_index=True,
        verbose_name="ID ответственного в Битрикс24",
    )
    responsible_name = models.CharField(
        max_length=350,
        blank=True,
        verbose_name="Имя ответственного",
    )

    amount = models.DecimalField(
        max_digits=24,
        decimal_places=4,
        null=True,
        blank=True,
        verbose_name="Сумма",
    )
    currency = models.CharField(
        max_length=10,
        blank=True,
        db_index=True,
        verbose_name="Валюта",
    )

    status = models.CharField(
        max_length=100,
        blank=True,
        db_index=True,
        verbose_name="Статус",
    )
    stage_id = models.CharField(
        max_length=100,
        blank=True,
        db_index=True,
        verbose_name="Стадия",
    )
    category_id = models.IntegerField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Категория / воронка",
    )

    created_at_bitrix = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Дата создания в Битрикс24",
    )
    closed_at_bitrix = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Дата закрытия в Битрикс24",
    )
    updated_at_bitrix = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Дата обновления в Битрикс24",
    )

    sync_run = models.ForeignKey(
        SyncRun,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="metric_details",
        verbose_name="Синхронизация",
    )

    raw_data = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Исходные данные сущности",
    )

    class Meta:
        verbose_name = "Детализация метрики"
        verbose_name_plural = "Детализация метрик"
        ordering = ["-period_start", "entity_type", "entity_id"]
        constraints = [
            models.UniqueConstraint(
                fields=[
                    "portal",
                    "source",
                    "metric",
                    "period_key",
                    "period_start",
                    "period_end",
                    "entity_type",
                    "entity_id",
                ],
                name="unique_metric_detail_entity",
            ),
        ]
        indexes = [
            models.Index(fields=["portal", "source", "metric"]),
            models.Index(fields=["portal", "period_key", "period_start"]),
            models.Index(fields=["portal", "entity_type", "entity_id"]),
            models.Index(fields=["portal", "responsible_bitrix_user_id"]),
            models.Index(fields=["portal", "status"]),
            models.Index(fields=["created_at_bitrix"]),
            models.Index(fields=["closed_at_bitrix"]),
        ]

    def __str__(self):
        return f"{self.metric.label} — {self.entity_type} #{self.entity_id}"


class EmployeeMetric(BaseModel):
    """
    Готовое значение метрики по сотруднику.

    Одна запись = значение одной метрики по одному сотруднику за один период.

    Например:
    Иван Петров — Сумма успешных сделок — май 2026 — 450000.
    """

    portal = models.ForeignKey(
        BitrixPortal,
        on_delete=models.CASCADE,
        related_name="employee_metrics",
        verbose_name="Портал",
    )
    source = models.ForeignKey(
        CrmSource,
        on_delete=models.CASCADE,
        related_name="employee_metrics",
        verbose_name="Источник",
    )
    metric = models.ForeignKey(
        Metric,
        on_delete=models.PROTECT,
        related_name="employee_metrics",
        verbose_name="Метрика",
    )

    period_key = models.CharField(
        max_length=30,
        choices=ReportData.PeriodKey.choices,
        db_index=True,
        verbose_name="Тип периода",
    )
    period_start = models.DateTimeField(
        db_index=True,
        verbose_name="Начало периода",
    )
    period_end = models.DateTimeField(
        db_index=True,
        verbose_name="Конец периода",
    )

    user = models.ForeignKey(
        PortalUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="employee_metrics",
        verbose_name="Сотрудник",
    )
    bitrix_user_id = models.CharField(
        max_length=100,
        db_index=True,
        verbose_name="ID сотрудника в Битрикс24",
    )
    user_name = models.CharField(
        max_length=350,
        blank=True,
        verbose_name="Имя сотрудника",
    )
    avatar_url = models.URLField(
        max_length=500,
        blank=True,
        verbose_name="Аватар",
    )

    metric_value = models.DecimalField(
        max_digits=24,
        decimal_places=4,
        default=0,
        verbose_name="Значение метрики",
    )
    currency = models.CharField(
        max_length=10,
        blank=True,
        db_index=True,
        verbose_name="Валюта",
    )

    calculated_at = models.DateTimeField(
        default=timezone.now,
        db_index=True,
        verbose_name="Дата расчета",
    )

    sync_run = models.ForeignKey(
        SyncRun,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="employee_metrics",
        verbose_name="Синхронизация",
    )

    metadata = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Дополнительные данные",
    )

    class Meta:
        verbose_name = "Метрика сотрудника"
        verbose_name_plural = "Метрики сотрудников"
        ordering = ["portal", "source", "metric", "period_start", "user_name"]
        constraints = [
            models.UniqueConstraint(
                fields=[
                    "portal",
                    "source",
                    "metric",
                    "period_key",
                    "period_start",
                    "period_end",
                    "bitrix_user_id",
                ],
                name="unique_employee_metric_period_value",
            ),
        ]
        indexes = [
            models.Index(fields=["portal", "bitrix_user_id"]),
            models.Index(fields=["portal", "user_name"]),
            models.Index(fields=["portal", "metric", "period_start"]),
            models.Index(fields=["portal", "source", "metric"]),
            models.Index(fields=["period_start", "period_end"]),
        ]

    def __str__(self):
        return f"{self.user_name} — {self.metric.label} — {self.metric_value}"


class ReportPreset(PublicBaseModel, ActiveModel):
    """
    Сохраненная настройка отчета.

    Например:
    пользователь настроил источники, метрики, период, график,
    отображение сотрудников и сохранил это как 'Отчет по продажам'.
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
        help_text="Источники, метрики, период, вид графика, таблица, пороги и другие настройки.",
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

    Нужна для тяжелых отчетов, которые могут строиться в фоне.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Ожидает"
        RUNNING = "running", "Выполняется"
        SUCCESS = "success", "Успешно"
        FAILED = "failed", "Ошибка"
        CANCELED = "canceled", "Отменено"

    portal = models.ForeignKey(
        BitrixPortal,
        on_delete=models.CASCADE,
        related_name="report_builds",
        verbose_name="Портал",
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
        choices=ReportData.PeriodKey.choices,
        db_index=True,
        verbose_name="Тип периода",
    )
    date_from = models.DateTimeField(
        db_index=True,
        verbose_name="Дата с",
    )
    date_to = models.DateTimeField(
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

    result_payload = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Результат",
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
        ]

    def __str__(self):
        return f"{self.portal.domain} — {self.period_key} — {self.status}"
