from django.db import models
from django.utils import timezone

from apps.common.models import ActiveModel, BaseModel, PublicBaseModel


class BitrixPortal(PublicBaseModel, ActiveModel):
    """
    Портал Битрикс24, на который установлено приложение.

    Одна запись = один клиентский портал Битрикс24.
    Например: company.bitrix24.ru
    """

    class Status(models.TextChoices):
        INSTALLING = "installing", "Устанавливается"
        INSTALLED = "installed", "Установлено"
        ACTIVE = "active", "Активно"
        UNINSTALLED = "uninstalled", "Удалено"
        BLOCKED = "blocked", "Заблокировано"
        ERROR = "error", "Ошибка"

    member_id = models.CharField(
        max_length=100,
        unique=True,
        db_index=True,
        verbose_name="member_id портала",
        help_text="Уникальный идентификатор портала Битрикс24.",
    )
    domain = models.CharField(
        max_length=255,
        db_index=True,
        verbose_name="Домен портала",
        help_text="Например: company.bitrix24.ru",
    )
    protocol = models.CharField(
        max_length=20,
        default="https",
        verbose_name="Протокол",
    )

    client_endpoint = models.URLField(
        max_length=500,
        blank=True,
        verbose_name="Client endpoint",
    )
    server_endpoint = models.URLField(
        max_length=500,
        blank=True,
        verbose_name="Server endpoint",
    )

    status = models.CharField(
        max_length=30,
        choices=Status.choices,
        default=Status.INSTALLING,
        db_index=True,
        verbose_name="Статус установки",
    )

    installed_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Дата установки",
    )
    uninstalled_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Дата удаления приложения",
    )
    last_opened_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Последнее открытие приложения",
    )

    installed_by_user_id = models.CharField(
        max_length=100,
        blank=True,
        verbose_name="ID пользователя, установившего приложение",
    )
    installed_by_user_name = models.CharField(
        max_length=255,
        blank=True,
        verbose_name="Имя пользователя, установившего приложение",
    )

    language = models.CharField(
        max_length=10,
        blank=True,
        verbose_name="Язык портала",
    )
    timezone = models.CharField(
        max_length=100,
        blank=True,
        verbose_name="Часовой пояс портала",
    )

    application_token_encrypted = models.TextField(
        blank=True,
        verbose_name="Application token",
        help_text="Хранить только в зашифрованном виде.",
    )

    raw_install_payload = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Исходные данные установки",
    )

    class Meta:
        verbose_name = "Портал Битрикс24"
        verbose_name_plural = "Порталы Битрикс24"
        ordering = ["domain"]
        indexes = [
            models.Index(fields=["member_id"]),
            models.Index(fields=["domain"]),
            models.Index(fields=["status"]),
            models.Index(fields=["is_active"]),
        ]

    def __str__(self):
        return f"{self.domain} ({self.member_id})"

    @property
    def base_url(self):
        return f"{self.protocol}://{self.domain}"


class BitrixAuthToken(BaseModel):
    """
    OAuth-токены портала Битрикс24.

    Нужны backend, чтобы обращаться к REST API Битрикс24:
    получать сделки, лиды, счета, сотрудников, воронки и смарт-процессы.
    """

    portal = models.OneToOneField(
        BitrixPortal,
        on_delete=models.CASCADE,
        related_name="auth_token",
        verbose_name="Портал",
    )

    access_token_encrypted = models.TextField(
        verbose_name="Access token",
        help_text="Хранить только в зашифрованном виде.",
    )
    refresh_token_encrypted = models.TextField(
        verbose_name="Refresh token",
        help_text="Хранить только в зашифрованном виде.",
    )

    expires_at = models.DateTimeField(
        db_index=True,
        verbose_name="Access token действует до",
    )
    last_refresh_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Дата последнего обновления токена",
    )

    scope = models.TextField(
        blank=True,
        verbose_name="Права доступа",
    )
    token_type = models.CharField(
        max_length=50,
        default="Bearer",
        verbose_name="Тип токена",
    )

    auth_user_id = models.CharField(
        max_length=100,
        blank=True,
        db_index=True,
        verbose_name="ID пользователя авторизации",
    )
    auth_user_name = models.CharField(
        max_length=255,
        blank=True,
        verbose_name="Имя пользователя авторизации",
    )

    raw_auth_payload = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Исходные данные авторизации",
    )

    class Meta:
        verbose_name = "OAuth-токен Битрикс24"
        verbose_name_plural = "OAuth-токены Битрикс24"
        indexes = [
            models.Index(fields=["expires_at"]),
            models.Index(fields=["auth_user_id"]),
        ]

    def __str__(self):
        return f"Токен для {self.portal.domain}"

    @property
    def is_expired(self):
        return self.expires_at <= timezone.now()


class PortalUser(BaseModel, ActiveModel):
    """
    Сотрудник портала Битрикс24.

    Нужен для отчетов по ответственным:
    сделки по сотрудникам, суммы по менеджерам, активности, счета.
    """

    portal = models.ForeignKey(
        BitrixPortal,
        on_delete=models.CASCADE,
        related_name="users",
        verbose_name="Портал",
    )

    bitrix_user_id = models.CharField(
        max_length=100,
        db_index=True,
        verbose_name="ID пользователя в Битрикс24",
    )

    name = models.CharField(
        max_length=150,
        blank=True,
        verbose_name="Имя",
    )
    last_name = models.CharField(
        max_length=150,
        blank=True,
        verbose_name="Фамилия",
    )
    second_name = models.CharField(
        max_length=150,
        blank=True,
        verbose_name="Отчество",
    )
    full_name = models.CharField(
        max_length=350,
        blank=True,
        db_index=True,
        verbose_name="Полное имя",
    )

    email = models.EmailField(
        blank=True,
        verbose_name="Email",
    )
    avatar_url = models.URLField(
        max_length=500,
        blank=True,
        verbose_name="Аватар",
    )

    position = models.CharField(
        max_length=255,
        blank=True,
        verbose_name="Должность",
    )
    department_ids = models.JSONField(
        default=list,
        blank=True,
        verbose_name="ID отделов",
    )
    department_names = models.JSONField(
        default=list,
        blank=True,
        verbose_name="Названия отделов",
    )

    is_admin = models.BooleanField(
        default=False,
        db_index=True,
        verbose_name="Администратор портала",
    )
    is_extranet = models.BooleanField(
        default=False,
        db_index=True,
        verbose_name="Экстранет-пользователь",
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
        verbose_name="Исходные данные пользователя",
    )

    class Meta:
        verbose_name = "Сотрудник портала"
        verbose_name_plural = "Сотрудники портала"
        ordering = ["full_name", "bitrix_user_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["portal", "bitrix_user_id"],
                name="unique_portal_bitrix_user",
            ),
        ]
        indexes = [
            models.Index(fields=["portal", "bitrix_user_id"]),
            models.Index(fields=["portal", "is_active"]),
            models.Index(fields=["portal", "full_name"]),
            models.Index(fields=["last_synced_at"]),
        ]

    def __str__(self):
        return self.full_name or f"Пользователь {self.bitrix_user_id}"


class SyncRun(BaseModel):
    """
    Запуск синхронизации с Битрикс24.

    Одна запись = одна попытка получить или пересчитать данные.
    """

    class SyncType(models.TextChoices):
        INITIAL = "initial", "Первичная синхронизация"
        MANUAL = "manual", "Ручная синхронизация"
        SCHEDULED = "scheduled", "Плановая синхронизация"
        WEBHOOK = "webhook", "Синхронизация по событию"
        PERIOD_RECALC = "period_recalc", "Пересчет периода"
        USERS = "users", "Синхронизация сотрудников"
        CRM_SOURCES = "crm_sources", "Синхронизация источников CRM"
        REPORT_DATA = "report_data", "Расчет отчетных данных"

    class Status(models.TextChoices):
        PENDING = "pending", "Ожидает"
        RUNNING = "running", "Выполняется"
        SUCCESS = "success", "Успешно"
        FAILED = "failed", "Ошибка"
        PARTIAL = "partial", "Частично выполнено"
        CANCELED = "canceled", "Отменено"

    portal = models.ForeignKey(
        BitrixPortal,
        on_delete=models.CASCADE,
        related_name="sync_runs",
        verbose_name="Портал",
    )

    sync_type = models.CharField(
        max_length=50,
        choices=SyncType.choices,
        db_index=True,
        verbose_name="Тип синхронизации",
    )
    status = models.CharField(
        max_length=30,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
        verbose_name="Статус",
    )

    date_from = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Период с",
    )
    date_to = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Период по",
    )

    started_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Дата начала",
    )
    finished_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Дата завершения",
    )

    celery_task_id = models.CharField(
        max_length=255,
        blank=True,
        db_index=True,
        verbose_name="ID фоновой задачи",
    )

    triggered_by_user_id = models.CharField(
        max_length=100,
        blank=True,
        verbose_name="Кем запущено",
    )

    processed_count = models.PositiveIntegerField(
        default=0,
        verbose_name="Обработано",
    )
    created_count = models.PositiveIntegerField(
        default=0,
        verbose_name="Создано",
    )
    updated_count = models.PositiveIntegerField(
        default=0,
        verbose_name="Обновлено",
    )
    skipped_count = models.PositiveIntegerField(
        default=0,
        verbose_name="Пропущено",
    )
    error_count = models.PositiveIntegerField(
        default=0,
        verbose_name="Ошибок",
    )

    error_message = models.TextField(
        blank=True,
        verbose_name="Сообщение об ошибке",
    )
    metadata = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Дополнительные данные",
    )

    class Meta:
        verbose_name = "Запуск синхронизации"
        verbose_name_plural = "Запуски синхронизаций"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["portal", "sync_type"]),
            models.Index(fields=["portal", "status"]),
            models.Index(fields=["portal", "created_at"]),
            models.Index(fields=["date_from", "date_to"]),
            models.Index(fields=["celery_task_id"]),
        ]

    def __str__(self):
        return f"{self.portal.domain} — {self.sync_type} — {self.status}"


class BitrixEvent(BaseModel):
    """
    Событие из Битрикс24.

    Например:
    - создана сделка;
    - изменена сделка;
    - изменен счет;
    - создан лид;
    - изменен пользователь.

    Модель нужна, чтобы не потерять событие и обработать его повторно при ошибке.
    """

    class Status(models.TextChoices):
        RECEIVED = "received", "Получено"
        PROCESSING = "processing", "Обрабатывается"
        PROCESSED = "processed", "Обработано"
        FAILED = "failed", "Ошибка"
        IGNORED = "ignored", "Проигнорировано"

    portal = models.ForeignKey(
        BitrixPortal,
        on_delete=models.CASCADE,
        related_name="events",
        verbose_name="Портал",
    )

    event_name = models.CharField(
        max_length=150,
        db_index=True,
        verbose_name="Название события",
    )
    entity_type = models.CharField(
        max_length=100,
        blank=True,
        db_index=True,
        verbose_name="Тип сущности",
    )
    entity_id = models.CharField(
        max_length=100,
        blank=True,
        db_index=True,
        verbose_name="ID сущности",
    )

    idempotency_key = models.CharField(
        max_length=255,
        null=True,
        blank=True,
        unique=True,
        verbose_name="Ключ идемпотентности",
    )

    status = models.CharField(
        max_length=30,
        choices=Status.choices,
        default=Status.RECEIVED,
        db_index=True,
        verbose_name="Статус",
    )

    received_at = models.DateTimeField(
        default=timezone.now,
        db_index=True,
        verbose_name="Дата получения",
    )
    processed_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Дата обработки",
    )

    attempts_count = models.PositiveIntegerField(
        default=0,
        verbose_name="Количество попыток",
    )

    payload = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Данные события",
    )
    error_message = models.TextField(
        blank=True,
        verbose_name="Ошибка обработки",
    )

    sync_run = models.ForeignKey(
        SyncRun,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="events",
        verbose_name="Связанная синхронизация",
    )

    class Meta:
        verbose_name = "Событие Битрикс24"
        verbose_name_plural = "События Битрикс24"
        ordering = ["-received_at"]
        indexes = [
            models.Index(fields=["portal", "event_name"]),
            models.Index(fields=["portal", "status"]),
            models.Index(fields=["portal", "received_at"]),
            models.Index(fields=["entity_type", "entity_id"]),
            models.Index(fields=["status", "received_at"]),
        ]

    def __str__(self):
        return f"{self.portal.domain} — {self.event_name} — {self.status}"
