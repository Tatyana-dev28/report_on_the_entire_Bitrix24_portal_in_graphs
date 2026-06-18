from datetime import timedelta
from typing import Optional

from django.db import transaction
from django.utils import timezone

from apps.billing.models import Plan, PortalAccess, Subscription
from apps.bitrix.models import BitrixPortal


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


def get_plan_by_code(code: str) -> Optional[Plan]:
    """
    Возвращает активный тариф по коду.

    Если тарифы еще не созданы, вернет None.
    Позже мы создадим seed_plans, и тарифы будут появляться автоматически.
    """

    return Plan.objects.filter(code=code, is_active=True).first()


def get_free_plan() -> Optional[Plan]:
    return get_plan_by_code("free")


def get_pro_monthly_plan() -> Optional[Plan]:
    return get_plan_by_code("pro_monthly")


def get_internal_pro_plan() -> Optional[Plan]:
    return get_plan_by_code("internal_pro")


def get_default_features_for_plan(plan: Optional[Plan]) -> dict:
    """
    Возвращает features для тарифа.

    Если в тарифе уже заполнены features через админку/seed,
    берем их. Если нет — используем безопасные значения по умолчанию.
    """

    if plan and plan.features:
        features = dict(plan.features)
    elif plan and plan.code in ("pro_monthly", "internal_pro"):
        features = dict(PRO_FEATURES)
    else:
        features = dict(FREE_FEATURES)

    features["save_report_results"] = False

    return features


def get_default_limits_for_plan(plan: Optional[Plan]) -> dict:
    """
    Возвращает limits для тарифа.
    """

    if plan and plan.limits:
        return dict(plan.limits)

    if plan and plan.code in ("pro_monthly", "internal_pro"):
        return dict(PRO_LIMITS)

    return dict(FREE_LIMITS)


def get_access_level_for_subscription(subscription: Optional[Subscription]) -> str:
    """
    Определяет уровень доступа по подписке.
    """

    if not subscription:
        return PortalAccess.AccessLevel.FREE

    if subscription.status == Subscription.Status.BLOCKED:
        return PortalAccess.AccessLevel.BLOCKED

    if subscription.status == Subscription.Status.TRIAL:
        return PortalAccess.AccessLevel.TRIAL

    if subscription.provider == Subscription.Provider.MANUAL and subscription.has_pro_access:
        return PortalAccess.AccessLevel.INTERNAL

    if subscription.has_pro_access:
        return PortalAccess.AccessLevel.PRO

    return PortalAccess.AccessLevel.FREE


def get_valid_until_for_subscription(subscription: Optional[Subscription]):
    """
    Возвращает дату окончания доступа.
    """

    if not subscription:
        return None

    if subscription.is_lifetime:
        return None

    if subscription.status == Subscription.Status.TRIAL:
        return subscription.trial_until

    if subscription.status == Subscription.Status.ACTIVE:
        return subscription.paid_until

    return None


@transaction.atomic
def sync_portal_access_from_subscription(subscription: Subscription) -> PortalAccess:
    """
    Главная функция синхронизации.

    Берет Subscription и приводит PortalAccess к правильному состоянию.
    Ее будут вызывать:
    - админка;
    - trial/manual actions;
    - будущий Robokassa webhook;
    - будущие фоновые проверки истечения подписок.
    """

    access_level = get_access_level_for_subscription(subscription)
    has_pro = subscription.has_pro_access
    valid_until = get_valid_until_for_subscription(subscription)

    if access_level == PortalAccess.AccessLevel.BLOCKED:
        has_pro = False

    features = get_default_features_for_plan(subscription.plan)
    limits = get_default_limits_for_plan(subscription.plan)

    if not has_pro:
        features = dict(FREE_FEATURES)
        limits = dict(FREE_LIMITS)

    access, _ = PortalAccess.objects.update_or_create(
        portal=subscription.portal,
        defaults={
            "subscription": subscription,
            "plan": subscription.plan,
            "access_level": access_level,
            "has_pro": has_pro,
            "is_lifetime": subscription.is_lifetime,
            "valid_until": valid_until,
            "features": features,
            "limits": limits,
            "source": subscription.provider,
            "last_checked_at": timezone.now(),
        },
    )

    return access


@transaction.atomic
def set_free_access(
    portal: BitrixPortal,
    subscription: Optional[Subscription] = None,
) -> PortalAccess:
    """
    Переводит портал на Free-доступ.

    Используется:
    - при первой установке;
    - при истечении Pro;
    - при отмене подписки;
    - если платеж не прошел.
    """

    free_plan = get_free_plan()

    if subscription:
        subscription.status = Subscription.Status.FREE
        subscription.provider = Subscription.Provider.NONE
        subscription.paid_until = None
        subscription.trial_started_at = None
        subscription.trial_until = None
        subscription.canceled_at = None
        subscription.is_lifetime = False
        subscription.auto_renew = False

        if free_plan:
            subscription.plan = free_plan

        update_fields = [
            "status",
            "provider",
            "paid_until",
            "trial_started_at",
            "trial_until",
            "canceled_at",
            "is_lifetime",
            "auto_renew",
            "updated_at",
        ]

        if free_plan:
            update_fields.append("plan")

        subscription.save(update_fields=update_fields)

    access, _ = PortalAccess.objects.update_or_create(
        portal=portal,
        defaults={
            "subscription": subscription,
            "plan": free_plan,
            "access_level": PortalAccess.AccessLevel.FREE,
            "has_pro": False,
            "is_lifetime": False,
            "valid_until": None,
            "features": dict(FREE_FEATURES),
            "limits": dict(FREE_LIMITS),
            "source": "free",
            "last_checked_at": timezone.now(),
        },
    )

    return access


@transaction.atomic
def activate_trial(
    subscription: Subscription,
    days: int = 14,
    trial_started_at=None,
    trial_until=None,
) -> PortalAccess:
    """
    Включает trial для портала.

    Trial дает Pro-возможности, поэтому переводим подписку на pro_monthly,
    если такой тариф уже создан.
    """

    now = timezone.now()
    pro_plan = get_pro_monthly_plan()

    if trial_started_at is None:
        trial_started_at = now

    if trial_until is None:
        trial_until = trial_started_at + timedelta(days=days)

    if pro_plan:
        subscription.plan = pro_plan

    subscription.status = Subscription.Status.TRIAL
    subscription.provider = Subscription.Provider.MANUAL
    subscription.trial_started_at = trial_started_at
    subscription.trial_until = trial_until
    subscription.started_at = subscription.started_at or now
    subscription.paid_until = None
    subscription.is_lifetime = False
    subscription.auto_renew = False
    subscription.manual_reason = "trial"

    update_fields = [
        "status",
        "provider",
        "trial_started_at",
        "trial_until",
        "started_at",
        "paid_until",
        "is_lifetime",
        "auto_renew",
        "manual_reason",
        "updated_at",
    ]

    if pro_plan:
        update_fields.append("plan")

    subscription.save(update_fields=update_fields)

    return sync_portal_access_from_subscription(subscription)


@transaction.atomic
def activate_manual_pro(
    subscription: Subscription,
    paid_until=None,
    is_lifetime: bool = False,
    manual_reason: str = "manual",
    admin_comment: str = "",
) -> PortalAccess:
    """
    Включает Manual Pro через админку.

    Для ручного Pro используем internal_pro, если он создан.
    Если его еще нет — fallback на pro_monthly.
    """

    now = timezone.now()
    internal_plan = get_internal_pro_plan()
    pro_plan = get_pro_monthly_plan()
    target_plan = internal_plan or pro_plan

    if target_plan:
        subscription.plan = target_plan

    subscription.status = Subscription.Status.ACTIVE
    subscription.provider = Subscription.Provider.MANUAL
    subscription.started_at = subscription.started_at or now
    subscription.paid_until = None if is_lifetime else paid_until
    subscription.trial_started_at = None
    subscription.trial_until = None
    subscription.is_lifetime = is_lifetime
    subscription.auto_renew = False
    subscription.manual_reason = manual_reason

    if admin_comment:
        subscription.admin_comment = admin_comment

    update_fields = [
        "status",
        "provider",
        "started_at",
        "paid_until",
        "trial_started_at",
        "trial_until",
        "is_lifetime",
        "auto_renew",
        "manual_reason",
        "admin_comment",
        "updated_at",
    ]

    if target_plan:
        update_fields.append("plan")

    subscription.save(update_fields=update_fields)

    return sync_portal_access_from_subscription(subscription)


@transaction.atomic
def activate_paid_subscription(
    subscription: Subscription,
    paid_until=None,
) -> PortalAccess:
    """
    Включает платную Pro-подписку.

    Эту функцию потом будет вызывать Robokassa webhook
    после успешной оплаты.
    """

    now = timezone.now()
    pro_plan = get_pro_monthly_plan()

    if paid_until is None:
        paid_until = now + timedelta(days=30)

    if pro_plan:
        subscription.plan = pro_plan

    subscription.status = Subscription.Status.ACTIVE
    subscription.provider = Subscription.Provider.ROBOKASSA
    subscription.started_at = subscription.started_at or now
    subscription.paid_until = paid_until
    subscription.trial_started_at = None
    subscription.trial_until = None
    subscription.is_lifetime = False
    subscription.auto_renew = False

    update_fields = [
        "status",
        "provider",
        "started_at",
        "paid_until",
        "trial_started_at",
        "trial_until",
        "is_lifetime",
        "auto_renew",
        "updated_at",
    ]

    if pro_plan:
        update_fields.append("plan")

    subscription.save(update_fields=update_fields)

    return sync_portal_access_from_subscription(subscription)


@transaction.atomic
def cancel_subscription(
    subscription: Subscription,
) -> PortalAccess:
    """
    Отменяет подписку и переводит портал в Free.
    """

    subscription.status = Subscription.Status.CANCELED
    subscription.canceled_at = timezone.now()
    subscription.auto_renew = False
    subscription.is_lifetime = False

    subscription.save(
        update_fields=[
            "status",
            "canceled_at",
            "auto_renew",
            "is_lifetime",
            "updated_at",
        ]
    )

    return set_free_access(subscription.portal, subscription=subscription)


@transaction.atomic
def expire_subscription(
    subscription: Subscription,
) -> PortalAccess:
    """
    Помечает подписку истекшей и переводит портал в Free.
    """

    subscription.status = Subscription.Status.EXPIRED
    subscription.auto_renew = False
    subscription.is_lifetime = False

    subscription.save(
        update_fields=[
            "status",
            "auto_renew",
            "is_lifetime",
            "updated_at",
        ]
    )

    return set_free_access(subscription.portal, subscription=subscription)


@transaction.atomic
def block_access(
    portal: BitrixPortal,
    subscription: Optional[Subscription] = None,
    reason: str = "blocked",
) -> PortalAccess:
    """
    Блокирует доступ портала.
    """

    if subscription:
        subscription.status = Subscription.Status.BLOCKED
        subscription.manual_reason = reason
        subscription.auto_renew = False
        subscription.save(
            update_fields=[
                "status",
                "manual_reason",
                "auto_renew",
                "updated_at",
            ]
        )

    access, _ = PortalAccess.objects.update_or_create(
        portal=portal,
        defaults={
            "subscription": subscription,
            "plan": subscription.plan if subscription else None,
            "access_level": PortalAccess.AccessLevel.BLOCKED,
            "has_pro": False,
            "is_lifetime": False,
            "valid_until": None,
            "features": dict(FREE_FEATURES),
            "limits": dict(FREE_LIMITS),
            "source": reason,
            "last_checked_at": timezone.now(),
        },
    )

    return access