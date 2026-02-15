"""Optional Celery app. Only used when FINSPEC_CELERY_ENABLED=true."""
import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("finspec")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
