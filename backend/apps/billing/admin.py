from datetime import timedelta

from django.contrib import admin, messages
from django.utils import timezone
from django.utils.html import format_html

from apps.billing.models import (
    Payment,
    PaymentWebhookEvent,
    Plan,
    PortalAccess,
    Subscription,
)
from apps.billing.services.access import (
    activate_manual_pro,
    activate_paid_subscription,
    activate_trial,
    block_access,
    cancel_subscription,
    expire_subscription,
    set_free_access,
    sync_portal_access_from_subscription,
)


def status_badge(text, color):
    return format_html('<span style="color: {};">{}</span>', color, text)


def yes_no_badge(value):
    if value:
        return status_badge("Да", "#027a48")

    return status_badge("Нет", "#b42318")


@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    list_display = (
        "code",
        "name",
        "price",
        "currency",
        "billing_period",
        "duration_months",
        "is_public",
        "is_default",
        "is_active",
        "sort_order",
    )
    list_filter = (
        "billing_period",
        "currency",
        "is_public",
        "is_default",
        "is_active",
    )
    search_fields = (
        "code",
        "name",
        "description",
    )
    readonly_fields = (
        "created_at",
        "updated_at",
        "deleted_at",
    )
    ordering = (
        "sort_order",
        "price",
        "name",
    )

    fieldsets = (
        (
            "Тариф",
            {
                "fields": (
                    "code",
                    "name",
                    "description",
                    "is_active",
                )
            },
        ),
        (
            "Оплата",
            {
                "fields": (
                    "price",
                    "currency",
                    "billing_period",
                    "duration_months",
                )
            },
        ),
        (
            "Доступность",
            {
                "fields": (
                    "is_public",
                    "is_default",
                    "sort_order",
                )
            },
        ),
        (
            "Функции и лимиты",
            {
                "fields": (
                    "features",
                    "limits",
                ),
                "description": "save_report_results всегда должен быть false.",
            },
        ),
        (
            "Мягкое удаление",
            {
                "fields": (
                    "is_deleted",
                    "deleted_at",
                ),
                "classes": ("collapse",),
            },
        ),
        (
            "Служебные даты",
            {
                "fields": (
                    "created_at",
                    "updated_at",
                )
            },
        ),
    )


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = (
        "portal",
        "plan",
        "status",
        "provider",
        "pro_status",
        "trial_period",
        "paid_until",
        "is_lifetime",
        "auto_renew",
        "created_at",
    )
    list_filter = (
        "status",
        "provider",
        "plan",
        "is_lifetime",
        "auto_renew",
        "trial_until",
        "paid_until",
        "created_at",
    )
    search_fields = (
        "portal__domain",
        "portal__member_id",
        "plan__code",
        "plan__name",
        "provider_subscription_id",
        "manual_reason",
        "admin_comment",
    )
    readonly_fields = (
        "public_id",
        "pro_status",
        "trial_period",
        "created_at",
        "updated_at",
        "deleted_at",
    )
    raw_id_fields = (
        "portal",
        "plan",
    )
    ordering = (
        "-created_at",
    )
    date_hierarchy = "created_at"
    actions = (
        "sync_access",
        "activate_trial_14_days",
        "activate_manual_pro_30_days",
        "activate_lifetime_manual",
        "cancel_subscriptions",
        "expire_subscriptions",
        "block_subscriptions",
    )

    fieldsets = (
        (
            "Портал и тариф",
            {
                "fields": (
                    "public_id",
                    "portal",
                    "plan",
                    "status",
                    "provider",
                    "pro_status",
                )
            },
        ),
        (
            "Периоды доступа",
            {
                "fields": (
                    "started_at",
                    "paid_until",
                    "trial_started_at",
                    "trial_until",
                    "trial_period",
                    "canceled_at",
                )
            },
        ),
        (
            "Настройки подписки",
            {
                "fields": (
                    "is_lifetime",
                    "auto_renew",
                    "provider_subscription_id",
                    "manual_reason",
                    "admin_comment",
                )
            },
        ),
        (
            "Metadata",
            {
                "fields": (
                    "metadata",
                ),
                "classes": ("collapse",),
            },
        ),
        (
            "Мягкое удаление",
            {
                "fields": (
                    "is_deleted",
                    "deleted_at",
                ),
                "classes": ("collapse",),
            },
        ),
        (
            "Служебные даты",
            {
                "fields": (
                    "created_at",
                    "updated_at",
                )
            },
        ),
    )

    @admin.display(description="Pro-доступ")
    def pro_status(self, obj):
        if not obj or not obj.pk:
            return "-"

        if obj.has_pro_access:
            if obj.status == Subscription.Status.TRIAL:
                return status_badge("Trial активен", "#175cd3")

            if obj.is_lifetime:
                return status_badge("Бессрочный Pro", "#027a48")

            return status_badge("Pro активен", "#027a48")

        if obj.status == Subscription.Status.FREE:
            return status_badge("Free", "#475467")

        if obj.status == Subscription.Status.BLOCKED:
            return status_badge("Заблокирована", "#b42318")

        return status_badge("Нет Pro", "#b42318")

    @admin.display(description="Trial")
    def trial_period(self, obj):
        if not obj or not obj.pk:
            return "-"

        if not obj.trial_started_at and not obj.trial_until:
            return "-"

        return f"{obj.trial_started_at or '-'} → {obj.trial_until or '-'}"

    @admin.action(description="Синхронизировать доступ PortalAccess")
    def sync_access(self, request, queryset):
        count = 0

        for subscription in queryset:
            sync_portal_access_from_subscription(subscription)
            count += 1

        self.message_user(
            request,
            f"Синхронизировано доступов: {count}",
            level=messages.SUCCESS,
        )

    @admin.action(description="Включить Trial на 14 дней")
    def activate_trial_14_days(self, request, queryset):
        count = 0

        for subscription in queryset:
            activate_trial(subscription, days=14)
            count += 1

        self.message_user(
            request,
            f"Trial включен для подписок: {count}",
            level=messages.SUCCESS,
        )

    @admin.action(description="Включить Manual Pro на 30 дней")
    def activate_manual_pro_30_days(self, request, queryset):
        count = 0
        paid_until = timezone.now() + timedelta(days=30)

        for subscription in queryset:
            activate_manual_pro(
                subscription,
                paid_until=paid_until,
                is_lifetime=False,
                manual_reason="manual_30_days",
            )
            count += 1

        self.message_user(
            request,
            f"Manual Pro на 30 дней включен для подписок: {count}",
            level=messages.SUCCESS,
        )

    @admin.action(description="Включить бессрочный Manual Pro")
    def activate_lifetime_manual(self, request, queryset):
        count = 0

        for subscription in queryset:
            activate_manual_pro(
                subscription,
                is_lifetime=True,
                manual_reason="internal_company",
            )
            count += 1

        self.message_user(
            request,
            f"Бессрочный Manual Pro включен для подписок: {count}",
            level=messages.SUCCESS,
        )

    @admin.action(description="Отменить и перевести в Free")
    def cancel_subscriptions(self, request, queryset):
        count = 0

        for subscription in queryset:
            cancel_subscription(subscription)
            count += 1

        self.message_user(
            request,
            f"Отменено подписок: {count}",
            level=messages.SUCCESS,
        )

    @admin.action(description="Пометить истекшими и перевести в Free")
    def expire_subscriptions(self, request, queryset):
        count = 0

        for subscription in queryset:
            expire_subscription(subscription)
            count += 1

        self.message_user(
            request,
            f"Истекших подписок обработано: {count}",
            level=messages.SUCCESS,
        )

    @admin.action(description="Заблокировать доступ")
    def block_subscriptions(self, request, queryset):
        count = 0

        for subscription in queryset:
            block_access(
                portal=subscription.portal,
                subscription=subscription,
                reason="admin_blocked",
            )
            count += 1

        self.message_user(
            request,
            f"Заблокировано подписок: {count}",
            level=messages.WARNING,
        )


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = (
        "order_id",
        "portal",
        "plan",
        "provider",
        "status",
        "amount",
        "currency",
        "paid_at",
        "expires_at",
        "created_at",
    )
    list_filter = (
        "provider",
        "status",
        "currency",
        "paid_at",
        "expires_at",
        "created_at",
    )
    search_fields = (
        "order_id",
        "portal__domain",
        "portal__member_id",
        "provider_payment_id",
        "provider_invoice_id",
        "customer_email",
        "description",
    )
    readonly_fields = (
        "public_id",
        "created_at",
        "updated_at",
        "deleted_at",
    )
    raw_id_fields = (
        "portal",
        "subscription",
        "plan",
    )
    ordering = (
        "-created_at",
    )
    date_hierarchy = "created_at"
    actions = (
        "mark_as_succeeded_manual",
        "mark_as_canceled",
        "mark_as_failed",
    )

    fieldsets = (
        (
            "Платеж",
            {
                "fields": (
                    "public_id",
                    "portal",
                    "subscription",
                    "plan",
                    "order_id",
                    "status",
                )
            },
        ),
        (
            "Провайдер",
            {
                "fields": (
                    "provider",
                    "provider_payment_id",
                    "provider_invoice_id",
                    "payment_url",
                )
            },
        ),
        (
            "Сумма",
            {
                "fields": (
                    "amount",
                    "currency",
                    "description",
                    "customer_email",
                )
            },
        ),
        (
            "Даты",
            {
                "fields": (
                    "paid_at",
                    "expires_at",
                )
            },
        ),
        (
            "Очищенные данные",
            {
                "fields": (
                    "metadata",
                    "raw_provider_payload",
                ),
                "classes": ("collapse",),
            },
        ),
        (
            "Мягкое удаление",
            {
                "fields": (
                    "is_deleted",
                    "deleted_at",
                ),
                "classes": ("collapse",),
            },
        ),
        (
            "Служебные даты",
            {
                "fields": (
                    "created_at",
                    "updated_at",
                )
            },
        ),
    )

    @admin.action(description="Пометить как успешно оплаченные вручную")
    def mark_as_succeeded_manual(self, request, queryset):
        count = 0
        activated_count = 0
        now = timezone.now()

        for payment in queryset:
            payment.status = Payment.Status.SUCCEEDED
            payment.paid_at = payment.paid_at or now
            payment.save(
                update_fields=[
                    "status",
                    "paid_at",
                    "updated_at",
                ]
            )
            count += 1

            if payment.subscription:
                activate_paid_subscription(payment.subscription)
                activated_count += 1

        self.message_user(
            request,
            (
                f"Успешными отмечено платежей: {count}. "
                f"Pro-доступ активирован по подпискам: {activated_count}."
            ),
            level=messages.SUCCESS,
        )

    @admin.action(description="Пометить как отмененные")
    def mark_as_canceled(self, request, queryset):
        updated = queryset.update(
            status=Payment.Status.CANCELED,
            updated_at=timezone.now(),
        )

        self.message_user(
            request,
            f"Отменено платежей: {updated}",
            level=messages.SUCCESS,
        )

    @admin.action(description="Пометить как ошибочные")
    def mark_as_failed(self, request, queryset):
        updated = queryset.update(
            status=Payment.Status.FAILED,
            updated_at=timezone.now(),
        )

        self.message_user(
            request,
            f"Ошибочных платежей отмечено: {updated}",
            level=messages.WARNING,
        )


@admin.register(PaymentWebhookEvent)
class PaymentWebhookEventAdmin(admin.ModelAdmin):
    list_display = (
        "received_at",
        "provider",
        "event_type",
        "status",
        "payment",
        "portal",
        "signature_status",
        "idempotency_key",
        "signature_fingerprint_display",
        "attempts_count",
    )
    list_filter = (
        "provider",
        "event_type",
        "status",
        "is_signature_valid",
        "received_at",
        "processed_at",
    )
    search_fields = (
        "provider",
        "event_id",
        "event_type",
        "payment__order_id",
        "portal__domain",
        "portal__member_id",
        "idempotency_key",
        "idempotency_key_hash",
        "signature_hash",
        "error_message",
    )
    readonly_fields = (
        "created_at",
        "updated_at",
        "deleted_at",
        "idempotency_key_fingerprint_display",
        "signature_fingerprint_display",
        "signature_status",
    )
    raw_id_fields = (
        "payment",
        "portal",
    )
    ordering = (
        "-received_at",
    )
    date_hierarchy = "received_at"

    fieldsets = (
        (
            "Webhook",
            {
                "fields": (
                    "provider",
                    "event_id",
                    "event_type",
                    "status",
                    "payment",
                    "portal",
                )
            },
        ),
        (
            "Безопасность",
            {
                "fields": (
                    "is_signature_valid",
                    "signature_status",
                    "idempotency_key_fingerprint_display",
                    "signature_fingerprint_display",
                )
            },
        ),
        (
            "Обработка",
            {
                "fields": (
                    "received_at",
                    "processed_at",
                    "attempts_count",
                    "error_message",
                )
            },
        ),
        (
            "Очищенный payload",
            {
                "fields": (
                    "payload",
                ),
                "classes": ("collapse",),
            },
        ),
        (
            "Мягкое удаление",
            {
                "fields": (
                    "is_deleted",
                    "deleted_at",
                ),
                "classes": ("collapse",),
            },
        ),
        (
            "Служебные даты",
            {
                "fields": (
                    "created_at",
                    "updated_at",
                )
            },
        ),
    )

    @admin.display(description="Подпись")
    def signature_status(self, obj):
        if not obj or not obj.pk:
            return "-"

        if obj.is_signature_valid:
            return status_badge("Валидна", "#027a48")

        return status_badge("Не проверена / неверна", "#b42318")

    @admin.display(description="Idempotency fingerprint")
    def idempotency_key_fingerprint_display(self, obj):
        if not obj or not obj.pk:
            return "-"

        return obj.idempotency_key_fingerprint or "-"

    @admin.display(description="Signature fingerprint")
    def signature_fingerprint_display(self, obj):
        if not obj or not obj.pk:
            return "-"

        return obj.signature_fingerprint or "-"


@admin.register(PortalAccess)
class PortalAccessAdmin(admin.ModelAdmin):
    list_display = (
        "portal",
        "access_level",
        "has_pro_display",
        "is_lifetime",
        "valid_until",
        "source",
        "last_checked_at",
    )
    list_filter = (
        "access_level",
        "has_pro",
        "is_lifetime",
        "valid_until",
        "source",
        "last_checked_at",
    )
    search_fields = (
        "portal__domain",
        "portal__member_id",
        "source",
    )
    readonly_fields = (
        "created_at",
        "updated_at",
        "deleted_at",
        "is_pro_valid_display",
    )
    raw_id_fields = (
        "portal",
        "subscription",
        "plan",
    )
    ordering = (
        "portal",
    )
    actions = (
        "sync_selected_access",
        "set_selected_free",
        "set_selected_blocked",
    )

    fieldsets = (
        (
            "Портал",
            {
                "fields": (
                    "portal",
                    "subscription",
                    "plan",
                )
            },
        ),
        (
            "Доступ",
            {
                "fields": (
                    "access_level",
                    "has_pro",
                    "is_lifetime",
                    "valid_until",
                    "source",
                    "is_pro_valid_display",
                    "last_checked_at",
                )
            },
        ),
        (
            "Функции и лимиты",
            {
                "fields": (
                    "features",
                    "limits",
                )
            },
        ),
        (
            "Мягкое удаление",
            {
                "fields": (
                    "is_deleted",
                    "deleted_at",
                ),
                "classes": ("collapse",),
            },
        ),
        (
            "Служебные даты",
            {
                "fields": (
                    "created_at",
                    "updated_at",
                )
            },
        ),
    )

    @admin.display(description="Pro")
    def has_pro_display(self, obj):
        if not obj or not obj.pk:
            return "-"

        return yes_no_badge(obj.has_pro)

    @admin.display(description="Pro-доступ действует")
    def is_pro_valid_display(self, obj):
        if not obj or not obj.pk:
            return "-"

        return yes_no_badge(obj.is_pro_valid)

    @admin.action(description="Синхронизировать из подписки")
    def sync_selected_access(self, request, queryset):
        count = 0

        for access in queryset:
            if access.subscription:
                sync_portal_access_from_subscription(access.subscription)
            else:
                set_free_access(access.portal)
            count += 1

        self.message_user(
            request,
            f"Синхронизировано доступов: {count}",
            level=messages.SUCCESS,
        )

    @admin.action(description="Перевести в Free")
    def set_selected_free(self, request, queryset):
        count = 0

        for access in queryset:
            set_free_access(
                portal=access.portal,
                subscription=access.subscription,
            )
            count += 1

        self.message_user(
            request,
            f"Переведено в Free: {count}",
            level=messages.SUCCESS,
        )

    @admin.action(description="Заблокировать доступ")
    def set_selected_blocked(self, request, queryset):
        count = 0

        for access in queryset:
            block_access(
                portal=access.portal,
                subscription=access.subscription,
                reason="admin_blocked",
            )
            count += 1

        self.message_user(
            request,
            f"Заблокировано доступов: {count}",
            level=messages.WARNING,
        )