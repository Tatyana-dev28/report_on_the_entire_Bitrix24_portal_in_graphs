from django.urls import path

from apps.reports import views

app_name = "reports"

urlpatterns = [
    path("catalog/", views.report_catalog_view, name="catalog"),
    path("preview/", views.report_preview_view, name="preview"),
    path("preview/<uuid:session_key>/", views.report_preview_status_view, name="preview-status"),
    path("employees/", views.report_employees_view, name="employees"),
    path("settings/", views.report_settings_load_view, name="settings-load"),
    path("settings/save/", views.report_settings_save_view, name="settings-save"),
]
