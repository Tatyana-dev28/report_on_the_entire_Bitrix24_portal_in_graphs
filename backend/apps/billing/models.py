from django.db import models
from django.utils import timezone

from apps.bitrix.models import BitrixPortal
from apps.common.models import ActiveBaseModel, BaseModel, PublicBaseModel


class Plan(ActiveBaseModel):
    """
    Тарифный план приложения.

    Основные публичные тарифы:
    - free
    - pro_monthly
    - pro_yearly

    Также можно создать скрытый тариф, например internal_pro,
    для вашей компании или тестовых порталов.
    """

    class BillingPeriod(models.TextChoices):
        FREE = "free", "Бесплатно"
        MONTH = "month", "Месяц"
        YEAR = "year", "Год"

    code = models.CharField(
        max_length=100,
        unique=True,
        db_index=True,
        verbose_name="Код тарифа",
        help_text="Например: free, pro_monthly, pro_yearly, internal_pro.",
    )
    name = models.CharField(
        max_length=255,
        verbose_name="Название тарифа",
    )
    description = models.TextField(
        blank=True,
        verbose_name="Описание",
    )

    price = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
        verbose_name="Цена",
    )
    currency = models.CharField(
        max_length=10,
        default="RUB",
        db_index=True,
        verbose_name="Валюта",
    )

    billing_period = models.CharField(
        max_length=30,
        choices=BillingPeriod.choices,
        default=BillingPeriod.FREE,
        db_index=True,
        verbose_name="Период оплаты",
    )

    duration_months = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        verbose_name="Длительность в месяцах",
        help_text="Для pro_monthly = 1, для pro_yearly = 12. Для free можно оставить пустым.",
    )

    features = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Функции тарифа",
        help_text=(
            "Например: save_report_data, save_presets, "
            "employee_details, export_excel, export_pdf."
        ),
    )
    limits = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Лимиты тарифа",
        help_text="Например: max_period_months, max_sources, max_presets.",
    )

    is_public = models.BooleanField(
        default=True,
        db_index=True,
        verbose_name="Показывать пользователям",
        help_text="Скрытые тарифы можно использовать для внутреннего Pro-доступа.",
    )
    is_default = models.BooleanField(
        default=False,
        db_index=True,
        verbose_name="Тариф по умолчанию",
        help_text="Обычно true только для тарифа free.",
    )

    sort_order = models.PositiveIntegerField(
        default=100,
        db_index=True,
        verbose_name="Порядок сортировки",
    )

    class Meta:
        verbose_name = "Тариф"
        verbose_name_plural = "Тарифы"
        ordering = ["sort_order", "price", "name"]
        indexes = [
            models.Index(fields=["code"]),
            models.Index(fields=["is_active"]),
            models.Index(fields=["is_public"]),
            models.Index(fields=["is_default"]),
            models.Index(fields=["billing_period"]),
        ]

    def __str__(self):
        return self.name


class Subscription(PublicBaseModel):
    """
    Подписка портала на тариф.

    Создается автоматически:
    - при установке приложения создается Free-подписка;
    - после успешной оплаты Robokassa создается или обновляется Pro-подписка;
    - через админку можно вручную выдать Manual Pro.
    """

    class Status(models.TextChoices):
        FREE = "free", "Бесплатная"
        TRIAL = "trial", "Пробный период"
        ACTIVE = "active", "Активна"
        PAST_DUE = "past_due", "Просрочена"
        CANCELED = "canceled", "Отменена"
        EXPIRED = "expired", "Истекла"
        BLOCKED = "blocked", "Заблокирована"

    class Provider(models.TextChoices):
        ROBOKASSA = "robokassa", "Robokassa"
        MANUAL = "manual", "Ручное включение"
        NONE = "none", "Без провайдера"

    portal = models.ForeignKey(
        BitrixPortal,
        on_delete=models.CASCADE,
        related_name="subscriptions",
        verbose_name="Портал",
    )
    plan = models.ForeignKey(
        Plan,
        on_delete=models.PROTECT,
        related_name="subscriptions",
        verbose_name="Тариф",
    )

    status = models.CharField(
        max_length=30,
        choices=Status.choices,
        default=Status.FREE,
        db_index=True,
        verbose_name="Статус",
    )

    provider = models.CharField(
        max_length=50,
        choices=Provider.choices,
        default=Provider.NONE,
        db_index=True,
        verbose_name="Платежный провайдер",
    )

    started_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Дата начала",
    )
    paid_until = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Оплачено до",
    )
    trial_until = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Пробный период до",
        help_text="Пока можно оставить пустым, если пробный период еще не утвержден.",
    )
    canceled_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Дата отмены",
    )

    is_lifetime = models.BooleanField(
        default=False,
        db_index=True,
        verbose_name="Бессрочная подписка",
        help_text="Используется для ручного Pro-доступа через админку.",
    )

    auto_renew = models.BooleanField(
        default=False,
        db_index=True,
        verbose_name="Автопродление",
    )

    provider_subscription_id = models.CharField(
        max_length=255,
        null=True,
        blank=True,
        db_index=True,
        verbose_name="ID подписки у провайдера",
    )

    manual_reason = models.CharField(
        max_length=255,
        blank=True,
        verbose_name="Причина ручной выдачи",
        help_text="Например: internal_company, partner, test, manager_access.",
    )
    admin_comment = models.TextField(
        blank=True,
        verbose_name="Комментарий администратора",
    )

    metadata = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Дополнительные данные",
    )

    class Meta:
        verbose_name = "Подписка"
        verbose_name_plural = "Подписки"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["portal", "status"]),
            models.Index(fields=["portal", "paid_until"]),
            models.Index(fields=["portal", "provider"]),
            models.Index(fields=["provider", "provider_subscription_id"]),
            models.Index(fields=["status", "paid_until"]),
            models.Index(fields=["is_lifetime"]),
        ]

    def __str__(self):
        return f"{self.portal.domain} — {self.plan.name} — {self.status}"

    @property
    def is_currently_valid(self):
        """
        Проверяет, действует ли подписка сейчас.

        Free тоже считается действующей подпиской,
        но не дает Pro-функции.
        """

        now = timezone.now()

        if self.status == self.Status.FREE:
            return True

        if self.status == self.Status.ACTIVE and self.is_lifetime:
            return True

        if self.status in [self.Status.ACTIVE, self.Status.TRIAL]:
            if self.paid_until and self.paid_until >= now:
                return True

            if self.trial_until and self.trial_until >= now:
                return True

        return False

    @property
    def has_pro_access(self):
        """
        Проверяет именно Pro-доступ.

        Free-подписка возвращает False.
        """

        if not self.is_currently_valid:
            return False

        if self.status == self.Status.FREE:
            return False

        return True


class Payment(PublicBaseModel):
    """
    Конкретный платеж.

    Для обычного пользователя создается автоматически,
    когда он выбирает Pro на месяц или Pro на год.

    После успешного webhook от Robokassa по этому платежу
    backend включает Pro-доступ порталу.
    """

    class Provider(models.TextChoices):
        ROBOKASSA = "robokassa", "Robokassa"
        MANUAL = "manual", "Ручной платеж"

    class Status(models.TextChoices):
        PENDING = "pending", "Ожидает оплаты"
        SUCCEEDED = "succeeded", "Успешно оплачен"
        CANCELED = "canceled", "Отменен"
        FAILED = "failed", "Ошибка"
        REFUNDED = "refunded", "Возвращен"

    portal = models.ForeignKey(
        BitrixPortal,
        on_delete=models.CASCADE,
        related_name="payments",
        verbose_name="Портал",
    )
    subscription = models.ForeignKey(
        Subscription,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="payments",
        verbose_name="Подписка",
    )
    plan = models.ForeignKey(
        Plan,
        on_delete=models.PROTECT,
        related_name="payments",
        verbose_name="Тариф",
    )

    order_id = models.CharField(
        max_length=100,
        unique=True,
        db_index=True,
        verbose_name="Внутренний номер заказа",
        help_text="Наш внутренний ID заказа, по которому потом находим платеж.",
    )

    provider = models.CharField(
        max_length=50,
        choices=Provider.choices,
        default=Provider.ROBOKASSA,
        db_index=True,
        verbose_name="Платежный провайдер",
    )
    provider_payment_id = models.CharField(
        max_length=255,
        null=True,
        blank=True,
        db_index=True,
        verbose_name="ID платежа у провайдера",
    )
    provider_invoice_id = models.CharField(
        max_length=255,
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Номер счета у провайдера",
    )

    status = models.CharField(
        max_length=50,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
        verbose_name="Статус",
    )

    amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        verbose_name="Сумма",
    )
    currency = models.CharField(
        max_length=10,
        default="RUB",
        db_index=True,
        verbose_name="Валюта",
    )

    description = models.CharField(
        max_length=500,
        blank=True,
        verbose_name="Описание платежа",
    )

    payment_url = models.URLField(
        max_length=1000,
        blank=True,
        verbose_name="Ссылка на оплату",
    )

    paid_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Дата оплаты",
    )
    expires_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Ссылка действует до",
    )

    customer_email = models.EmailField(
        blank=True,
        verbose_name="Email плательщика",
    )

    metadata = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Дополнительные данные",
    )
    raw_provider_payload = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Исходные данные провайдера",
    )

    class Meta:
        verbose_name = "Платеж"
        verbose_name_plural = "Платежи"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["portal", "status"]),
            models.Index(fields=["portal", "created_at"]),
            models.Index(fields=["provider", "provider_payment_id"]),
            models.Index(fields=["provider", "provider_invoice_id"]),
            models.Index(fields=["status", "paid_at"]),
            models.Index(fields=["expires_at"]),
        ]

    def __str__(self):
        return f"{self.portal.domain} — {self.order_id} — {self.amount} {self.currency}"


class PaymentWebhookEvent(BaseModel):
    """
    Входящее событие от Robokassa.

    Нужна отдельная таблица, чтобы:
    - не обработать оплату дважды;
    - сохранить исходные данные webhook;
    - видеть ошибки обработки;
    - повторить обработку при сбое.
    """

    class Provider(models.TextChoices):
        ROBOKASSA = "robokassa", "Robokassa"

    class Status(models.TextChoices):
        RECEIVED = "received", "Получено"
        PROCESSING = "processing", "Обрабатывается"
        PROCESSED = "processed", "Обработано"
        FAILED = "failed", "Ошибка"
        IGNORED = "ignored", "Проигнорировано"

    provider = models.CharField(
        max_length=50,
        choices=Provider.choices,
        default=Provider.ROBOKASSA,
        db_index=True,
        verbose_name="Платежный провайдер",
    )

    idempotency_key = models.CharField(
        max_length=255,
        unique=True,
        db_index=True,
        verbose_name="Ключ идемпотентности",
        help_text="Уникальный ключ, чтобы webhook не был обработан повторно.",
    )

    event_id = models.CharField(
        max_length=255,
        null=True,
        blank=True,
        db_index=True,
        verbose_name="ID события у провайдера",
    )
    event_type = models.CharField(
        max_length=150,
        db_index=True,
        verbose_name="Тип события",
        help_text="Например: payment_result, success_redirect, fail_redirect.",
    )

    payment = models.ForeignKey(
        Payment,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="webhook_events",
        verbose_name="Платеж",
    )
    portal = models.ForeignKey(
        BitrixPortal,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="payment_webhook_events",
        verbose_name="Портал",
    )

    status = models.CharField(
        max_length=30,
        choices=Status.choices,
        default=Status.RECEIVED,
        db_index=True,
        verbose_name="Статус",
    )

    is_signature_valid = models.BooleanField(
        default=False,
        db_index=True,
        verbose_name="Подпись проверена",
    )

    payload = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Данные события",
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
    error_message = models.TextField(
        blank=True,
        verbose_name="Ошибка",
    )

    class Meta:
        verbose_name = "Webhook Robokassa"
        verbose_name_plural = "Webhooks Robokassa"
        ordering = ["-received_at"]
        indexes = [
            models.Index(fields=["provider", "event_id"]),
            models.Index(fields=["provider", "event_type"]),
            models.Index(fields=["status", "received_at"]),
            models.Index(fields=["portal", "received_at"]),
            models.Index(fields=["is_signature_valid"]),
        ]

    def __str__(self):
        return f"{self.provider} — {self.event_type} — {self.status}"


class PortalAccess(BaseModel):
    """
    Быстрый текущий доступ портала.

    Frontend не должен разбирать платежи и подписки.
    Он просто спрашивает backend:
    - есть ли Pro;
    - какие функции доступны;
    - какие лимиты действуют;
    - до какой даты доступ.
    """

    class AccessLevel(models.TextChoices):
        FREE = "free", "Free"
        PRO = "pro", "Pro"
        TRIAL = "trial", "Пробный период"
        INTERNAL = "internal", "Внутренний Pro"
        BLOCKED = "blocked", "Заблокирован"

    portal = models.OneToOneField(
        BitrixPortal,
        on_delete=models.CASCADE,
        related_name="access",
        verbose_name="Портал",
    )
    subscription = models.ForeignKey(
        Subscription,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="access_records",
        verbose_name="Подписка",
    )
    plan = models.ForeignKey(
        Plan,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="access_records",
        verbose_name="Тариф",
    )

    access_level = models.CharField(
        max_length=30,
        choices=AccessLevel.choices,
        default=AccessLevel.FREE,
        db_index=True,
        verbose_name="Уровень доступа",
    )

    has_pro = models.BooleanField(
        default=False,
        db_index=True,
        verbose_name="Есть Pro-доступ",
    )
    is_lifetime = models.BooleanField(
        default=False,
        db_index=True,
        verbose_name="Бессрочный доступ",
    )

    valid_until = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Доступ действует до",
    )

    features = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Доступные функции",
    )
    limits = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Лимиты",
    )

    source = models.CharField(
        max_length=100,
        blank=True,
        db_index=True,
        verbose_name="Источник доступа",
        help_text="Например: free, robokassa, manual, trial, internal_company.",
    )

    last_checked_at = models.DateTimeField(
        default=timezone.now,
        db_index=True,
        verbose_name="Дата последней проверки",
    )

    class Meta:
        verbose_name = "Доступ портала"
        verbose_name_plural = "Доступы порталов"
        ordering = ["portal"]
        indexes = [
            models.Index(fields=["access_level"]),
            models.Index(fields=["has_pro"]),
            models.Index(fields=["is_lifetime"]),
            models.Index(fields=["valid_until"]),
            models.Index(fields=["last_checked_at"]),
        ]

    def __str__(self):
        return f"{self.portal.domain} — {self.access_level}"

    @property
    def is_pro_valid(self):
        """
        Проверяет, действует ли именно Pro-доступ.
        """

        if not self.has_pro:
            return False

        if self.access_level == self.AccessLevel.BLOCKED:
            return False

        if self.is_lifetime:
            return True

        if not self.valid_until:
            return False

        return self.valid_until >= timezone.now()