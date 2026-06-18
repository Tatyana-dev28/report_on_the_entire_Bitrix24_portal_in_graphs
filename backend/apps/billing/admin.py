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


@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "code",
        "billing_period",
        "price",
        "currency",
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
        "created_at",
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
                    "billing_period",
                    "duration_months",
                    "price",
                    "currency",
                )
            },
        ),
        (
            "Доступность",
            {
                "fields": (
                    "is_public",
                    "is_default",
                    "is_active",
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
                "description": (
                    "Для Free: save_report_state=false, save_report_presets=false, "
                    "save_report_results=false. Для Pro: save_report_state=true, "
                    "save_report_presets=true, save_report_results=false."
                ),
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
        "is_lifetime",
        "paid_until",
        "started_at",
        "created_at",
    )
    list_filter = (
        "status",
        "provider",
        "is_lifetime",
        "auto_renew",
        "paid_until",
        "trial_started_at",
        "trial_until",
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
        "activate_trial_14_days",
        "activate_lifetime_manual",
        "cancel_subscriptions",
        "mark_as_expired",
    )

    fieldsets = (
        (
            "Подписка",
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
            "Сроки подписки",
            {
                "fields": (
                    "started_at",
                    "paid_until",
                    "canceled_at",
                    "is_lifetime",
                    "auto_renew",
                )
            },
        ),
        (
            "Пробный период",
            {
                "fields": (
                    "trial_started_at",
                    "trial_until",
                ),
                "description": (
                    "Здесь можно вручную задать любой промежуток бесплатного Pro-периода. "
                    "Для trial нужно поставить status=trial и provider=manual."
                ),
            },
        ),
        (
            "Провайдер и ручная выдача",
            {
                "fields": (
                    "provider_subscription_id",
                    "manual_reason",
                    "admin_comment",
                )
            },
        ),
        (
            "Дополнительно",
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
        if obj.has_pro_access:
            if obj.status == Subscription.Status.TRIAL:
                return format_html('<span style="color: #175cd3;">Trial активен</span>')

            return format_html('<span style="color: #027a48;">Pro активен</span>')

        if obj.status == Subscription.Status.FREE:
            return format_html('<span style="color: #475467;">Free</span>')

        return format_html('<span style="color: #b42318;">Pro неактивен</span>')

    @admin.display(description="Trial")
    def trial_period(self, obj):
        if not obj.trial_started_at and not obj.trial_until:
            return "-"

        started = obj.trial_started_at.strftime("%d.%m.%Y") if obj.trial_started_at else "не указано"
        until = obj.trial_until.strftime("%d.%m.%Y") if obj.trial_until else "не указано"

        return f"{started} — {until}"

    @admin.action(description="Выдать Trial на 14 дней")
    def activate_trial_14_days(self, request, queryset):
        now = timezone.now()
        updated = queryset.update(
            status=Subscription.Status.TRIAL,
            provider=Subscription.Provider.MANUAL,
            trial_started_at=now,
            trial_until=now + timedelta(days=14),
            paid_until=None,
            canceled_at=None,
            is_lifetime=False,
            manual_reason="trial_14_days_admin",
        )
        self.message_user(
            request,
            f"Trial на 14 дней выдан для подписок: {updated}.",
            messages.SUCCESS,
        )

    @admin.action(description="Выдать бессрочный Manual Pro")
    def activate_lifetime_manual(self, request, queryset):
        updated = queryset.update(
            status=Subscription.Status.ACTIVE,
            provider=Subscription.Provider.MANUAL,
            is_lifetime=True,
            started_at=timezone.now(),
            paid_until=None,
            trial_started_at=None,
            trial_until=None,
            canceled_at=None,
            manual_reason="manual_lifetime_admin",
        )
        self.message_user(
            request,
            f"Бессрочный Manual Pro выдан для подписок: {updated}.",
            messages.SUCCESS,
        )

    @admin.action(description="Отменить подписки")
    def cancel_subscriptions(self, request, queryset):
        updated = queryset.update(
            status=Subscription.Status.CANCELED,
            canceled_at=timezone.now(),
            is_lifetime=False,
            auto_renew=False,
        )
        self.message_user(
            request,
            f"Подписки отменены: {updated}.",
            messages.WARNING,
        )

    @admin.action(description="Пометить как истекшие")
    def mark_as_expired(self, request, queryset):
        updated = queryset.update(
            status=Subscription.Status.EXPIRED,
            is_lifetime=False,
            auto_renew=False,
        )
        self.message_user(
            request,
            f"Подписки помечены как истекшие: {updated}.",
            messages.WARNING,
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
        "provider_payment_id",
        "provider_invoice_id",
        "portal__domain",
        "portal__member_id",
        "plan__code",
        "plan__name",
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
            "Данные Robokassa",
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

    @admin.action(description="Пометить как оплаченные вручную")
    def mark_as_succeeded_manual(self, request, queryset):
        updated = queryset.update(
            status=Payment.Status.SUCCEEDED,
            provider=Payment.Provider.MANUAL,
            paid_at=timezone.now(),
        )
        self.message_user(
            request,
            f"Платежи помечены как оплаченные вручную: {updated}.",
            messages.SUCCESS,
        )

    @admin.action(description="Отменить платежи")
    def mark_as_canceled(self, request, queryset):
        updated = queryset.update(status=Payment.Status.CANCELED)
        self.message_user(
            request,
            f"Платежи отменены: {updated}.",
            messages.WARNING,
        )

    @admin.action(description="Пометить платежи как ошибочные")
    def mark_as_failed(self, request, queryset):
        updated = queryset.update(status=Payment.Status.FAILED)
        self.message_user(
            request,
            f"Платежи помечены как ошибочные: {updated}.",
            messages.ERROR,
        )


@admin.register(PaymentWebhookEvent)
class PaymentWebhookEventAdmin(admin.ModelAdmin):
    list_display = (
        "received_at",
        "provider",
        "event_type",
        "status",
        "is_signature_valid",
        "payment",
        "portal",
        "attempts_count",
        "processed_at",
    )
    list_filter = (
        "provider",
        "event_type",
        "status",
        "is_signature_valid",
        "received_at",
        "processed_at",
        "created_at",
    )
    search_fields = (
        "idempotency_key",
        "event_id",
        "event_type",
        "payment__order_id",
        "payment__provider_payment_id",
        "portal__domain",
        "portal__member_id",
        "error_message",
    )
    readonly_fields = (
        "created_at",
        "updated_at",
        "deleted_at",
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
                    "idempotency_key",
                    "event_id",
                    "event_type",
                    "status",
                    "is_signature_valid",
                )
            },
        ),
        (
            "Связи",
            {
                "fields": (
                    "payment",
                    "portal",
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
            "Payload",
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


@admin.register(PortalAccess)
class PortalAccessAdmin(admin.ModelAdmin):
    list_display = (
        "portal",
        "access_level",
        "pro_status",
        "has_pro",
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
        "created_at",
    )
    search_fields = (
        "portal__domain",
        "portal__member_id",
        "source",
        "plan__code",
        "plan__name",
    )
    readonly_fields = (
        "pro_status",
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
        "portal",
    )
    actions = (
        "set_internal_pro",
        "set_trial_access",
        "set_free_access",
        "block_access",
    )

    fieldsets = (
        (
            "Портал и доступ",
            {
                "fields": (
                    "portal",
                    "subscription",
                    "plan",
                    "access_level",
                    "pro_status",
                    "has_pro",
                    "is_lifetime",
                    "valid_until",
                    "source",
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
                "description": (
                    "Pro сохраняет настройки и фильтры. "
                    "Результаты отчета не сохраняются ни на Free, ни на Pro."
                ),
            },
        ),
        (
            "Проверка",
            {
                "fields": (
                    "last_checked_at",
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

    @admin.display(description="Статус доступа")
    def pro_status(self, obj):
        if obj.is_pro_valid:
            if obj.access_level == PortalAccess.AccessLevel.INTERNAL:
                return format_html('<span style="color: #175cd3;">Внутренний Pro</span>')

            if obj.access_level == PortalAccess.AccessLevel.TRIAL:
                return format_html('<span style="color: #175cd3;">Trial активен</span>')

            return format_html('<span style="color: #027a48;">Pro активен</span>')

        if obj.access_level == PortalAccess.AccessLevel.BLOCKED:
            return format_html('<span style="color: #b42318;">Заблокирован</span>')

        return format_html('<span style="color: #475467;">Free</span>')

    @admin.action(description="Выдать внутренний бессрочный Pro")
    def set_internal_pro(self, request, queryset):
        updated = queryset.update(
            access_level=PortalAccess.AccessLevel.INTERNAL,
            has_pro=True,
            is_lifetime=True,
            valid_until=None,
            source="internal_company",
            features={
                "save_report_state": True,
                "save_report_presets": True,
                "save_report_results": False,
            },
            last_checked_at=timezone.now(),
        )
        self.message_user(
            request,
            f"Внутренний бессрочный Pro выдан порталам: {updated}.",
            messages.SUCCESS,
        )

    @admin.action(description="Выдать Trial-доступ на 14 дней")
    def set_trial_access(self, request, queryset):
        valid_until = timezone.now() + timedelta(days=14)

        updated = queryset.update(
            access_level=PortalAccess.AccessLevel.TRIAL,
            has_pro=True,
            is_lifetime=False,
            valid_until=valid_until,
            source="trial_admin",
            features={
                "save_report_state": True,
                "save_report_presets": True,
                "save_report_results": False,
            },
            last_checked_at=timezone.now(),
        )
        self.message_user(
            request,
            f"Trial-доступ выдан порталам: {updated}.",
            messages.SUCCESS,
        )

    @admin.action(description="Перевести на Free")
    def set_free_access(self, request, queryset):
        updated = queryset.update(
            access_level=PortalAccess.AccessLevel.FREE,
            has_pro=False,
            is_lifetime=False,
            valid_until=None,
            source="free",
            features={
                "save_report_state": False,
                "save_report_presets": False,
                "save_report_results": False,
            },
            last_checked_at=timezone.now(),
        )
        self.message_user(
            request,
            f"Порталы переведены на Free: {updated}.",
            messages.WARNING,
        )

    @admin.action(description="Заблокировать доступ")
    def block_access(self, request, queryset):
        updated = queryset.update(
            access_level=PortalAccess.AccessLevel.BLOCKED,
            has_pro=False,
            is_lifetime=False,
            valid_until=None,
            source="admin_blocked",
            last_checked_at=timezone.now(),
        )
        self.message_user(
            request,
            f"Доступ заблокирован для порталов: {updated}.",
            messages.ERROR,
        )
