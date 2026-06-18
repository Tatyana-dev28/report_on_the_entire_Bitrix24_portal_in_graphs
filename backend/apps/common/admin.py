from django.contrib import admin
from django.utils.html import format_html

from apps.common.models import AuditLog, IdempotencyKey, SystemSetting, TaskLock


@admin.register(SystemSetting)
class SystemSettingAdmin(admin.ModelAdmin):
    list_display = (
        "key",
        "is_active",
        "updated_at",
        "created_at",
    )
    list_filter = (
        "is_active",
        "created_at",
        "updated_at",
    )
    search_fields = (
        "key",
        "description",
    )
    readonly_fields = (
        "created_at",
        "updated_at",
    )
    ordering = (
        "key",
    )

    fieldsets = (
        (
            "Основное",
            {
                "fields": (
                    "key",
                    "value",
                    "description",
                    "is_active",
                )
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


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = (
        "created_at",
        "portal_member_id",
        "actor_type",
        "actor_id",
        "action",
        "entity_type",
        "entity_id",
    )
    list_filter = (
        "actor_type",
        "action",
        "entity_type",
        "created_at",
    )
    search_fields = (
        "portal_member_id",
        "actor_id",
        "action",
        "entity_type",
        "entity_id",
    )
    readonly_fields = (
        "created_at",
        "portal_member_id",
        "actor_type",
        "actor_id",
        "action",
        "entity_type",
        "entity_id",
        "payload",
        "ip_address",
        "user_agent",
    )
    ordering = (
        "-created_at",
    )
    date_hierarchy = "created_at"

    fieldsets = (
        (
            "Событие",
            {
                "fields": (
                    "created_at",
                    "portal_member_id",
                    "action",
                    "actor_type",
                    "actor_id",
                )
            },
        ),
        (
            "Сущность",
            {
                "fields": (
                    "entity_type",
                    "entity_id",
                )
            },
        ),
        (
            "Данные",
            {
                "fields": (
                    "payload",
                    "ip_address",
                    "user_agent",
                )
            },
        ),
    )

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(IdempotencyKey)
class IdempotencyKeyAdmin(admin.ModelAdmin):
    list_display = (
        "key_short",
        "scope",
        "portal_member_id",
        "status",
        "locked_until",
        "completed_at",
        "expires_at",
        "created_at",
    )
    list_filter = (
        "scope",
        "status",
        "created_at",
        "completed_at",
        "expires_at",
    )
    search_fields = (
        "key",
        "scope",
        "portal_member_id",
        "request_hash",
        "error_message",
    )
    readonly_fields = (
        "created_at",
        "updated_at",
    )
    ordering = (
        "-created_at",
    )
    date_hierarchy = "created_at"

    fieldsets = (
        (
            "Основное",
            {
                "fields": (
                    "key",
                    "scope",
                    "portal_member_id",
                    "request_hash",
                    "status",
                )
            },
        ),
        (
            "Блокировка и сроки",
            {
                "fields": (
                    "locked_until",
                    "completed_at",
                    "expires_at",
                )
            },
        ),
        (
            "Результат",
            {
                "fields": (
                    "response_payload",
                    "error_message",
                )
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

    @admin.display(description="Ключ")
    def key_short(self, obj):
        if len(obj.key) <= 40:
            return obj.key

        return f"{obj.key[:40]}..."


@admin.register(TaskLock)
class TaskLockAdmin(admin.ModelAdmin):
    list_display = (
        "key",
        "owner",
        "lock_status",
        "locked_until",
        "updated_at",
        "created_at",
    )
    list_filter = (
        "locked_until",
        "created_at",
        "updated_at",
    )
    search_fields = (
        "key",
        "owner",
    )
    readonly_fields = (
        "created_at",
        "updated_at",
    )
    ordering = (
        "key",
    )

    fieldsets = (
        (
            "Основное",
            {
                "fields": (
                    "key",
                    "owner",
                    "locked_until",
                    "metadata",
                )
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

    @admin.display(description="Статус")
    def lock_status(self, obj):
        if obj.is_locked:
            return format_html('<span style="color: #b42318;">Заблокировано</span>')

        return format_html('<span style="color: #027a48;">Свободно</span>')