from django.db import models
from django.utils import timezone

from apps.common.models import ActiveModel, BaseModel, PublicBaseModel
from apps.common.services.crypto import decrypt_value, encrypt_value, hash_value, make_fingerprint
from apps.common.services.sanitizers import sanitize_payload


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

    class Protocol(models.TextChoices):
        HTTPS = "https", "HTTPS"
        HTTP = "http", "HTTP"

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
        choices=Protocol.choices,
        default=Protocol.HTTPS,
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

    bitrix_license = models.CharField(
        max_length=100,
        blank=True,
        default="",
        db_index=True,
        verbose_name="Bitrix24 LICENSE",
    )
    bitrix_license_type = models.CharField(
        max_length=100,
        blank=True,
        default="",
        db_index=True,
        verbose_name="Bitrix24 LICENSE_TYPE",
    )
    bitrix_license_family = models.CharField(
        max_length=100,
        blank=True,
        default="",
        db_index=True,
        verbose_name="Bitrix24 LICENSE_FAMILY",
    )
    bitrix_license_checked_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Bitrix24 license checked at",
    )

    application_token_encrypted = models.TextField(
        blank=True,
        verbose_name="Application token, encrypted",
        help_text="Зашифрованный application_token. Не показывать в админке.",
    )
    application_token_hash = models.CharField(
        max_length=64,
        blank=True,
        db_index=True,
        verbose_name="Хэш application token",
        help_text="Необратимый хэш application_token для сравнения и отладки.",
    )

    raw_install_payload = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Очищенные исходные данные установки",
        help_text="Не сохранять сюда AUTH_ID, REFRESH_ID, application_token и другие секреты.",
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

    def set_application_token(self, token: str, save: bool = False):
        """
        Шифрует и сохраняет application_token.

        Сам токен в открытом виде в БД не попадает.
        """

        if not token:
            self.application_token_encrypted = ""
            self.application_token_hash = ""
        else:
            self.application_token_encrypted = encrypt_value(token)
            self.application_token_hash = make_fingerprint(token, length=64)

        if save:
            self.save(
                update_fields=[
                    "application_token_encrypted",
                    "application_token_hash",
                    "updated_at",
                ]
            )

    def get_application_token(self) -> str:
        """
        Возвращает расшифрованный application_token.
        Использовать только внутри backend-сервисов.
        """

        return decrypt_value(self.application_token_encrypted)

    def clear_application_token(self, save: bool = False):
        """
        Полностью удаляет application_token из записи.
        Нужно при удалении приложения или отзыве доступа.
        """

        self.application_token_encrypted = ""
        self.application_token_hash = ""

        if save:
            self.save(
                update_fields=[
                    "application_token_encrypted",
                    "application_token_hash",
                    "updated_at",
                ]
            )

    @property
    def has_application_token(self):
        return bool(self.application_token_encrypted)

    @property
    def application_token_fingerprint(self):
        """
        Короткий безопасный отпечаток для админки и логов.
        """

        return self.application_token_hash[:12] if self.application_token_hash else ""

    def save(self, *args, **kwargs):
        self.raw_install_payload = sanitize_payload(self.raw_install_payload)
        super().save(*args, **kwargs)


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
        blank=True,
        default="",
        verbose_name="Access token, encrypted",
        help_text="Зашифрованный access_token. Не показывать в админке.",
    )
    refresh_token_encrypted = models.TextField(
        blank=True,
        default="",
        verbose_name="Refresh token, encrypted",
        help_text="Зашифрованный refresh_token. Не показывать в админке.",
    )

    access_token_hash = models.CharField(
        max_length=64,
        blank=True,
        db_index=True,
        verbose_name="Хэш access token",
        help_text="Необратимый хэш access_token для сравнения и отладки.",
    )
    refresh_token_hash = models.CharField(
        max_length=64,
        blank=True,
        db_index=True,
        verbose_name="Хэш refresh token",
        help_text="Необратимый хэш refresh_token для сравнения и отладки.",
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
        verbose_name="Очищенные исходные данные авторизации",
        help_text="Не сохранять сюда AUTH_ID, REFRESH_ID, access_token, refresh_token и другие секреты.",
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

    def set_access_token(self, token: str, save: bool = False):
        """
        Шифрует и сохраняет access_token.
        """

        if not token:
            self.access_token_encrypted = ""
            self.access_token_hash = ""
        else:
            self.access_token_encrypted = encrypt_value(token)
            self.access_token_hash = make_fingerprint(token, length=64)

        if save:
            self.save(
                update_fields=[
                    "access_token_encrypted",
                    "access_token_hash",
                    "updated_at",
                ]
            )

    def get_access_token(self) -> str:
        """
        Возвращает расшифрованный access_token.
        Использовать только внутри backend-сервисов.
        """

        return decrypt_value(self.access_token_encrypted)

    def set_refresh_token(self, token: str, save: bool = False):
        """
        Шифрует и сохраняет refresh_token.
        """

        if not token:
            self.refresh_token_encrypted = ""
            self.refresh_token_hash = ""
        else:
            self.refresh_token_encrypted = encrypt_value(token)
            self.refresh_token_hash = make_fingerprint(token, length=64)

        if save:
            self.save(
                update_fields=[
                    "refresh_token_encrypted",
                    "refresh_token_hash",
                    "updated_at",
                ]
            )

    def get_refresh_token(self) -> str:
        """
        Возвращает расшифрованный refresh_token.
        Использовать только внутри backend-сервисов.
        """

        return decrypt_value(self.refresh_token_encrypted)

    def set_tokens(
        self,
        access_token: str,
        refresh_token: str = "",
        expires_at=None,
        save: bool = False,
    ):
        """
        Удобный метод для одновременного обновления access_token и refresh_token.
        """

        self.set_access_token(access_token, save=False)

        if refresh_token:
            self.set_refresh_token(refresh_token, save=False)

        if expires_at is not None:
            self.expires_at = expires_at

        if save:
            update_fields = [
                "access_token_encrypted",
                "access_token_hash",
                "refresh_token_encrypted",
                "refresh_token_hash",
                "updated_at",
            ]

            if expires_at is not None:
                update_fields.append("expires_at")

            self.save(update_fields=update_fields)

    def clear_tokens(self, save: bool = False):
        """
        Полностью удаляет OAuth-токены.
        Нужно при удалении приложения, отзыве доступа или блокировке портала.
        """

        self.access_token_encrypted = ""
        self.access_token_hash = ""
        self.refresh_token_encrypted = ""
        self.refresh_token_hash = ""

        if save:
            self.save(
                update_fields=[
                    "access_token_encrypted",
                    "access_token_hash",
                    "refresh_token_encrypted",
                    "refresh_token_hash",
                    "updated_at",
                ]
            )

    @property
    def access_token_fingerprint(self):
        return self.access_token_hash[:12] if self.access_token_hash else ""

    @property
    def refresh_token_fingerprint(self):
        return self.refresh_token_hash[:12] if self.refresh_token_hash else ""

    @property
    def has_access_token(self):
        return bool(self.access_token_encrypted)

    @property
    def has_refresh_token(self):
        return bool(self.refresh_token_encrypted)

    def save(self, *args, **kwargs):
        self.raw_auth_payload = sanitize_payload(self.raw_auth_payload)
        super().save(*args, **kwargs)


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
        max_length=16,
        blank=True,
        default="",
        db_index=True,
        verbose_name="Fingerprint ключа идемпотентности",
        help_text="Короткий безопасный отпечаток. Реальный ключ здесь не хранится.",
    )
    idempotency_key_hash = models.CharField(
        max_length=64,
        null=True,
        blank=True,
        unique=True,
        db_index=True,
        verbose_name="Хэш ключа идемпотентности",
        help_text="Необратимый хэш для защиты от повторной обработки события.",
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
            models.Index(fields=["idempotency_key_hash"]),
        ]

    def __str__(self):
        return f"{self.portal.domain} — {self.event_name} — {self.status}"

    def set_idempotency_key(self, key: str, save: bool = False):
        """
        Сохраняет не реальный ключ идемпотентности, а fingerprint + hash.

        Этот метод нужно вызывать в сервисах обработки событий,
        когда мы получаем реальный ключ события из Битрикс24.
        """

        if not key:
            self.idempotency_key = ""
            self.idempotency_key_hash = None
        else:
            self.idempotency_key = make_fingerprint(key, length=12)
            self.idempotency_key_hash = hash_value(key)

        if save:
            self.save(
                update_fields=[
                    "idempotency_key",
                    "idempotency_key_hash",
                    "updated_at",
                ]
            )

    @property
    def idempotency_key_fingerprint(self):
        return self.idempotency_key or ""

    def save(self, *args, **kwargs):
        self.payload = sanitize_payload(self.payload)

        if self.idempotency_key and not self.idempotency_key_hash:
            raw_key = self.idempotency_key
            self.set_idempotency_key(raw_key, save=False)

        super().save(*args, **kwargs)
