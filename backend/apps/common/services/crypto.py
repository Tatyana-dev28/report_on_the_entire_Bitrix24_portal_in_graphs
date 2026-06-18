"""
Сервис шифрования и дешифрования данных.
"""

import hashlib
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured


ENCRYPTION_PREFIX = "enc:v1:"


def _get_encryption_key() -> str:
    """
    Получает ключ шифрования из settings.

    Ключ должен храниться в переменной окружения FIELD_ENCRYPTION_KEY,
    а не в коде и не в базе данных.
    """

    key = getattr(settings, "FIELD_ENCRYPTION_KEY", "")

    if not key:
        raise ImproperlyConfigured(
            "FIELD_ENCRYPTION_KEY is not configured. "
            "Generate it with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )

    return key


def _get_fernet() -> Fernet:
    return Fernet(_get_encryption_key().encode())


def encrypt_value(value: Optional[str]) -> str:
    """
    Шифрует значение, которое потом нужно будет восстановить.

    Используем для:
    - access_token;
    - refresh_token;
    - application_token;
    - других секретов, которые backend должен уметь расшифровать.
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

    Если значение не зашифровано старым кодом или пришло пустым,
    возвращает безопасный результат.
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
    Делает необратимый hash значения.

    Используем для сравнения и поиска, когда исходное значение восстанавливать не нужно.

    Например:
    - access_token_hash;
    - refresh_token_hash;
    - request_hash;
    - signature_hash;
    - idempotency_key_hash.
    """

    if not value:
        return ""

    secret_key = getattr(settings, "SECRET_KEY", "")
    raw = f"{secret_key}:{value}".encode("utf-8")

    return hashlib.sha256(raw).hexdigest()


def make_fingerprint(value: Optional[str], length: int = 12) -> str:
    """
    Короткий безопасный отпечаток для админки и логов.

    Не раскрывает сам токен, но помогает понять,
    изменился секрет или нет.
    """

    if not value:
        return ""

    return hash_value(value)[:length]


def mask_secret(value: Optional[str], visible_start: int = 4, visible_end: int = 4) -> str:
    """
    Маскирует секрет для отображения.

    Например:
    abcdefghijklmnop -> abcd********mnop
    """

    if not value:
        return ""

    if len(value) <= visible_start + visible_end:
        return "*" * len(value)

    return f"{value[:visible_start]}{'*' * 8}{value[-visible_end:]}"