from django.urls import path

from apps.bitrix import views

app_name = "bitrix"

urlpatterns = [
    path("install/", views.bitrix_install_view, name="install"),
    path("app/", views.bitrix_app_view, name="app"),
]