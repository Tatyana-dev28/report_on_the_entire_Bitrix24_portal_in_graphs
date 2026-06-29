import importlib
import logging

logger = logging.getLogger(__name__)

try:
    from .celery import app as celery_app
except ImportError:
    celery_app = None
    logger.warning("Celery is not installed. Background tasks will not work.")

__all__ = ("celery_app",)
