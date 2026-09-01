from django.urls import path

from apps.dashboard import views

app_name = "dashboard"

urlpatterns = [
    path("owner/bootstrap/", views.owner_dashboard_bootstrap_view, name="owner-bootstrap"),
    path("owner/catalog/", views.owner_catalog_view, name="owner-catalog"),
    path("owner/preview/", views.owner_preview_view, name="owner-preview"),
    path("owner/snapshot/save/", views.owner_snapshot_save_view, name="owner-snapshot-save"),
    path("owner/employees/", views.owner_employees_view, name="owner-employees"),
    path("owner/access/confirm/", views.owner_access_confirm_view, name="owner-access-confirm"),
    path("owner/access/end/", views.owner_access_end_view, name="owner-access-end"),
    path("owner/access/revoke-all/", views.owner_access_revoke_all_view, name="owner-access-revoke-all"),
]
