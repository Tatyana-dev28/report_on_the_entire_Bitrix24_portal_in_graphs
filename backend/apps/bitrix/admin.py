from django.contrib import admin
from django.utils import timezone
from django.utils.html import format_html

from apps.billing.models import Payment, PortalAccess, Subscription
from apps.bitrix.models import (
    BitrixAuthToken,
    BitrixEvent,
    BitrixPortal,
    PortalUser,
    SyncRun,
)
from apps.reports.models import CrmSource, ReportPreset, ReportSession, ReportState


def status_badge(text, color):
    return format_html('<span style="color: {};">{}</span>', color, text)


def yes_no_badge(value):
    if value:
        return status_badge("Да", "#027a48")

    return status_badge("Нет", "#b42318")


class BitrixAuthTokenInline(admin.StackedInline):
    model = BitrixAuthToken
    extra = 0
    max_num = 1
    can_delete = False
    show_change_link = True

    fields = (
        "auth_user_id",
        "auth_user_name",
        "token_status",
        "has_access_token_display",
        "access_token_fingerprint_display",
        "has_refresh_token_display",
        "refresh_token_fingerprint_display",
        "expires_at",
        "last_refresh_at",
        "scope",
        "updated_at",
    )
    readonly_fields = (
        "token_status",
        "has_access_token_display",
        "access_token_fingerprint_display",
        "has_refresh_token_display",
        "refresh_token_fingerprint_display",
        "updated_at",
    )

    @admin.display(description="Статус токена")
    def token_status(self, obj):
        if not obj or not obj.pk:
            return "-"

        if obj.is_expired:
            return status_badge("Истек", "#b42318")

        return status_badge("Активен", "#027a48")

    @admin.display(description="Access token сохранен")
    def has_access_token_display(self, obj):
        if not obj or not obj.pk:
            return "-"

        return yes_no_badge(obj.has_access_token)

    @admin.display(description="Access token fingerprint")
    def access_token_fingerprint_display(self, obj):
        if not obj or not obj.pk:
            return "-"

        return obj.access_token_fingerprint or "-"

    @admin.display(description="Refresh token сохранен")
    def has_refresh_token_display(self, obj):
        if not obj or not obj.pk:
            return "-"

        return yes_no_badge(obj.has_refresh_token)

    @admin.display(description="Refresh token fingerprint")
    def refresh_token_fingerprint_display(self, obj):
        if not obj or not obj.pk:
            return "-"

        return obj.refresh_token_fingerprint or "-"


class PortalAccessInline(admin.StackedInline):
    model = PortalAccess
    extra = 0
    max_num = 1
    can_delete = False
    show_change_link = True

    fields = (
        "access_level",
        "pro_status",
        "has_pro",
        "is_lifetime",
        "valid_until",
        "source",
        "features",
        "limits",
        "last_checked_at",
    )
    readonly_fields = (
        "pro_status",
        "last_checked_at",
    )

    @admin.display(description="Статус доступа")
    def pro_status(self, obj):
        if not obj or not obj.pk:
            return "-"

        if obj.is_pro_valid:
            if obj.access_level == PortalAccess.AccessLevel.INTERNAL:
                return status_badge("Внутренний Pro", "#175cd3")

            if obj.access_level == PortalAccess.AccessLevel.TRIAL:
                return status_badge("Trial активен", "#175cd3")

            return status_badge("Pro активен", "#027a48")

        if obj.access_level == PortalAccess.AccessLevel.BLOCKED:
            return status_badge("Заблокирован", "#b42318")

        return status_badge("Free", "#475467")


class SubscriptionInline(admin.TabularInline):
    model = Subscription
    extra = 0
    show_change_link = True

    fields = (
        "plan",
        "status",
        "provider",
        "pro_status",
        "trial_started_at",
        "trial_until",
        "paid_until",
        "is_lifetime",
        "created_at",
    )
    readonly_fields = (
        "pro_status",
        "created_at",
    )
    raw_id_fields = (
        "plan",
    )

    @admin.display(description="Pro")
    def pro_status(self, obj):
        if not obj or not obj.pk:
            return "-"

        if obj.has_pro_access:
            if obj.status == Subscription.Status.TRIAL:
                return status_badge("Trial", "#175cd3")

            return status_badge("Да", "#027a48")

        return status_badge("Нет", "#b42318")


class PaymentInline(admin.TabularInline):
    model = Payment
    extra = 0
    show_change_link = True

    fields = (
        "order_id",
        "plan",
        "provider",
        "status",
        "amount",
        "currency",
        "paid_at",
        "created_at",
    )
    readonly_fields = (
        "order_id",
        "provider",
        "status",
        "amount",
        "currency",
        "paid_at",
        "created_at",
    )
    raw_id_fields = (
        "plan",
    )


class PortalUserInline(admin.TabularInline):
    model = PortalUser
    extra = 0
    show_change_link = True

    fields = (
        "full_name",
        "bitrix_user_id",
        "email",
        "is_active",
        "is_admin",
        "is_extranet",
        "last_synced_at",
    )
    readonly_fields = (
        "full_name",
        "bitrix_user_id",
        "email",
        "is_admin",
        "is_extranet",
        "last_synced_at",
    )


class CrmSourceInline(admin.TabularInline):
    model = CrmSource
    extra = 0
    show_change_link = True

    fields = (
        "title",
        "source_type",
        "external_key",
        "entity_type_id",
        "category_id",
        "is_active",
        "is_available",
        "last_synced_at",
    )
    readonly_fields = (
        "external_key",
        "entity_type_id",
        "category_id",
        "last_synced_at",
    )


class ReportStateInline(admin.TabularInline):
    model = ReportState
    extra = 0
    show_change_link = True

    fields = (
        "bitrix_user_id",
        "user_name",
        "state_type",
        "state_key",
        "period_key",
        "is_active",
        "last_saved_at",
    )
    readonly_fields = (
        "bitrix_user_id",
        "user_name",
        "state_type",
        "state_key",
        "period_key",
        "last_saved_at",
    )


class ReportPresetInline(admin.TabularInline):
    model = ReportPreset
    extra = 0
    show_change_link = True

    fields = (
        "name",
        "is_default",
        "is_active",
        "created_by_name",
        "created_at",
    )
    readonly_fields = (
        "created_by_name",
        "created_at",
    )


class ReportSessionInline(admin.TabularInline):
    model = ReportSession
    extra = 0
    show_change_link = True

    fields = (
        "session_key_short",
        "bitrix_user_id",
        "user_name",
        "status",
        "period_key",
        "session_status",
        "last_activity_at",
        "expires_at",
        "last_calculated_at",
    )
    readonly_fields = (
        "session_key_short",
        "bitrix_user_id",
        "user_name",
        "status",
        "period_key",
        "session_status",
        "last_activity_at",
        "expires_at",
        "last_calculated_at",
    )

    @admin.display(description="Сессия")
    def session_key_short(self, obj):
        if not obj or not obj.pk:
            return "-"

        return str(obj.session_key)[:8]

    @admin.display(description="Статус")
    def session_status(self, obj):
        if not obj or not obj.pk:
            return "-"

        if obj.is_expired:
            return status_badge("Истекла", "#b42318")

        if obj.is_open:
            return status_badge("Открыта", "#027a48")

        return obj.get_status_display()


class SyncRunInline(admin.TabularInline):
    model = SyncRun
    extra = 0
    show_change_link = True

    fields = (
        "sync_type",
        "status",
        "started_at",
        "finished_at",
        "processed_count",
        "error_count",
        "created_at",
    )
    readonly_fields = (
        "sync_type",
        "status",
        "started_at",
        "finished_at",
        "processed_count",
        "error_count",
        "created_at",
    )


class BitrixEventInline(admin.TabularInline):
    model = BitrixEvent
    extra = 0
    show_change_link = True

    fields = (
        "event_name",
        "entity_type",
        "entity_id",
        "status",
        "received_at",
        "processed_at",
        "attempts_count",
    )
    readonly_fields = (
        "event_name",
        "entity_type",
        "entity_id",
        "status",
        "received_at",
        "processed_at",
        "attempts_count",
    )


@admin.register(BitrixPortal)
class BitrixPortalAdmin(admin.ModelAdmin):
    list_display = (
        "domain",
        "member_id",
        "status",
        "is_active",
        "access_summary",
        "has_application_token_display",
        "application_token_fingerprint_display",
        "language",
        "installed_at",
        "last_opened_at",
        "created_at",
    )
    list_filter = (
        "status",
        "is_active",
        "language",
        "installed_at",
        "last_opened_at",
        "created_at",
    )
    search_fields = (
        "domain",
        "member_id",
        "installed_by_user_id",
        "installed_by_user_name",
        "application_token_hash",
    )
    readonly_fields = (
        "public_id",
        "base_url",
        "access_summary",
        "has_application_token_display",
        "application_token_fingerprint_display",
        "created_at",
        "updated_at",
        "deleted_at",
    )
    ordering = (
        "domain",
    )
    date_hierarchy = "created_at"
    actions = (
        "mark_as_active",
        "mark_as_blocked",
        "mark_as_uninstalled",
    )

    inlines = (
        PortalAccessInline,
        BitrixAuthTokenInline,
        SubscriptionInline,
        PaymentInline,
        PortalUserInline,
        CrmSourceInline,
        ReportStateInline,
        ReportPresetInline,
        ReportSessionInline,
        SyncRunInline,
        BitrixEventInline,
    )

    fieldsets = (
        (
            "Портал",
            {
                "fields": (
                    "public_id",
                    "member_id",
                    "domain",
                    "protocol",
                    "base_url",
                    "status",
                    "is_active",
                    "access_summary",
                )
            },
        ),
        (
            "Endpoints",
            {
                "fields": (
                    "client_endpoint",
                    "server_endpoint",
                )
            },
        ),
        (
            "Установка",
            {
                "fields": (
                    "installed_at",
                    "uninstalled_at",
                    "last_opened_at",
                    "installed_by_user_id",
                    "installed_by_user_name",
                    "language",
                    "timezone",
                )
            },
        ),
        (
            "Безопасность",
            {
                "fields": (
                    "has_application_token_display",
                    "application_token_fingerprint_display",
                )
            },
        ),
        (
            "Очищенные исходные данные",
            {
                "fields": (
                    "raw_install_payload",
                ),
                "classes": ("collapse",),
                "description": (
                    "В этом блоке не должно быть AUTH_ID, REFRESH_ID, "
                    "application_token, access_token, refresh_token и других секретов."
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

    @admin.display(description="Доступ")
    def access_summary(self, obj):
        if not obj or not obj.pk:
            return "-"

        try:
            access = obj.access
        except PortalAccess.DoesNotExist:
            return status_badge("Доступ не создан", "#b42318")

        if access.is_pro_valid:
            if access.access_level == PortalAccess.AccessLevel.INTERNAL:
                return status_badge("Внутренний Pro", "#175cd3")

            if access.access_level == PortalAccess.AccessLevel.TRIAL:
                return status_badge("Trial", "#175cd3")

            return status_badge("Pro", "#027a48")

        if access.access_level == PortalAccess.AccessLevel.BLOCKED:
            return status_badge("Заблокирован", "#b42318")

        return status_badge("Free", "#475467")

    @admin.display(description="Application token сохранен")
    def has_application_token_display(self, obj):
        if not obj or not obj.pk:
            return "-"

        return yes_no_badge(obj.has_application_token)

    @admin.display(description="Application token fingerprint")
    def application_token_fingerprint_display(self, obj):
        if not obj or not obj.pk:
            return "-"

        return obj.application_token_fingerprint or "-"

    @admin.action(description="Пометить как активные")
    def mark_as_active(self, request, queryset):
        queryset.update(
            status=BitrixPortal.Status.ACTIVE,
            is_active=True,
            uninstalled_at=None,
        )

    @admin.action(description="Заблокировать")
    def mark_as_blocked(self, request, queryset):
        queryset.update(
            status=BitrixPortal.Status.BLOCKED,
            is_active=False,
        )

    @admin.action(description="Пометить как удаленные")
    def mark_as_uninstalled(self, request, queryset):
        queryset.update(
            status=BitrixPortal.Status.UNINSTALLED,
            is_active=False,
            uninstalled_at=timezone.now(),
        )


@admin.register(BitrixAuthToken)
class BitrixAuthTokenAdmin(admin.ModelAdmin):
    list_display = (
        "portal",
        "auth_user_id",
        "auth_user_name",
        "token_status",
        "has_access_token_display",
        "access_token_fingerprint_display",
        "has_refresh_token_display",
        "refresh_token_fingerprint_display",
        "expires_at",
        "last_refresh_at",
        "updated_at",
    )
    list_filter = (
        "expires_at",
        "last_refresh_at",
        "created_at",
        "updated_at",
    )
    search_fields = (
        "portal__domain",
        "portal__member_id",
        "auth_user_id",
        "auth_user_name",
        "scope",
        "access_token_hash",
        "refresh_token_hash",
    )
    readonly_fields = (
        "created_at",
        "updated_at",
        "deleted_at",
        "token_status",
        "has_access_token_display",
        "access_token_fingerprint_display",
        "has_refresh_token_display",
        "refresh_token_fingerprint_display",
    )
    raw_id_fields = (
        "portal",
    )
    ordering = (
        "expires_at",
    )

    fieldsets = (
        (
            "Портал",
            {
                "fields": (
                    "portal",
                    "auth_user_id",
                    "auth_user_name",
                )
            },
        ),
        (
            "Безопасность токенов",
            {
                "fields": (
                    "has_access_token_display",
                    "access_token_fingerprint_display",
                    "has_refresh_token_display",
                    "refresh_token_fingerprint_display",
                    "token_status",
                    "expires_at",
                    "last_refresh_at",
                )
            },
        ),
        (
            "Права доступа",
            {
                "fields": (
                    "token_type",
                    "scope",
                )
            },
        ),
        (
            "Очищенные исходные данные",
            {
                "fields": (
                    "raw_auth_payload",
                ),
                "classes": ("collapse",),
                "description": (
                    "В этом блоке не должно быть AUTH_ID, REFRESH_ID, "
                    "access_token, refresh_token и других секретов."
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

    @admin.display(description="Статус токена")
    def token_status(self, obj):
        if obj.is_expired:
            return status_badge("Истек", "#b42318")

        return status_badge("Активен", "#027a48")

    @admin.display(description="Access token сохранен")
    def has_access_token_display(self, obj):
        return yes_no_badge(obj.has_access_token)

    @admin.display(description="Access token fingerprint")
    def access_token_fingerprint_display(self, obj):
        return obj.access_token_fingerprint or "-"

    @admin.display(description="Refresh token сохранен")
    def has_refresh_token_display(self, obj):
        return yes_no_badge(obj.has_refresh_token)

    @admin.display(description="Refresh token fingerprint")
    def refresh_token_fingerprint_display(self, obj):
        return obj.refresh_token_fingerprint or "-"


@admin.register(PortalUser)
class PortalUserAdmin(admin.ModelAdmin):
    list_display = (
        "full_name",
        "bitrix_user_id",
        "portal",
        "email",
        "is_active",
        "is_admin",
        "is_extranet",
        "last_synced_at",
    )
    list_filter = (
        "is_active",
        "is_admin",
        "is_extranet",
        "last_synced_at",
        "created_at",
    )
    search_fields = (
        "full_name",
        "name",
        "last_name",
        "second_name",
        "email",
        "bitrix_user_id",
        "portal__domain",
        "portal__member_id",
    )
    readonly_fields = (
        "created_at",
        "updated_at",
        "deleted_at",
    )
    raw_id_fields = (
        "portal",
    )
    ordering = (
        "portal",
        "full_name",
    )


@admin.register(SyncRun)
class SyncRunAdmin(admin.ModelAdmin):
    list_display = (
        "portal",
        "sync_type",
        "status",
        "date_from",
        "date_to",
        "started_at",
        "finished_at",
        "processed_count",
        "error_count",
        "created_at",
    )
    list_filter = (
        "sync_type",
        "status",
        "started_at",
        "finished_at",
        "created_at",
    )
    search_fields = (
        "portal__domain",
        "portal__member_id",
        "celery_task_id",
        "triggered_by_user_id",
        "error_message",
    )
    readonly_fields = (
        "created_at",
        "updated_at",
        "deleted_at",
    )
    raw_id_fields = (
        "portal",
    )
    ordering = (
        "-created_at",
    )
    date_hierarchy = "created_at"


@admin.register(BitrixEvent)
class BitrixEventAdmin(admin.ModelAdmin):
    list_display = (
        "received_at",
        "portal",
        "event_name",
        "entity_type",
        "entity_id",
        "status",
        "attempts_count",
        "processed_at",
    )
    list_filter = (
        "event_name",
        "entity_type",
        "status",
        "received_at",
        "processed_at",
        "created_at",
    )
    search_fields = (
        "portal__domain",
        "portal__member_id",
        "event_name",
        "entity_type",
        "entity_id",
        "idempotency_key",
        "error_message",
    )
    readonly_fields = (
        "created_at",
        "updated_at",
        "deleted_at",
    )
    raw_id_fields = (
        "portal",
        "sync_run",
    )
    ordering = (
        "-received_at",
    )
    date_hierarchy = "received_at"