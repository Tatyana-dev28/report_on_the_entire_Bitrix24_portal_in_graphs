from decimal import Decimal

from django.core.management.base import BaseCommand

from apps.billing.models import Plan


FREE_FEATURES = {
    "save_report_state": False,
    "save_report_presets": False,
    "save_report_results": False,
}

PRO_FEATURES = {
    "save_report_state": True,
    "save_report_presets": True,
    "save_report_results": False,
}

FREE_LIMITS = {
    "max_presets": 0,
    "max_saved_states": 0,
}

PRO_LIMITS = {
    "max_presets": 20,
    "max_saved_states": 20,
}


def build_plan(
    *,
    code: str,
    name: str,
    description: str,
    bitrix_version: str,
    tariff_group: str,
    users: int | None,
    sort_order: int,
    is_purchasable: bool,
    has_pro_features: bool | None = None,
    price: str = "0.00",
) -> dict:
    has_pro_features = is_purchasable if has_pro_features is None else has_pro_features
    features = dict(PRO_FEATURES if has_pro_features else FREE_FEATURES)
    limits = dict(PRO_LIMITS if has_pro_features else FREE_LIMITS)
    limits.update(
        {
            "bitrix_version": bitrix_version,
            "tariff_group": tariff_group,
            "users": users or 0,
        }
    )

    return {
        "code": code,
        "defaults": {
            "name": name,
            "description": description,
            "price": Decimal(price),
            "currency": "RUB",
            "billing_period": (
                Plan.BillingPeriod.MONTH
                if has_pro_features
                else Plan.BillingPeriod.FREE
            ),
            "duration_months": 1 if is_purchasable else None,
            "features": features,
            "limits": limits,
            "is_public": is_purchasable or code == "free",
            "is_default": code == "free",
            "is_active": True,
            "sort_order": sort_order,
        },
    }


def default_plans() -> list[dict]:
    plans = [
        build_plan(
            code="free",
            name="Бесплатный тариф",
            description=(
                "В бесплатном тарифе не сохраняются выставленные настройки и фильтры. "
                "При выходе из приложения параметры будут сбрасываться."
            ),
            bitrix_version="free",
            tariff_group="free",
            users=None,
            sort_order=10,
            is_purchasable=False,
        ),
        build_plan(
            code="pro_monthly",
            name="Pro monthly",
            description=(
                "Legacy monthly Pro plan. Kept for existing subscriptions and manual fallback."
            ),
            bitrix_version="legacy",
            tariff_group="legacy",
            users=0,
            sort_order=20,
            is_purchasable=False,
            has_pro_features=True,
        ),
        build_plan(
            code="internal_pro",
            name="Internal Pro",
            description="Hidden internal Pro plan for manual admin access.",
            bitrix_version="internal",
            tariff_group="internal",
            users=0,
            sort_order=30,
            is_purchasable=False,
            has_pro_features=True,
        ),
    ]

    plans.extend(
        [
            build_plan(
                code="cloud_basic_5",
                name="Базовый тариф",
                description="Для небольших облачных порталов.",
                bitrix_version="cloud",
                tariff_group="basic",
                users=5,
                sort_order=110,
                is_purchasable=True,
            ),
            build_plan(
                code="cloud_standard_50",
                name="Стандартный тариф",
                description="Облачный тариф для порталов до 50 пользователей.",
                bitrix_version="cloud",
                tariff_group="standard",
                users=50,
                sort_order=120,
                is_purchasable=True,
            ),
            build_plan(
                code="cloud_professional_100",
                name="Профессиональный тариф",
                description="Облачный тариф для порталов до 100 пользователей.",
                bitrix_version="cloud",
                tariff_group="professional",
                users=100,
                sort_order=130,
                is_purchasable=True,
            ),
            build_plan(
                code="cloud_enterprise_250",
                name="Энтерпрайз 250",
                description="Облачный тариф Энтерпрайз до 250 пользователей.",
                bitrix_version="cloud",
                tariff_group="enterprise",
                users=250,
                sort_order=140,
                is_purchasable=True,
            ),
            build_plan(
                code="cloud_enterprise_1000",
                name="Энтерпрайз 1000",
                description="Облачный тариф Энтерпрайз до 1000 пользователей.",
                bitrix_version="cloud",
                tariff_group="enterprise",
                users=1000,
                sort_order=150,
                is_purchasable=True,
            ),
            build_plan(
                code="cloud_enterprise_2000",
                name="Энтерпрайз 2000",
                description="Облачный тариф Энтерпрайз до 2000 пользователей.",
                bitrix_version="cloud",
                tariff_group="enterprise",
                users=2000,
                sort_order=160,
                is_purchasable=True,
            ),
            build_plan(
                code="box_shop_crm_12",
                name="Интернет-магазин + CRM",
                description="Коробочная версия Интернет-магазин + CRM до 12 пользователей.",
                bitrix_version="box",
                tariff_group="shop_crm",
                users=12,
                sort_order=210,
                is_purchasable=True,
            ),
            build_plan(
                code="box_corporate_50",
                name="Корпоративный портал 50",
                description="Коробочный корпоративный портал до 50 пользователей.",
                bitrix_version="box",
                tariff_group="corporate",
                users=50,
                sort_order=220,
                is_purchasable=True,
            ),
            build_plan(
                code="box_corporate_100",
                name="Корпоративный портал 100",
                description="Коробочный корпоративный портал до 100 пользователей.",
                bitrix_version="box",
                tariff_group="corporate",
                users=100,
                sort_order=230,
                is_purchasable=True,
            ),
            build_plan(
                code="box_corporate_250",
                name="Корпоративный портал 250",
                description="Коробочный корпоративный портал до 250 пользователей.",
                bitrix_version="box",
                tariff_group="corporate",
                users=250,
                sort_order=240,
                is_purchasable=True,
            ),
            build_plan(
                code="box_corporate_500",
                name="Корпоративный портал 500",
                description="Коробочный корпоративный портал до 500 пользователей.",
                bitrix_version="box",
                tariff_group="corporate",
                users=500,
                sort_order=250,
                is_purchasable=True,
            ),
        ]
    )

    plans.extend(
        [
            build_plan(
                code=f"box_enterprise_{users}",
                name=f"Энтерпрайз {users}",
                description=f"Коробочный Энтерпрайз до {users} пользователей.",
                bitrix_version="box",
                tariff_group="enterprise",
                users=users,
                sort_order=300 + index * 10,
                is_purchasable=True,
            )
            for index, users in enumerate(range(1000, 10001, 1000), start=1)
        ]
    )

    return plans


class Command(BaseCommand):
    help = "Create or update default billing plans without overwriting admin prices."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset-defaults",
            action="store_true",
            help="Overwrite existing plans including price. Use only for explicit reset.",
        )

    def handle(self, *args, **options):
        reset_defaults = options.get("reset_defaults", False)

        for plan_data in default_plans():
            plan, created = Plan.objects.get_or_create(
                code=plan_data["code"],
                defaults=plan_data["defaults"],
            )

            changed_fields: list[str] = []

            if not created:
                update_defaults = dict(plan_data["defaults"])

                if not reset_defaults:
                    update_defaults.pop("price", None)

                for field, value in update_defaults.items():
                    if getattr(plan, field) == value:
                        continue
                    setattr(plan, field, value)
                    changed_fields.append(field)

                if changed_fields:
                    plan.save(update_fields=[*changed_fields, "updated_at"])

            if created:
                action = "Created"
            elif changed_fields:
                action = "Reset" if reset_defaults else "Updated"
            else:
                action = "Kept"

            self.stdout.write(self.style.SUCCESS(f"{action} plan: {plan.code}"))

        self.stdout.write(self.style.SUCCESS("Default billing plans are ready."))
