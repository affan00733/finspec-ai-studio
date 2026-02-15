"""Optional Celery tasks (only dispatched when FINSPEC_CELERY_ENABLED=true)."""
from celery import shared_task


@shared_task(name="finspec.execute_run")
def execute_run_task(run_id: int) -> int:
    from .services import execute_run

    return execute_run(run_id).id


@shared_task(name="finspec.execute_evaluation")
def execute_evaluation_task(eval_run_id: int) -> int:
    from .services import execute_evaluation

    return execute_evaluation(eval_run_id).id
