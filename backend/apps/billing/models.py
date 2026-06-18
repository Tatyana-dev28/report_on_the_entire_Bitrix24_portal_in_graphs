from django.db import models
from django.utils import timezone

from apps.bitrix.models import BitrixPortal
from apps.common.models import ActiveBaseModel, BaseModel, PublicBaseModel


class Plan(ActiveBaseModel):
    """
    Тарифный план приложения.

    Сейчас используем:
    - free
    - pro_monthly
    - internal_pro

    pro_yearly пока не используем.
    Цену можно менять через админку в поле price.
    """

    class BillingPeriod(models.TextChoices):
        FREE = "free", "Бесплатно"
        MONTH = "month", "Месяц"

    code = models.CharField(
        max_length=100,
        unique=True,
        db_index=True,
        verbose_name="Код тарифа",
        help_text="Например: free, pro_monthly, internal_pro.",
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
        help_text="Цена тарифа. Можно менять через админку.",
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
        help_text="Для pro_monthly = 1. Для free можно оставить пустым.",
    )

    features = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Функции тарифа",
        help_text=(
            "Для Free: save_report_state=false, save_report_presets=false, "
            "save_report_results=false. Для Pro: save_report_state=true, "
            "save_report_presets=true, save_report_results=false."
        ),
    )
    limits = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Лимиты тарифа",
        help_text="Например: max_presets, max_saved_states.",
    )

    is_public = models.BooleanField(
        default=True,
        db_index=True,
        verbose_name="Показывать пользователям",
        help_text="internal_pro должен быть скрытым тарифом.",
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

    При установке приложения создается Free-подписка.
    После оплаты Robokassa подписка становится active.
    Trial и Manual Pro можно выдать через админку.
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
        verbose_name="Дата начала подписки",
    )
    paid_until = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Оплачено до",
        help_text="Для месячной Pro-подписки здесь дата окончания доступа.",
    )

    trial_started_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Пробный период с",
        help_text="Можно вручную указать дату начала trial через админку.",
    )
    trial_until = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Пробный период до",
        help_text="Можно вручную указать дату окончания trial через админку.",
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
        help_text="Для внутреннего Manual Pro-доступа через админку.",
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
        help_text="Например: internal_company, test, manager_access, trial.",
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
            models.Index(fields=["portal", "trial_until"]),
            models.Index(fields=["portal", "provider"]),
            models.Index(fields=["provider", "provider_subscription_id"]),
            models.Index(fields=["status", "paid_until"]),
            models.Index(fields=["status", "trial_until"]),
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

        if self.status == self.Status.ACTIVE:
            return bool(self.paid_until and self.paid_until >= now)

        if self.status == self.Status.TRIAL:
            if self.trial_started_at and self.trial_started_at > now:
                return False

            return bool(self.trial_until and self.trial_until >= now)

        return False

    @property
    def has_pro_access(self):
        """
        Проверяет именно Pro-доступ.

        Free-подписка возвращает False.
        Trial, active Pro и lifetime Manual Pro возвращают True,
        если срок доступа действует.
        """

        if not self.is_currently_valid:
            return False

        if self.status == self.Status.FREE:
            return False

        return True


class Payment(PublicBaseModel):
    """
    Конкретный платеж.

    Создается автоматически, когда пользователь выбирает месячную Pro-подписку.
    После успешного webhook от Robokassa backend включает Pro-доступ порталу.
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

    Нужно, чтобы:
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

    Важно:
    результаты отчета не сохраняются ни на Free, ни на Pro.
    Pro сохраняет только настройки и фильтры.
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
        help_text="save_report_state/save_report_presets могут быть true, save_report_results всегда false.",
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