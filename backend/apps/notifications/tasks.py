"""Hatchet: checks every minute for summaries that are due."""

from datetime import timedelta

from django.db import close_old_connections
from hatchet_sdk import Context, EmptyModel

from apps.jobs.hatchet import get_hatchet

hatchet = get_hatchet()


@hatchet.task(
    name="send-due-summaries", on_crons=["* * * * *"], execution_timeout=timedelta(minutes=5)
)
def send_due_summaries_task(input: EmptyModel, ctx: Context) -> dict:
    from .services import send_due_summaries

    # Tasks run on worker threads, outside Django's request cycle that normally does this.
    close_old_connections()
    try:
        return send_due_summaries()
    finally:
        close_old_connections()


TASKS = [send_due_summaries_task]
