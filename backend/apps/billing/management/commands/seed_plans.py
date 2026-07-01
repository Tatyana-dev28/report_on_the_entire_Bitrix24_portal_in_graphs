from decimal import Decimal

from django.core.management.base import BaseCommand

from apps.billing.models import Plan


PRO_FEATURES = {
    "save_report_state": True,
    "save_report_presets": True,
    "save_report_results": False,
}

PRO_LIMITS = {
    "max_presets": 20,
    "max_saved_states": 20,
}


def build_paid_plan(
    *,
    code: str,
    name: str,
    description: str,
    bitrix_version: str,
    tariff_group: str,
    users: int,
    sort_order: int,
    price: str = "0.00",
) -> dict:
    return {
        "code": code,
        "defaults": {
            "name": name,
            "description": description,
            "price": Decimal(price),
            "currency": "RUB",
            "billing_period": Plan.BillingPeriod.MONTH,
            "duration_months": 1,
            "features": dict(PRO_FEATURES),
            "limits": {
                **PRO_LIMITS,
                "bitrix_version": bitrix_version,
                "tariff_group": tariff_group,
                "users": users,
            },
            "is_public": True,
            "is_default": False,
            "is_active": True,
            "sort_order": sort_order,
        },
    }


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
                    "price": Decimal("0.00"),
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

        plans.extend(
            [
                build_paid_plan(
                    code="cloud_basic_5",
                    name="Облако: Базовый",
                    description="Облачная версия Битрикс24, базовый тариф для небольших порталов до 5 пользователей.",
                    bitrix_version="cloud",
                    tariff_group="basic",
                    users=5,
                    sort_order=110,
                ),
                build_paid_plan(
                    code="cloud_standard_50",
                    name="Облако: Стандартный",
                    description="Облачная версия Битрикс24, стандартный тариф до 50 пользователей.",
                    bitrix_version="cloud",
                    tariff_group="standard",
                    users=50,
                    sort_order=120,
                ),
                build_paid_plan(
                    code="cloud_professional_100",
                    name="Облако: Профессиональный",
                    description="Облачная версия Битрикс24, профессиональный тариф до 100 пользователей.",
                    bitrix_version="cloud",
                    tariff_group="professional",
                    users=100,
                    sort_order=130,
                ),
                build_paid_plan(
                    code="cloud_enterprise_250",
                    name="Облако: Энтерпрайз 250",
                    description="Облачная версия Битрикс24, тариф Энтерпрайз до 250 пользователей.",
                    bitrix_version="cloud",
                    tariff_group="enterprise",
                    users=250,
                    sort_order=140,
                ),
                build_paid_plan(
                    code="cloud_enterprise_1000",
                    name="Облако: Энтерпрайз 1000",
                    description="Облачная версия Битрикс24, тариф Энтерпрайз до 1000 пользователей.",
                    bitrix_version="cloud",
                    tariff_group="enterprise",
                    users=1000,
                    sort_order=150,
                ),
                build_paid_plan(
                    code="cloud_enterprise_2000",
                    name="Облако: Энтерпрайз 2000",
                    description="Облачная версия Битрикс24, тариф Энтерпрайз до 2000 пользователей.",
                    bitrix_version="cloud",
                    tariff_group="enterprise",
                    users=2000,
                    sort_order=160,
                ),
                build_paid_plan(
                    code="box_shop_crm_12",
                    name="Коробка: Интернет-магазин + CRM",
                    description="Коробочная версия Битрикс24, Интернет-магазин + CRM до 12 пользователей.",
                    bitrix_version="box",
                    tariff_group="shop_crm",
                    users=12,
                    sort_order=210,
                ),
                build_paid_plan(
                    code="box_portal_50",
                    name="Коробка: Корпоративный портал 50",
                    description="Коробочная версия Битрикс24, корпоративный портал до 50 пользователей.",
                    bitrix_version="box",
                    tariff_group="portal",
                    users=50,
                    sort_order=220,
                ),
                build_paid_plan(
                    code="box_portal_100",
                    name="Коробка: Корпоративный портал 100",
                    description="Коробочная версия Битрикс24, корпоративный портал до 100 пользователей.",
                    bitrix_version="box",
                    tariff_group="portal",
                    users=100,
                    sort_order=230,
                ),
                build_paid_plan(
                    code="box_portal_250",
                    name="Коробка: Корпоративный портал 250",
                    description="Коробочная версия Битрикс24, корпоративный портал до 250 пользователей.",
                    bitrix_version="box",
                    tariff_group="portal",
                    users=250,
                    sort_order=240,
                ),
                build_paid_plan(
                    code="box_portal_500",
                    name="Коробка: Корпоративный портал 500",
                    description="Коробочная версия Битрикс24, корпоративный портал до 500 пользователей.",
                    bitrix_version="box",
                    tariff_group="portal",
                    users=500,
                    sort_order=250,
                ),
                *[
                    build_paid_plan(
                        code=f"box_enterprise_{users}",
                        name=f"Коробка: Энтерпрайз {users}",
                        description=f"Коробочная версия Битрикс24, Энтерпрайз до {users} пользователей.",
                        bitrix_version="box",
                        tariff_group="enterprise",
                        users=users,
                        sort_order=300 + index * 10,
                    )
                    for index, users in enumerate(range(1000, 10001, 1000), start=1)
                ],
            ]
        )

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
