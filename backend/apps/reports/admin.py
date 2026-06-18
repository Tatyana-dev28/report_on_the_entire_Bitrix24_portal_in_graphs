from django.contrib import admin, messages
from django.utils import timezone
from django.utils.html import format_html

from apps.reports.models import (
    CrmSource,
    Metric,
    MetricSection,
    ReportBuild,
    ReportPreset,
    ReportSession,
    ReportState,
)


@admin.register(CrmSource)
class CrmSourceAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "source_label",
        "portal",
        "source_type",
        "external_key",
        "entity_type_id",
        "category_id",
        "is_active",
        "is_available",
        "last_synced_at",
    )
    list_filter = (
        "source_type",
        "is_active",
        "is_available",
        "last_synced_at",
        "created_at",
    )
    search_fields = (
        "title",
        "source_label",
        "external_key",
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
        "source_type",
        "category_id",
        "title",
    )

    fieldsets = (
        (
            "Портал и источник",
            {
                "fields": (
                    "portal",
                    "external_key",
                    "source_type",
                    "entity_type_id",
                    "category_id",
                )
            },
        ),
        (
            "Название и доступность",
            {
                "fields": (
                    "title",
                    "source_label",
                    "is_active",
                    "is_available",
                    "last_synced_at",
                )
            },
        ),
        (
            "Исходные данные",
            {
                "fields": (
                    "raw_data",
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


@admin.register(MetricSection)
class MetricSectionAdmin(admin.ModelAdmin):
    list_display = (
        "label",
        "code",
        "sort_order",
        "is_active",
        "updated_at",
    )
    list_filter = (
        "is_active",
        "created_at",
        "updated_at",
    )
    search_fields = (
        "code",
        "label",
        "description",
    )
    readonly_fields = (
        "created_at",
        "updated_at",
        "deleted_at",
    )
    ordering = (
        "sort_order",
        "label",
    )

    fieldsets = (
        (
            "Раздел",
            {
                "fields": (
                    "code",
                    "label",
                    "description",
                    "sort_order",
                    "is_active",
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


@admin.register(Metric)
class MetricAdmin(admin.ModelAdmin):
    list_display = (
        "label",
        "code",
        "section",
        "value_type",
        "calculation_key",
        "is_pro",
        "is_active",
        "sort_order",
    )
    list_filter = (
        "section",
        "value_type",
        "is_pro",
        "is_active",
        "created_at",
    )
    search_fields = (
        "code",
        "label",
        "description",
        "calculation_key",
    )
    readonly_fields = (
        "created_at",
        "updated_at",
        "deleted_at",
    )
    raw_id_fields = (
        "section",
    )
    ordering = (
        "section__sort_order",
        "sort_order",
        "label",
    )

    fieldsets = (
        (
            "Метрика",
            {
                "fields": (
                    "section",
                    "code",
                    "label",
                    "description",
                    "value_type",
                    "unit",
                    "sort_order",
                    "is_active",
                    "is_pro",
                )
            },
        ),
        (
            "Расчет",
            {
                "fields": (
                    "calculation_key",
                    "source_types",
                    "default_settings",
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


@admin.register(ReportState)
class ReportStateAdmin(admin.ModelAdmin):
    list_display = (
        "portal",
        "bitrix_user_id",
        "user_name",
        "state_type",
        "state_key",
        "period_key",
        "is_active",
        "last_saved_at",
        "updated_at",
    )
    list_filter = (
        "state_type",
        "period_key",
        "is_active",
        "last_saved_at",
        "created_at",
        "updated_at",
    )
    search_fields = (
        "portal__domain",
        "portal__member_id",
        "bitrix_user_id",
        "user_name",
        "state_key",
        "filters_hash",
    )
    readonly_fields = (
        "public_id",
        "created_at",
        "updated_at",
        "deleted_at",
    )
    raw_id_fields = (
        "portal",
        "user",
    )
    ordering = (
        "portal",
        "bitrix_user_id",
        "state_key",
    )
    date_hierarchy = "last_saved_at"

    fieldsets = (
        (
            "Портал и пользователь",
            {
                "fields": (
                    "public_id",
                    "portal",
                    "user",
                    "bitrix_user_id",
                    "user_name",
                    "is_active",
                )
            },
        ),
        (
            "Состояние отчета",
            {
                "fields": (
                    "state_type",
                    "state_key",
                    "period_key",
                    "state",
                    "filters_hash",
                    "last_saved_at",
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


@admin.register(ReportSession)
class ReportSessionAdmin(admin.ModelAdmin):
    list_display = (
        "session_key_short",
        "portal",
        "bitrix_user_id",
        "user_name",
        "status",
        "period_key",
        "session_status",
        "last_activity_at",
        "expires_at",
        "last_calculated_at",
        "result_size_bytes",
    )
    list_filter = (
        "status",
        "period_key",
        "opened_at",
        "last_activity_at",
        "last_calculated_at",
        "expires_at",
        "created_at",
    )
    search_fields = (
        "session_key",
        "portal__domain",
        "portal__member_id",
        "bitrix_user_id",
        "user_name",
        "filters_hash",
        "cache_key",
        "error_message",
    )
    readonly_fields = (
        "session_status",
        "created_at",
        "updated_at",
        "deleted_at",
    )
    raw_id_fields = (
        "portal",
        "user",
    )
    ordering = (
        "-opened_at",
    )
    date_hierarchy = "opened_at"
    actions = (
        "mark_as_active",
        "mark_as_closed",
        "mark_as_expired",
    )

    fieldsets = (
        (
            "Сессия",
            {
                "fields": (
                    "session_key",
                    "portal",
                    "user",
                    "bitrix_user_id",
                    "user_name",
                    "status",
                    "session_status",
                )
            },
        ),
        (
            "Настройки и cache",
            {
                "fields": (
                    "period_key",
                    "state_snapshot",
                    "filters_hash",
                    "cache_key",
                    "cache_ttl_seconds",
                    "result_size_bytes",
                )
            },
        ),
        (
            "Активность",
            {
                "fields": (
                    "opened_at",
                    "last_activity_at",
                    "last_calculated_at",
                    "closed_at",
                    "expires_at",
                )
            },
        ),
        (
            "Дополнительно",
            {
                "fields": (
                    "metadata",
                    "error_message",
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

    @admin.display(description="Сессия")
    def session_key_short(self, obj):
        return str(obj.session_key)[:8]

    @admin.display(description="Статус сессии")
    def session_status(self, obj):
        if obj.is_expired:
            return format_html('<span style="color: #b42318;">Истекла</span>')

        if obj.is_open:
            return format_html('<span style="color: #027a48;">Открыта</span>')

        if obj.status == ReportSession.Status.CLOSED:
            return format_html('<span style="color: #475467;">Закрыта</span>')

        return obj.get_status_display()

    @admin.action(description="Пометить как активные")
    def mark_as_active(self, request, queryset):
        updated = queryset.update(
            status=ReportSession.Status.ACTIVE,
            last_activity_at=timezone.now(),
        )
        self.message_user(
            request,
            f"Сессии помечены как активные: {updated}.",
            messages.SUCCESS,
        )

    @admin.action(description="Пометить как закрытые")
    def mark_as_closed(self, request, queryset):
        updated = queryset.update(
            status=ReportSession.Status.CLOSED,
            closed_at=timezone.now(),
        )
        self.message_user(
            request,
            f"Сессии помечены как закрытые: {updated}.",
            messages.WARNING,
        )

    @admin.action(description="Пометить как истекшие")
    def mark_as_expired(self, request, queryset):
        updated = queryset.update(
            status=ReportSession.Status.EXPIRED,
            expires_at=timezone.now(),
        )
        self.message_user(
            request,
            f"Сессии помечены как истекшие: {updated}.",
            messages.WARNING,
        )


@admin.register(ReportPreset)
class ReportPresetAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "portal",
        "is_default",
        "is_active",
        "created_by_name",
        "created_at",
        "updated_at",
    )
    list_filter = (
        "is_default",
        "is_active",
        "created_at",
        "updated_at",
    )
    search_fields = (
        "name",
        "portal__domain",
        "portal__member_id",
        "created_by_name",
        "created_by_bitrix_user_id",
    )
    readonly_fields = (
        "public_id",
        "created_at",
        "updated_at",
        "deleted_at",
    )
    raw_id_fields = (
        "portal",
        "created_by",
    )
    ordering = (
        "portal",
        "name",
    )

    fieldsets = (
        (
            "Отчет",
            {
                "fields": (
                    "public_id",
                    "portal",
                    "name",
                    "settings",
                    "is_default",
                    "is_active",
                )
            },
        ),
        (
            "Создатель",
            {
                "fields": (
                    "created_by",
                    "created_by_bitrix_user_id",
                    "created_by_name",
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


@admin.register(ReportBuild)
class ReportBuildAdmin(admin.ModelAdmin):
    list_display = (
        "portal",
        "session",
        "period_key",
        "date_from",
        "date_to",
        "status",
        "requested_by_bitrix_user_id",
        "cache_key_short",
        "started_at",
        "finished_at",
        "created_at",
    )
    list_filter = (
        "period_key",
        "status",
        "date_from",
        "date_to",
        "started_at",
        "finished_at",
        "created_at",
    )
    search_fields = (
        "portal__domain",
        "portal__member_id",
        "requested_by_bitrix_user_id",
        "celery_task_id",
        "filters_hash",
        "cache_key",
        "error_message",
    )
    readonly_fields = (
        "created_at",
        "updated_at",
        "deleted_at",
    )
    raw_id_fields = (
        "portal",
        "session",
        "requested_by",
    )
    ordering = (
        "-created_at",
    )
    date_hierarchy = "created_at"

    fieldsets = (
        (
            "Запрос",
            {
                "fields": (
                    "portal",
                    "session",
                    "requested_by",
                    "requested_by_bitrix_user_id",
                    "period_key",
                    "date_from",
                    "date_to",
                )
            },
        ),
        (
            "Параметры",
            {
                "fields": (
                    "sources",
                    "metrics",
                    "options",
                    "filters_hash",
                )
            },
        ),
        (
            "Временный результат",
            {
                "fields": (
                    "cache_key",
                )
            },
        ),
        (
            "Выполнение",
            {
                "fields": (
                    "status",
                    "celery_task_id",
                    "started_at",
                    "finished_at",
                    "error_message",
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

    @admin.display(description="Cache key")
    def cache_key_short(self, obj):
        if not obj.cache_key:
            return "-"

        if len(obj.cache_key) <= 40:
            return obj.cache_key

        return f"{obj.cache_key[:40]}..."
