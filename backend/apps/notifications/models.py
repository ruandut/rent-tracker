"""Scheduled account summaries, sent by email or Telegram."""

import calendar
from datetime import datetime, timedelta

from django.db import models
from django.utils import timezone


class DeliverySettings(models.Model):
    """How to reach the outside world. A single row: there is one mail server and one bot."""

    smtp_host = models.CharField(max_length=255, blank=True)
    smtp_port = models.PositiveIntegerField(default=587)
    smtp_username = models.CharField(max_length=255, blank=True)
    smtp_password_encrypted = models.TextField(blank=True)
    smtp_use_tls = models.BooleanField(default=True)
    from_email = models.EmailField(blank=True)
    telegram_bot_token_encrypted = models.TextField(blank=True)

    class Meta:
        verbose_name_plural = "delivery settings"

    def __str__(self):
        return "Delivery settings"

    @classmethod
    def load(cls) -> DeliverySettings:
        return cls.objects.get_or_create(pk=1)[0]


def next_occurrence(start: datetime, frequency: str, after: datetime) -> datetime | None:
    """The first run later than `after`, on the schedule set by `start`. None if there isn't one.

    Works in local time so a summary stays at the time of day it was set for. Monthly runs keep
    `start`'s day, falling back to the last day of shorter months.
    """
    local = timezone.localtime(start)
    if frequency == SummarySchedule.Frequency.ONCE:
        return start if start > after else None

    def occurrence(n: int) -> datetime:
        if frequency == SummarySchedule.Frequency.DAILY:
            return local + timedelta(days=n)
        if frequency == SummarySchedule.Frequency.WEEKLY:
            return local + timedelta(weeks=n)
        year, month = divmod(local.year * 12 + local.month - 1 + n, 12)
        month += 1
        return local.replace(
            year=year, month=month, day=min(local.day, calendar.monthrange(year, month)[1])
        )

    n = 0
    while (candidate := occurrence(n)) <= after:
        n += 1
    return candidate


class SummarySchedule(models.Model):
    class Channel(models.TextChoices):
        EMAIL = "email", "Email"
        TELEGRAM = "telegram", "Telegram"

    class Frequency(models.TextChoices):
        ONCE = "once", "Once"
        DAILY = "daily", "Daily"
        WEEKLY = "weekly", "Weekly"
        MONTHLY = "monthly", "Monthly"

    name = models.CharField(max_length=100)
    channel = models.CharField(max_length=10, choices=Channel.choices)
    # An email address, or a Telegram chat id.
    recipient = models.CharField(max_length=255)
    frequency = models.CharField(max_length=10, choices=Frequency.choices)
    start_at = models.DateTimeField(help_text="The first send; repeats follow from this.")
    is_enabled = models.BooleanField(default=True)
    next_run_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_sent_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name
