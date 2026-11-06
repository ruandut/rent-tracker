from datetime import datetime, timedelta
from decimal import Decimal
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from django.core import mail
from django.utils import timezone

from apps.ledger.models import PaymentMethod, Transaction
from apps.notifications import delivery, services
from apps.notifications.crypto import decrypt, encrypt
from apps.notifications.delivery import DeliveryError
from apps.notifications.models import DeliverySettings, SummarySchedule, next_occurrence
from apps.notifications.summary import build_summary, money

SAST = ZoneInfo("Africa/Johannesburg")


def at(*args):
    return datetime(*args, tzinfo=SAST)


def schedule(**overrides):
    values = {
        "name": "Monthly",
        "channel": "email",
        "recipient": "me@example.com",
        "frequency": "monthly",
        "start_at": timezone.now() - timedelta(days=1),
        "next_run_at": timezone.now() - timedelta(minutes=1),
    }
    return SummarySchedule.objects.create(**{**values, **overrides})


def test_next_occurrence_repeats_from_the_start():
    start = at(2026, 1, 15, 8, 0)
    assert next_occurrence(start, "daily", at(2026, 1, 15, 9, 0)) == at(2026, 1, 16, 8, 0)
    assert next_occurrence(start, "weekly", at(2026, 1, 15, 9, 0)) == at(2026, 1, 22, 8, 0)
    assert next_occurrence(start, "monthly", at(2026, 1, 15, 9, 0)) == at(2026, 2, 15, 8, 0)
    assert next_occurrence(start, "monthly", at(2026, 12, 20, 0, 0)) == at(2027, 1, 15, 8, 0)


def test_next_occurrence_is_exclusive_and_once_only_runs_once():
    start = at(2026, 1, 15, 8, 0)
    assert next_occurrence(start, "daily", start) == at(2026, 1, 16, 8, 0)
    assert next_occurrence(start, "once", at(2026, 1, 1, 0, 0)) == start
    assert next_occurrence(start, "once", start) is None


def test_monthly_uses_the_last_day_of_short_months_then_returns():
    start = at(2026, 1, 31, 8, 0)
    assert next_occurrence(start, "monthly", start) == at(2026, 2, 28, 8, 0)
    assert next_occurrence(start, "monthly", at(2026, 2, 28, 8, 0)) == at(2026, 3, 31, 8, 0)


def test_secrets_round_trip_and_are_not_stored_in_plain_text():
    stored = encrypt("hunter2")
    assert "hunter2" not in stored
    assert decrypt(stored) == "hunter2"


def test_money_format():
    assert money(Decimal("1234567.5")) == "R 1 234 567.50"
    assert money(Decimal("-20")) == "-R 20.00"


def test_summary_covers_balance_month_and_year(db):
    bank = PaymentMethod.objects.create(name="Bank", opening_balance=Decimal("1000"))
    today = timezone.localdate()
    Transaction.objects.create(
        kind="income", amount=Decimal("500"), date=today, description="Rent", payment_method=bank
    )
    subject, body = build_summary()
    assert "Rent Tracker summary" in subject
    assert "Account balance: R 1 500.00" in body
    assert "Bank: R 1 500.00" in body
    assert body.count("In:  R 500.00") == 2


def test_email_sends_through_configured_server(db, settings):
    DeliverySettings.objects.create(smtp_host="mail.test", from_email="rent@example.com")
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    with patch("apps.notifications.delivery.get_connection") as connection:
        connection.return_value = mail.get_connection(
            "django.core.mail.backends.locmem.EmailBackend"
        )
        delivery.deliver(schedule(), "Subject", "Body")
    assert connection.call_args.kwargs["host"] == "mail.test"
    assert mail.outbox[0].to == ["me@example.com"]
    assert mail.outbox[0].from_email == "rent@example.com"


def test_unconfigured_channels_explain_themselves(db):
    with pytest.raises(DeliveryError, match="Email isn't set up"):
        delivery.deliver(schedule(), "S", "B")
    with pytest.raises(DeliveryError, match="Telegram isn't set up"):
        delivery.deliver(schedule(channel="telegram", recipient="123"), "S", "B")


def test_due_schedule_sends_once_and_moves_on(db):
    item = schedule()
    with patch.object(services, "deliver") as send:
        assert services.send_due_summaries() == {"sent": 1, "failed": 0}
        assert services.send_due_summaries() == {"sent": 0, "failed": 0}
    assert send.call_count == 1
    item.refresh_from_db()
    assert item.last_sent_at and item.next_run_at > timezone.now()


def test_missed_runs_send_one_summary_not_a_backlog(db):
    item = schedule(frequency="daily", start_at=timezone.now() - timedelta(days=30))
    with patch.object(services, "deliver") as send:
        services.send_due_summaries()
    assert send.call_count == 1
    item.refresh_from_db()
    assert item.next_run_at - timezone.now() <= timedelta(days=1)


def test_one_off_disables_itself_after_sending(db):
    item = schedule(frequency="once")
    with patch.object(services, "deliver"):
        services.send_due_summaries()
    item.refresh_from_db()
    assert not item.is_enabled and item.next_run_at is None


def test_failure_is_recorded_and_not_retried_every_minute(db):
    item = schedule()
    with patch.object(services, "deliver", side_effect=DeliveryError("chat not found")):
        assert services.send_due_summaries() == {"sent": 0, "failed": 1}
    item.refresh_from_db()
    assert item.last_error == "chat not found"
    assert item.next_run_at > timezone.now()


def test_disabled_and_future_schedules_are_left_alone(db):
    schedule(is_enabled=False)
    schedule(next_run_at=timezone.now() + timedelta(hours=1))
    with patch.object(services, "deliver") as send:
        services.send_due_summaries()
    send.assert_not_called()


BODY = {
    "name": "Monthly",
    "channel": "email",
    "recipient": "me@example.com",
    "frequency": "monthly",
}


def test_create_sets_next_run(api):
    start = (timezone.now() + timedelta(days=2)).isoformat()
    res = api.post("/api/notifications/schedules/", {**BODY, "start_at": start}, format="json")
    assert res.status_code == 201, res.json()
    assert res.json()["next_run_at"]


def test_past_start_rolls_forward_to_the_next_run(api):
    start = (timezone.now() - timedelta(days=40)).isoformat()
    res = api.post("/api/notifications/schedules/", {**BODY, "start_at": start}, format="json")
    item = SummarySchedule.objects.get(pk=res.json()["id"])
    assert item.next_run_at > timezone.now()


def test_one_off_in_the_past_is_rejected(api):
    start = (timezone.now() - timedelta(hours=1)).isoformat()
    body = {**BODY, "frequency": "once", "start_at": start}
    res = api.post("/api/notifications/schedules/", body, format="json")
    assert res.status_code == 400
    assert "start_at" in res.json()


@pytest.mark.parametrize(
    "channel,recipient",
    [("email", "not-an-email"), ("telegram", "+27821234567"), ("telegram", "hello there")],
)
def test_bad_recipients_are_rejected(api, channel, recipient):
    body = {**BODY, "channel": channel, "recipient": recipient, "start_at": timezone.now()}
    res = api.post("/api/notifications/schedules/", body, format="json")
    assert res.status_code == 400
    assert "recipient" in res.json()


def test_telegram_accepts_group_ids(api):
    body = {
        **BODY,
        "channel": "telegram",
        "recipient": "-1001234567890",
        "start_at": timezone.now() + timedelta(days=1),
    }
    assert api.post("/api/notifications/schedules/", body, format="json").status_code == 201


def test_settings_never_return_credentials(api):
    res = api.patch(
        "/api/notifications/settings/",
        {"smtp_host": "mail.test", "smtp_password": "hunter2", "telegram_bot_token": "1:ABC"},
        format="json",
    )
    assert res.status_code == 200, res.json()
    data = api.get("/api/notifications/settings/").json()
    assert data["has_smtp_password"] and data["has_telegram_bot_token"]
    assert "hunter2" not in str(data) and "1:ABC" not in str(data)
    stored = DeliverySettings.load()
    assert "hunter2" not in stored.smtp_password_encrypted
    assert decrypt(stored.telegram_bot_token_encrypted) == "1:ABC"


def test_blank_credentials_keep_the_saved_ones(api):
    api.patch("/api/notifications/settings/", {"smtp_password": "hunter2"}, format="json")
    api.patch(
        "/api/notifications/settings/", {"smtp_password": "", "smtp_host": "x"}, format="json"
    )
    assert decrypt(DeliverySettings.load().smtp_password_encrypted) == "hunter2"


def test_test_button_reports_failure_without_touching_the_schedule(api):
    item = schedule(next_run_at=timezone.now() + timedelta(days=5))
    before = item.next_run_at
    res = api.post(f"/api/notifications/schedules/{item.id}/test/")
    assert res.json()["sent"] is False
    assert "isn't set up" in res.json()["error"]
    item.refresh_from_db()
    assert item.next_run_at == before
