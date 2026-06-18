"""
Сервис шифрования и дешифрования данных.
"""

import hashlib
import hmac
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured


ENCRYPTION_PREFIX = "enc:v1:"


def _get_encryption_key() -> str:
    key = getattr(settings, "FIELD_ENCRYPTION_KEY", "")

    if not key:
        raise ImproperlyConfigured(
            "FIELD_ENCRYPTION_KEY is not configured. "
            "Generate it with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )

    return key


def _get_hash_secret() -> str:
    secret = getattr(settings, "FIELD_HASH_SECRET", "")

    if not secret:
        raise ImproperlyConfigured(
            "FIELD_HASH_SECRET is not configured. "
            "Generate it with: python -c \"import secrets; print(secrets.token_urlsafe(64))\""
        )

    return secret


def _get_fernet() -> Fernet:
    return Fernet(_get_encryption_key().encode())


def encrypt_value(value: Optional[str]) -> str:
    """
    Шифрует значение, которое потом нужно будет восстановить.
    Используем для OAuth-токенов и других секретов backend.
    """

    if not value:
        return ""

    if value.startswith(ENCRYPTION_PREFIX):
        return value

    encrypted = _get_fernet().encrypt(value.encode("utf-8")).decode("utf-8")
    return f"{ENCRYPTION_PREFIX}{encrypted}"


def decrypt_value(value: Optional[str]) -> str:
    """
    Расшифровывает значение.
    """

    if not value:
        return ""

    if not value.startswith(ENCRYPTION_PREFIX):
        return value

    encrypted_value = value.replace(ENCRYPTION_PREFIX, "", 1)

    try:
        return _get_fernet().decrypt(encrypted_value.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        raise ValueError("Cannot decrypt value: invalid encryption token")


def hash_value(value: Optional[str]) -> str:
    """
    Делает необратимый HMAC-SHA256 hash.

    Используем для:
    - token_hash;
    - idempotency_key_hash;
    - signature_hash;
    - request_hash;
    - filters_hash.
    """

    if not value:
        return ""

    return hmac.new(
        _get_hash_secret().encode("utf-8"),
        str(value).encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def make_fingerprint(value: Optional[str], length: int = 12) -> str:
    """
    Короткий безопасный отпечаток для админки и логов.
    """

    if not value:
        return ""

    return hash_value(value)[:length]


def mask_secret(value: Optional[str], visible_start: int = 4, visible_end: int = 4) -> str:
    """
    Маскирует секрет для отображения, если когда-то понадобится показать его частично.
    Для OAuth-токенов лучше использовать fingerprint, а не mask.
    """

    if not value:
        return ""

    if len(value) <= visible_start + visible_end:
        return "*" * len(value)

    return f"{value[:visible_start]}{'*' * 8}{value[-visible_end:]}"