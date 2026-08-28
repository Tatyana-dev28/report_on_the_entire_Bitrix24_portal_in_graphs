from django.contrib import admin

from apps.dashboard.models import (
    DashboardAccessSession,
    DashboardPreparedSnapshot,
    DashboardRefreshRun,
    DashboardShareLink,
)


@admin.register(DashboardAccessSession)
class DashboardAccessSessionAdmin(admin.ModelAdmin):
    list_display = (
        "portal",
        "bitrix_user_id",
        "is_trusted_device",
        "is_active",
        "last_seen_at",
        "ended_at",
        "revoked_at",
    )
    list_filter = ("is_trusted_device", "is_active", "revoked_at", "ended_at")
    search_fields = ("portal__domain", "bitrix_user_id", "user_name", "device_label")
    readonly_fields = ("public_id", "created_at", "updated_at")


@admin.register(DashboardPreparedSnapshot)
class DashboardPreparedSnapshotAdmin(admin.ModelAdmin):
    list_display = (
        "portal",
        "prepared_at",
        "is_current",
        "refresh_interval_minutes",
        "payload_size_bytes",
    )
    list_filter = ("is_current", "refresh_interval_minutes")
    search_fields = ("portal__domain",)
    readonly_fields = ("public_id", "created_at", "updated_at")


@admin.register(DashboardRefreshRun)
class DashboardRefreshRunAdmin(admin.ModelAdmin):
    list_display = (
        "portal",
        "trigger_type",
        "status",
        "refresh_interval_minutes",
        "started_at",
        "finished_at",
        "next_planned_at",
    )
    list_filter = ("trigger_type", "status", "refresh_interval_minutes")
    search_fields = ("portal__domain", "requested_by_bitrix_user_id", "error_message")
    readonly_fields = ("created_at", "updated_at")


@admin.register(DashboardShareLink)
class DashboardShareLinkAdmin(admin.ModelAdmin):
    list_display = (
        "portal",
        "report_id",
        "report_name",
        "is_active",
        "expires_at",
        "disabled_at",
    )
    list_filter = ("is_active", "expires_at", "disabled_at")
    search_fields = ("portal__domain", "report_id", "report_name", "token_fingerprint")
    readonly_fields = ("public_id", "created_at", "updated_at")
