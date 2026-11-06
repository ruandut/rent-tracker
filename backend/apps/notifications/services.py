from django.db import transaction
from django.utils import timezone

from .delivery import DeliveryError, deliver
from .models import SummarySchedule, next_occurrence
from .summary import build_summary


def reschedule(schedule: SummarySchedule) -> None:
    """Sets next_run_at after an edit. A one-off whose time has passed has nothing left to run."""
    schedule.next_run_at = next_occurrence(
        schedule.start_at, schedule.frequency, after=timezone.now()
    )
    if schedule.next_run_at is None:
        schedule.is_enabled = False


def send_summary(schedule: SummarySchedule) -> None:
    subject, body = build_summary()
    deliver(schedule, subject, body)


def _claim_next_due(now) -> SummarySchedule | None:
    """Moves one due schedule to its next run before sending, so a crash can't double-send."""
    with transaction.atomic():
        schedule = (
            SummarySchedule.objects.select_for_update(skip_locked=True)
            .filter(is_enabled=True, next_run_at__lte=now)
            .first()
        )
        if schedule is None:
            return None
        # Skips anything missed while the worker was down: one summary, not a backlog.
        schedule.next_run_at = next_occurrence(schedule.start_at, schedule.frequency, after=now)
        schedule.is_enabled = schedule.next_run_at is not None
        schedule.save(update_fields=["next_run_at", "is_enabled"])
        return schedule


def send_due_summaries() -> dict[str, int]:
    now = timezone.now()
    sent = failed = 0
    while schedule := _claim_next_due(now):
        try:
            send_summary(schedule)
        except DeliveryError as exc:
            schedule.last_error = str(exc)
            failed += 1
        else:
            schedule.last_sent_at = timezone.now()
            schedule.last_error = ""
            sent += 1
        schedule.save(update_fields=["last_sent_at", "last_error"])
    return {"sent": sent, "failed": failed}
