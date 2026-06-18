"""
Код, который автоматически вычищает секреты до того, 
как данные попадут в БД, логи или raw payload.
"""

from copy import deepcopy
from typing import Any


FILTERED_VALUE = "[FILTERED]"


SENSITIVE_KEY_PARTS = (
    "authid",
    "refreshid",
    "accesstoken",
    "refreshtoken",
    "applicationtoken",
    "authtoken",
    "oauthtoken",
    "webhooktoken",
    "clientsecret",
    "secretkey",
    "password",
    "passwd",
    "signaturevalue",
    "signature",
    "appsid",
)


SENSITIVE_EXACT_KEYS = {
    "auth_id",
    "refresh_id",
    "access_token",
    "refresh_token",
    "application_token",
    "auth_token",
    "oauth_token",
    "client_secret",
    "secret_key",
    "password",
    "password1",
    "password2",
    "signature",
    "signature_value",
    "signaturevalue",
    "app_sid",
}


def normalize_key(key: Any) -> str:
    """
    Приводит ключ к безопасному виду для проверки.

    AUTH_ID -> authid
    access_token -> accesstoken
    application-token -> applicationtoken
    """

    return "".join(
        char.lower()
        for char in str(key)
        if char.isalnum()
    )


def is_sensitive_key(key: Any) -> bool:
    """
    Проверяет, похож ли ключ на секрет.

    Не используем слишком широкое правило по слову "token",
    чтобы случайно не вычищать безопасные поля вроде token_type.
    """

    raw_key = str(key).lower()
    normalized_key = normalize_key(key)

    if raw_key in SENSITIVE_EXACT_KEYS:
        return True

    return any(part in normalized_key for part in SENSITIVE_KEY_PARTS)


def sanitize_payload(payload: Any) -> Any:
    """
    Рекурсивно очищает payload от секретов.

    Использовать перед сохранением:
    - raw_install_payload;
    - raw_auth_payload;
    - webhook payload;
    - audit payload;
    - metadata;
    - логируемых данных.
    """

    safe_payload = deepcopy(payload)

    return _sanitize_value(safe_payload)


def _sanitize_value(value: Any) -> Any:
    if isinstance(value, dict):
        cleaned = {}

        for key, item in value.items():
            if is_sensitive_key(key):
                cleaned[key] = FILTERED_VALUE
            else:
                cleaned[key] = _sanitize_value(item)

        return cleaned

    if isinstance(value, list):
        return [_sanitize_value(item) for item in value]

    if isinstance(value, tuple):
        return [_sanitize_value(item) for item in value]

    return value


def sanitize_for_log(payload: Any) -> Any:
    """
    Отдельное название для логов.

    По логике делает то же самое, но по коду сразу понятно,
    что данные безопасны для logger.info / logger.warning.
    """

    return sanitize_payload(payload)