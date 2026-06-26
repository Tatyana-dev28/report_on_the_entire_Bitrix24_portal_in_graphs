from decimal import Decimal

from django.core.management.base import BaseCommand

from apps.billing.models import Plan


class Command(BaseCommand):
    help = "Create or update default billing plans."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset-defaults",
            action="store_true",
            help="Overwrite existing plans with default values. Use only for local reset.",
        )

    def handle(self, *args, **options):
        reset_defaults = options.get("reset_defaults", False)
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
            plan, created = Plan.objects.get_or_create(
                code=plan_data["code"],
                defaults=plan_data["defaults"],
            )

            if not created and reset_defaults:
                for field, value in plan_data["defaults"].items():
                    setattr(plan, field, value)
                plan.save(update_fields=[*plan_data["defaults"].keys(), "updated_at"])

            action = "Created" if created else ("Reset" if reset_defaults else "Kept")
            self.stdout.write(self.style.SUCCESS(f"{action} plan: {plan.code}"))

        self.stdout.write(self.style.SUCCESS("Default billing plans are ready."))
