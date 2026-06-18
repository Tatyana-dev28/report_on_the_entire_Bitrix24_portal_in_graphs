from django.contrib import admin
from django.utils import timezone
from django.utils.html import format_html

from apps.bitrix.models import (
    BitrixAuthToken,
    BitrixEvent,
    BitrixPortal,
    PortalUser,
    SyncRun,
)


@admin.register(BitrixPortal)
class BitrixPortalAdmin(admin.ModelAdmin):
    list_display = (
        "domain",
        "member_id",
        "status",
        "is_active",
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
    )
    readonly_fields = (
        "public_id",
        "base_url",
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
            "Токены и исходные данные",
            {
                "fields": (
                    "application_token_encrypted",
                    "raw_install_payload",
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
    )
    readonly_fields = (
        "created_at",
        "updated_at",
        "deleted_at",
        "token_status",
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
            "Токены",
            {
                "fields": (
                    "access_token_encrypted",
                    "refresh_token_encrypted",
                    "token_type",
                    "scope",
                    "expires_at",
                    "last_refresh_at",
                    "token_status",
                )
            },
        ),
        (
            "Исходные данные",
            {
                "fields": (
                    "raw_auth_payload",
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

    @admin.display(description="Статус токена")
    def token_status(self, obj):
        if obj.is_expired:
            return format_html('<span style="color: #b42318;">Истек</span>')

        return format_html('<span style="color: #027a48;">Активен</span>')


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

    fieldsets = (
        (
            "Портал",
            {
                "fields": (
                    "portal",
                    "bitrix_user_id",
                    "is_active",
                )
            },
        ),
        (
            "Пользователь",
            {
                "fields": (
                    "name",
                    "last_name",
                    "second_name",
                    "full_name",
                    "email",
                    "avatar_url",
                    "position",
                )
            },
        ),
        (
            "Отделы и права",
            {
                "fields": (
                    "department_ids",
                    "department_names",
                    "is_admin",
                    "is_extranet",
                )
            },
        ),
        (
            "Синхронизация",
            {
                "fields": (
                    "last_synced_at",
                    "raw_data",
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

    fieldsets = (
        (
            "Портал и тип",
            {
                "fields": (
                    "portal",
                    "sync_type",
                    "status",
                    "triggered_by_user_id",
                    "celery_task_id",
                )
            },
        ),
        (
            "Период",
            {
                "fields": (
                    "date_from",
                    "date_to",
                )
            },
        ),
        (
            "Выполнение",
            {
                "fields": (
                    "started_at",
                    "finished_at",
                    "processed_count",
                    "created_count",
                    "updated_count",
                    "skipped_count",
                    "error_count",
                    "error_message",
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

    fieldsets = (
        (
            "Событие",
            {
                "fields": (
                    "portal",
                    "event_name",
                    "entity_type",
                    "entity_id",
                    "idempotency_key",
                    "status",
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
                    "sync_run",
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
