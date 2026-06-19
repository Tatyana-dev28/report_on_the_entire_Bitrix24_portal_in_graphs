from django.urls import path

from apps.reports import views

app_name = "reports"

urlpatterns = [
    path("catalog/", views.report_catalog_view, name="catalog"),
    path("preview/", views.report_preview_view, name="preview"),
]