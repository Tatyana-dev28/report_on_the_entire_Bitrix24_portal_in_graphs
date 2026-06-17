import uuid

from django.db import models
from django.utils import timezone


class TimeStampedModel(models.Model):
    """
    Базовая абстрактная модель с датами создания и обновления.
    Используется почти во всех бизнес-моделях проекта.
    """

    created_at = models.DateTimeField(
        auto_now_add=True,
        verbose_name="Дата создания",
    )
    updated_at = models.DateTimeField(
        auto_now=True,
        verbose_name="Дата обновления",
    )

    class Meta:
        abstract = True


class PublicIdModel(models.Model):
    """
    Абстрактная модель с публичным UUID.

    Нужна, чтобы во внешнем API и frontend не светить внутренние id из базы.
    Например: портал, подписка, платеж, сохраненный отчет.
    """

    public_id = models.UUIDField(
        default=uuid.uuid4,
        unique=True,
        editable=False,
        db_index=True,
        verbose_name="Публичный ID",
    )

    class Meta:
        abstract = True


class ActiveModel(models.Model):
    """
    Абстрактная модель для включения/отключения сущности.
    Например: активен ли портал, источник, метрика, тариф.
    """

    is_active = models.BooleanField(
        default=True,
        db_index=True,
        verbose_name="Активно",
    )

    class Meta:
        abstract = True


class SortableModel(models.Model):
    """
    Абстрактная модель для ручной сортировки.
    Например: порядок разделов метрик или порядок метрик внутри раздела.
    """

    sort_order = models.PositiveIntegerField(
        default=100,
        db_index=True,
        verbose_name="Порядок сортировки",
    )

    class Meta:
        abstract = True
        ordering = ["sort_order", "id"]


class SoftDeleteQuerySet(models.QuerySet):
    """
    QuerySet для мягкого удаления.

    По умолчанию delete() не удаляет записи физически,
    а помечает их как удаленные.
    """

    def alive(self):
        return self.filter(is_deleted=False)

    def deleted(self):
        return self.filter(is_deleted=True)

    def delete(self):
        update_data = {
            "is_deleted": True,
            "deleted_at": timezone.now(),
        }

        if any(field.name == "updated_at" for field in self.model._meta.fields):
            update_data["updated_at"] = timezone.now()

        return self.update(**update_data)

    def hard_delete(self):
        return super().delete()


class SoftDeleteManager(models.Manager):
    """
    Менеджер, который по умолчанию показывает только неудаленные записи.
    """

    def get_queryset(self):
        return SoftDeleteQuerySet(self.model, using=self._db).filter(is_deleted=False)

    def with_deleted(self):
        return SoftDeleteQuerySet(self.model, using=self._db)

    def deleted(self):
        return self.with_deleted().deleted()


class AllObjectsManager(models.Manager):
    """
    Менеджер для доступа ко всем записям, включая мягко удаленные.
    """

    def get_queryset(self):
        return SoftDeleteQuerySet(self.model, using=self._db)


class SoftDeleteModel(models.Model):
    """
    Абстрактная модель мягкого удаления.

    Запись не удаляется физически из БД, а помечается как удаленная.
    Это важно для аудита, платежей, порталов и отчетных данных.
    """

    is_deleted = models.BooleanField(
        default=False,
        db_index=True,
        verbose_name="Удалено",
    )
    deleted_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Дата удаления",
    )

    objects = SoftDeleteManager()
    all_objects = AllObjectsManager()

    def delete(self, using=None, keep_parents=False):
        self.soft_delete()

    def soft_delete(self):
        self.is_deleted = True
        self.deleted_at = timezone.now()

        update_fields = ["is_deleted", "deleted_at"]

        if hasattr(self, "updated_at"):
            update_fields.append("updated_at")

        self.save(update_fields=update_fields)

    def restore(self):
        self.is_deleted = False
        self.deleted_at = None

        update_fields = ["is_deleted", "deleted_at"]

        if hasattr(self, "updated_at"):
            update_fields.append("updated_at")

        self.save(update_fields=update_fields)

    def hard_delete(self, using=None, keep_parents=False):
        return super().delete(using=using, keep_parents=keep_parents)

    class Meta:
        abstract = True


class BaseModel(TimeStampedModel, SoftDeleteModel):
    """
    Основная базовая модель для большинства бизнес-сущностей.

    Включает:
    - created_at
    - updated_at
    - is_deleted
    - deleted_at
    """

    class Meta:
        abstract = True


class ActiveBaseModel(BaseModel, ActiveModel):
    """
    Базовая модель для сущностей, которые можно включать/отключать.
    """

    class Meta:
        abstract = True


class PublicBaseModel(BaseModel, PublicIdModel):
    """
    Базовая модель для сущностей, которые будут доступны через API.

    Например:
    - портал;
    - подписка;
    - платеж;
    - сохраненный отчет.
    """

    class Meta:
        abstract = True


class SystemSetting(TimeStampedModel, ActiveModel):
    """
    Системные настройки приложения.

    Здесь можно хранить глобальные параметры без изменения кода:
    лимиты по умолчанию, технические флаги, настройки интеграций.
    """

    key = models.CharField(
        max_length=150,
        unique=True,
        verbose_name="Ключ",
    )
    value = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Значение",
    )
    description = models.TextField(
        blank=True,
        verbose_name="Описание",
    )

    class Meta:
        verbose_name = "Системная настройка"
        verbose_name_plural = "Системные настройки"
        ordering = ["key"]

    def __str__(self):
        return self.key


class AuditLog(models.Model):
    """
    Журнал важных действий.

    Нужен для полноценной рабочей версии:
    - установка приложения;
    - обновление токенов;
    - запуск синхронизации;
    - ошибки Битрикс24;
    - включение/отключение Pro;
    - платежные события;
    - действия администратора.

    В этой модели намеренно нет ForeignKey на BitrixPortal,
    чтобы не создавать циклические зависимости между common и bitrix.
    """

    class ActorType(models.TextChoices):
        SYSTEM = "system", "Система"
        BITRIX_USER = "bitrix_user", "Пользователь Битрикс24"
        ADMIN = "admin", "Администратор"
        BITRIX_EVENT = "bitrix_event", "Событие Битрикс24"
        PAYMENT_PROVIDER = "payment_provider", "Платежная система"

    portal_member_id = models.CharField(
        max_length=100,
        blank=True,
        db_index=True,
        verbose_name="member_id портала",
    )
    actor_type = models.CharField(
        max_length=50,
        choices=ActorType.choices,
        default=ActorType.SYSTEM,
        db_index=True,
        verbose_name="Тип инициатора",
    )
    actor_id = models.CharField(
        max_length=100,
        blank=True,
        db_index=True,
        verbose_name="ID инициатора",
    )
    action = models.CharField(
        max_length=150,
        db_index=True,
        verbose_name="Действие",
    )
    entity_type = models.CharField(
        max_length=100,
        blank=True,
        db_index=True,
        verbose_name="Тип сущности",
    )
    entity_id = models.CharField(
        max_length=100,
        blank=True,
        db_index=True,
        verbose_name="ID сущности",
    )
    payload = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Данные",
    )
    ip_address = models.GenericIPAddressField(
        null=True,
        blank=True,
        verbose_name="IP-адрес",
    )
    user_agent = models.TextField(
        blank=True,
        verbose_name="User-Agent",
    )
    created_at = models.DateTimeField(
        auto_now_add=True,
        db_index=True,
        verbose_name="Дата создания",
    )

    class Meta:
        verbose_name = "Журнал аудита"
        verbose_name_plural = "Журнал аудита"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["portal_member_id", "created_at"]),
            models.Index(fields=["portal_member_id", "action"]),
            models.Index(fields=["entity_type", "entity_id"]),
        ]

    def __str__(self):
        return f"{self.created_at:%Y-%m-%d %H:%M} — {self.action}"


class IdempotencyKey(TimeStampedModel):
    """
    Ключ идемпотентности.

    Нужен, чтобы не обработать дважды:
    - webhook от Битрикс24;
    - webhook от платежной системы;
    - повторный запрос на создание платежа;
    - повторную синхронизацию одного события.
    """

    class Status(models.TextChoices):
        STARTED = "started", "Начато"
        COMPLETED = "completed", "Завершено"
        FAILED = "failed", "Ошибка"

    key = models.CharField(
        max_length=255,
        unique=True,
        verbose_name="Ключ",
    )
    scope = models.CharField(
        max_length=100,
        db_index=True,
        verbose_name="Область",
        help_text="Например: bitrix_event, payment_webhook, create_payment",
    )
    portal_member_id = models.CharField(
        max_length=100,
        blank=True,
        db_index=True,
        verbose_name="member_id портала",
    )
    request_hash = models.CharField(
        max_length=128,
        blank=True,
        verbose_name="Хэш запроса",
    )
    status = models.CharField(
        max_length=30,
        choices=Status.choices,
        default=Status.STARTED,
        db_index=True,
        verbose_name="Статус",
    )
    response_payload = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Ответ",
    )
    error_message = models.TextField(
        blank=True,
        verbose_name="Ошибка",
    )
    locked_until = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Заблокировано до",
    )
    completed_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Дата завершения",
    )
    expires_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="Срок действия",
    )

    class Meta:
        verbose_name = "Ключ идемпотентности"
        verbose_name_plural = "Ключи идемпотентности"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["scope", "status"]),
            models.Index(fields=["portal_member_id", "scope"]),
            models.Index(fields=["expires_at"]),
        ]

    def __str__(self):
        return f"{self.scope}: {self.key}"


class TaskLock(TimeStampedModel):
    """
    Блокировка фоновых задач.

    Нужна, чтобы не запускать одновременно несколько одинаковых тяжелых задач:
    - полная синхронизация портала;
    - пересчет отчета за период;
    - обработка очереди событий.
    """

    key = models.CharField(
        max_length=255,
        unique=True,
        verbose_name="Ключ блокировки",
    )
    owner = models.CharField(
        max_length=150,
        blank=True,
        verbose_name="Владелец блокировки",
    )
    locked_until = models.DateTimeField(
        db_index=True,
        verbose_name="Заблокировано до",
    )
    metadata = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Дополнительные данные",
    )

    class Meta:
        verbose_name = "Блокировка задачи"
        verbose_name_plural = "Блокировки задач"
        ordering = ["key"]

    @property
    def is_locked(self):
        return self.locked_until > timezone.now()

    def __str__(self):
        return self.key
