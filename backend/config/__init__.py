try:  # Celery is optional; the API works without a broker.
    from .celery import app as celery_app

    __all__ = ("celery_app",)
except Exception:  # pragma: no cover - celery not installed
    celery_app = None
