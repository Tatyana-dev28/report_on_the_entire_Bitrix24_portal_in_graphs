from django.urls import path

from apps.dashboard import views

app_name = "dashboard"

urlpatterns = [
    path("owner/bootstrap/", views.owner_dashboard_bootstrap_view, name="owner-bootstrap"),
    path("owner/launch-link/", views.owner_launch_link_view, name="owner-launch-link"),
    path("owner/catalog/", views.owner_catalog_view, name="owner-catalog"),
    path("owner/preview/", views.owner_preview_view, name="owner-preview"),
    path("owner/snapshot/save/", views.owner_snapshot_save_view, name="owner-snapshot-save"),
    path("owner/employees/", views.owner_employees_view, name="owner-employees"),
    path("owner/refresh/", views.owner_refresh_view, name="owner-refresh"),
    path("owner/refresh-interval/", views.owner_refresh_interval_view, name="owner-refresh-interval"),
    path("owner/access/confirm/", views.owner_access_confirm_view, name="owner-access-confirm"),
    path("owner/access/end/", views.owner_access_end_view, name="owner-access-end"),
    path("owner/access/revoke-all/", views.owner_access_revoke_all_view, name="owner-access-revoke-all"),
    path("owner/share-links/", views.owner_share_links_view, name="owner-share-links"),
    path("owner/share-links/list/", views.owner_share_links_list_view, name="owner-share-links-list"),
    path("owner/share-links/disable/", views.owner_share_link_disable_view, name="owner-share-link-disable"),
    path("share/open/", views.share_open_view, name="share-open"),
    path("share/bootstrap/", views.share_bootstrap_view, name="share-bootstrap"),
    path("share/catalog/", views.share_catalog_view, name="share-catalog"),
    path("share/preview/", views.share_preview_view, name="share-preview"),
    path("share/employees/", views.share_employees_view, name="share-employees"),
]
