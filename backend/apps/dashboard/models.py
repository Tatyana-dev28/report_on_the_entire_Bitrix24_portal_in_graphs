from django.db import models
from django.utils import timezone

from apps.bitrix.models import BitrixPortal, PortalUser, SyncRun
from apps.common.models import ActiveModel, BaseModel, PublicBaseModel
from apps.common.services.sanitizers import sanitize_payload
from apps.dashboard.constants import DEFAULT_REFRESH_INTERVAL_MINUTES


class DashboardAccessSession(PublicBaseModel, ActiveModel):
    """
    Вход владельца во внешний WEB-дашборд.

    Доверенные устройства хранятся бессрочно до явного закрытия входов.
    Недоверенные устройства живут только в рамках открытой браузерной сессии.
    """

    portal = models.ForeignKey(
        BitrixPortal,
        on_delete=models.CASCADE,
        related_name="dashboard_access_sessions",
        verbose_name="Портал",
    )
    user = models.ForeignKey(
        PortalUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="dashboard_access_sessions",
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

    session_key_hash = models.CharField(
        max_length=128,
        unique=True,
        db_index=True,
        verbose_name="Хэш ключа сессии",
    )
    session_key_fingerprint = models.CharField(
        max_length=16,
        blank=True,
        verbose_name="Отпечаток ключа сессии",
    )

    is_trusted_device = models.BooleanField(
        default=False,
        db_index=True,
        verbose_name="Доверенное устройство",
    )
    device_label = models.CharField(
        max_length=255,
        blank=True,
        verbose_name="Название устройства",
    )
    user_agent = models.TextField(
        blank=True,
        verbose_name="User-Agent",
    )
    ip_address = models.GenericIPAddressField(
        null=True,
        blank=True,
        verbose_name="IP-адрес",
    )

    last_seen_at = models.DateTimeField(
        default=timezone.now,
        db_index=True,
        verbose_name="Последняя активность",
    )
    ended_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Сессия завершена",
    )
    revoked_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Доступ закрыт",
    )

    class Meta:
        verbose_name = "Вход в WEB-дашборд"
        verbose_name_plural = "Входы в WEB-дашборд"
        ordering = ["-last_seen_at"]
        indexes = [
            models.Index(fields=["portal", "bitrix_user_id"]),
            models.Index(fields=["portal", "is_trusted_device"]),
            models.Index(fields=["portal", "revoked_at"]),
            models.Index(fields=["last_seen_at"]),
        ]

    @property
    def is_valid(self):
        return self.is_active and not self.ended_at and not self.revoked_at

    def __str__(self):
        trust = "доверенное" if self.is_trusted_device else "временное"
        return f"{self.portal.domain} — {self.bitrix_user_id} — {trust}"


class DashboardPreparedSnapshot(PublicBaseModel):
    """
    Успешно подготовленный набор данных для быстрого открытия WEB-дашборда.

    Храним только последние успешные снимки, сейчас лимит — 3 версии на портал.
    """

    portal = models.ForeignKey(
        BitrixPortal,
        on_delete=models.CASCADE,
        related_name="dashboard_prepared_snapshots",
        verbose_name="Портал",
    )
    sync_run = models.ForeignKey(
        SyncRun,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="dashboard_prepared_snapshots",
        verbose_name="Запуск синхронизации",
    )

    prepared_at = models.DateTimeField(
        default=timezone.now,
        db_index=True,
        verbose_name="Подготовлено",
    )
    is_current = models.BooleanField(
        default=False,
        db_index=True,
        verbose_name="Текущий снимок",
    )
    refresh_interval_minutes = models.PositiveSmallIntegerField(
        default=DEFAULT_REFRESH_INTERVAL_MINUTES,
        db_index=True,
        verbose_name="Интервал обновления",
    )

    settings_snapshot = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Снимок настроек",
    )
    saved_views_snapshot = models.JSONField(
        default=list,
        blank=True,
        verbose_name="Снимок сохранённых отчётов",
    )
    data = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Подготовленные данные",
    )
    metadata = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Дополнительные данные",
    )
    payload_size_bytes = models.PositiveIntegerField(
        default=0,
        verbose_name="Размер данных",
    )

    class Meta:
        verbose_name = "Снимок WEB-дашборда"
        verbose_name_plural = "Снимки WEB-дашборда"
        ordering = ["-prepared_at"]
        indexes = [
            models.Index(fields=["portal", "is_current"]),
            models.Index(fields=["portal", "prepared_at"]),
            models.Index(fields=["portal", "refresh_interval_minutes"]),
        ]

    def save(self, *args, **kwargs):
        self.settings_snapshot = sanitize_payload(self.settings_snapshot)
        self.saved_views_snapshot = sanitize_payload(self.saved_views_snapshot)
        self.data = sanitize_payload(self.data)
        self.metadata = sanitize_payload(self.metadata)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.portal.domain} — снимок {self.prepared_at:%Y-%m-%d %H:%M}"


class DashboardRefreshRun(BaseModel):
    """
    Журнал попыток обновления WEB-дашборда.

    На первом этапе сохраняем и успешные, и ошибочные попытки за 14 дней.
    """

    class TriggerType(models.TextChoices):
        SCHEDULED = "scheduled", "Плановое"
        MANUAL = "manual", "Ручное"
        SYSTEM = "system", "Системное"

    class Status(models.TextChoices):
        PENDING = "pending", "Ожидает"
        RUNNING = "running", "Выполняется"
        SUCCESS = "success", "Успешно"
        FAILED = "failed", "Ошибка"
        CANCELED = "canceled", "Отменено"

    portal = models.ForeignKey(
        BitrixPortal,
        on_delete=models.CASCADE,
        related_name="dashboard_refresh_runs",
        verbose_name="Портал",
    )
    sync_run = models.ForeignKey(
        SyncRun,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="dashboard_refresh_runs",
        verbose_name="Запуск синхронизации",
    )
    snapshot = models.ForeignKey(
        DashboardPreparedSnapshot,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="refresh_runs",
        verbose_name="Успешный снимок",
    )

    trigger_type = models.CharField(
        max_length=30,
        choices=TriggerType.choices,
        default=TriggerType.SCHEDULED,
        db_index=True,
        verbose_name="Тип запуска",
    )
    status = models.CharField(
        max_length=30,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
        verbose_name="Статус",
    )
    refresh_interval_minutes = models.PositiveSmallIntegerField(
        default=DEFAULT_REFRESH_INTERVAL_MINUTES,
        db_index=True,
        verbose_name="Интервал обновления",
    )

    requested_by_bitrix_user_id = models.CharField(
        max_length=100,
        blank=True,
        db_index=True,
        verbose_name="Кем запущено",
    )
    started_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Начато",
    )
    finished_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Завершено",
    )
    next_planned_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Следующая попытка",
    )

    error_message = models.TextField(
        blank=True,
        verbose_name="Ошибка",
    )
    metadata = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Дополнительные данные",
    )

    class Meta:
        verbose_name = "Обновление WEB-дашборда"
        verbose_name_plural = "Обновления WEB-дашборда"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["portal", "status"]),
            models.Index(fields=["portal", "trigger_type"]),
            models.Index(fields=["portal", "created_at"]),
            models.Index(fields=["portal", "started_at"]),
        ]

    @property
    def is_finished(self):
        return self.status in {
            self.Status.SUCCESS,
            self.Status.FAILED,
            self.Status.CANCELED,
        }

    def save(self, *args, **kwargs):
        self.metadata = sanitize_payload(self.metadata)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.portal.domain} — {self.trigger_type} — {self.status}"


class DashboardShareLink(PublicBaseModel, ActiveModel):
    """
    Расшаренная ссылка на один сохранённый отчёт.

    Получатель ссылки только смотрит отчёт и не меняет период, сотрудников,
    группировки, фильтры или источники.
    """

    portal = models.ForeignKey(
        BitrixPortal,
        on_delete=models.CASCADE,
        related_name="dashboard_share_links",
        verbose_name="Портал",
    )

    report_id = models.CharField(
        max_length=150,
        db_index=True,
        verbose_name="ID сохранённого отчёта",
    )
    report_name = models.CharField(
        max_length=255,
        blank=True,
        verbose_name="Название отчёта",
    )
    token_hash = models.CharField(
        max_length=128,
        unique=True,
        db_index=True,
        verbose_name="Хэш токена ссылки",
    )
    token_fingerprint = models.CharField(
        max_length=16,
        blank=True,
        verbose_name="Отпечаток токена",
    )

    expires_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Срок действия",
    )
    disabled_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Отключена",
    )
    created_by_bitrix_user_id = models.CharField(
        max_length=100,
        blank=True,
        db_index=True,
        verbose_name="Кто создал",
    )

    class Meta:
        verbose_name = "Ссылка на WEB-дашборд"
        verbose_name_plural = "Ссылки на WEB-дашборд"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["portal", "report_id"]),
            models.Index(fields=["portal", "is_active"]),
            models.Index(fields=["expires_at"]),
            models.Index(fields=["disabled_at"]),
        ]

    @property
    def is_available(self):
        if not self.is_active or self.disabled_at:
            return False

        return not self.expires_at or self.expires_at > timezone.now()

    def __str__(self):
        return f"{self.portal.domain} — {self.report_name or self.report_id}"
