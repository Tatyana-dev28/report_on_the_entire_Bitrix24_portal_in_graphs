from decimal import Decimal

from django.core.management.base import BaseCommand

from apps.billing.models import Plan


class Command(BaseCommand):
    help = "Create or update default billing plans."

    def handle(self, *args, **options):
        plans = [
            {
                "code": "free",
                "defaults": {
                    "name": "Free",
                    "description": (
                        "Бесплатный тариф. Настройки и фильтры не сохраняются "
                        "после выхода из приложения."
                    ),
                    "price": Decimal("0.00"),
                    "currency": "RUB",
                    "billing_period": Plan.BillingPeriod.FREE,
                    "duration_months": None,
                    "features": {
                        "save_report_state": False,
                        "save_report_presets": False,
                        "save_report_results": False,
                    },
                    "limits": {
                        "max_presets": 0,
                        "max_saved_states": 0,
                    },
                    "is_public": True,
                    "is_default": True,
                    "is_active": True,
                    "sort_order": 10,
                },
            },
            {
                "code": "pro_monthly",
                "defaults": {
                    "name": "Pro monthly",
                    "description": (
                        "Платный месячный тариф. Сохраняет настройки и фильтры "
                        "для сотрудников портала. Результаты отчетов не сохраняются."
                    ),
                    "price": Decimal("990.00"),
                    "currency": "RUB",
                    "billing_period": Plan.BillingPeriod.MONTH,
                    "duration_months": 1,
                    "features": {
                        "save_report_state": True,
                        "save_report_presets": True,
                        "save_report_results": False,
                    },
                    "limits": {
                        "max_presets": 20,
                        "max_saved_states": 20,
                    },
                    "is_public": True,
                    "is_default": False,
                    "is_active": True,
                    "sort_order": 20,
                },
            },
            {
                "code": "internal_pro",
                "defaults": {
                    "name": "Internal Pro",
                    "description": (
                        "Скрытый внутренний Pro-тариф для ручной выдачи доступа "
                        "через админку: тесты, сотрудники компании, партнеры."
                    ),
                    "price": Decimal("0.00"),
                    "currency": "RUB",
                    "billing_period": Plan.BillingPeriod.MONTH,
                    "duration_months": None,
                    "features": {
                        "save_report_state": True,
                        "save_report_presets": True,
                        "save_report_results": False,
                    },
                    "limits": {
                        "max_presets": 20,
                        "max_saved_states": 20,
                    },
                    "is_public": False,
                    "is_default": False,
                    "is_active": True,
                    "sort_order": 30,
                },
            },
        ]

        for plan_data in plans:
            plan, created = Plan.objects.update_or_create(
                code=plan_data["code"],
                defaults=plan_data["defaults"],
            )

            action = "Created" if created else "Updated"
            self.stdout.write(self.style.SUCCESS(f"{action} plan: {plan.code}"))

        self.stdout.write(self.style.SUCCESS("Default billing plans are ready."))