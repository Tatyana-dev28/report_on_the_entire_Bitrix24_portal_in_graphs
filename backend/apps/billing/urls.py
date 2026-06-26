from django.urls import path

from apps.billing import views


urlpatterns = [
    path("access/", views.billing_access_view, name="billing-access"),
    path("payments/", views.create_payment_view, name="billing-create-payment"),
    path("robokassa/result/", views.robokassa_result_view, name="robokassa-result"),
    path("robokassa/success/", views.robokassa_success_view, name="robokassa-success"),
    path("robokassa/fail/", views.robokassa_fail_view, name="robokassa-fail"),
]
