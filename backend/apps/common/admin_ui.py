from django.utils.html import format_html, format_html_join


COLOR_TO_TONE = {
    "#027a48": "success",
    "#b42318": "danger",
    "#175cd3": "info",
    "#475467": "neutral",
    "#b54708": "warning",
}


def product_badge(text, tone="neutral"):
    return format_html(
        '<span class="product-badge product-badge--{}">{}</span>',
        tone,
        text,
    )


def status_badge(text, color):
    return product_badge(text, COLOR_TO_TONE.get(color, "neutral"))


def money_display(amount, currency="RUB"):
    if amount is None:
        return "-"

    return format_html(
        '<span class="product-money">{} {}</span>',
        amount,
        currency,
    )


def feature_summary_badges(features):
    features = features or {}
    items = []

    if features.get("save_report_state"):
        items.append(("Отображения", "success"))
    if features.get("save_report_presets"):
        items.append(("Фильтры", "success"))

    if not features.get("save_report_results", False):
        items.append(("Отчеты без БД", "neutral"))

    if not items:
        items.append(("Базовый доступ", "neutral"))

    return format_html_join(
        " ",
        "{}",
        ((product_badge(label, tone),) for label, tone in items),
    )
