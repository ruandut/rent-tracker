"""Getting a message out: SMTP or the Telegram Bot API. Failures raise DeliveryError."""

import json
import smtplib
import urllib.error
import urllib.parse
import urllib.request

from django.core.mail import EmailMessage, get_connection

from .crypto import UnreadableSecret, decrypt
from .models import DeliverySettings, SummarySchedule

TIMEOUT_SECONDS = 20
# Telegram rejects longer messages outright.
MAX_TELEGRAM_TEXT = 4096


class DeliveryError(Exception):
    pass


def _secret(value: str) -> str:
    try:
        return decrypt(value)
    except UnreadableSecret as exc:
        raise DeliveryError("Saved credentials can't be read; enter them again.") from exc


def send_email(settings: DeliverySettings, to: str, subject: str, body: str) -> None:
    if not settings.smtp_host or not settings.from_email:
        raise DeliveryError("Email isn't set up yet: add a mail server and from address.")
    connection = get_connection(
        "django.core.mail.backends.smtp.EmailBackend",
        host=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_username,
        password=_secret(settings.smtp_password_encrypted),
        use_tls=settings.smtp_use_tls,
        timeout=TIMEOUT_SECONDS,
    )
    try:
        EmailMessage(subject, body, settings.from_email, [to], connection=connection).send()
    except (smtplib.SMTPException, OSError) as exc:
        raise DeliveryError(f"Could not send email: {exc}") from exc


def send_telegram(settings: DeliverySettings, chat_id: str, subject: str, body: str) -> None:
    token = _secret(settings.telegram_bot_token_encrypted)
    if not token:
        raise DeliveryError("Telegram isn't set up yet: add a bot token.")
    text = f"{subject}\n\n{body}"[:MAX_TELEGRAM_TEXT]
    data = urllib.parse.urlencode({"chat_id": chat_id, "text": text}).encode()
    request = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=data)
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS):
            return
    except urllib.error.HTTPError as exc:
        # Telegram's own description ("chat not found") beats the status code.
        try:
            detail = json.load(exc).get("description")
        except ValueError:
            detail = None
        raise DeliveryError(detail or f"Telegram returned HTTP {exc.code}") from None
    except OSError as exc:
        # Never str(exc) a URL error blindly: the request URL holds the bot token.
        raise DeliveryError(f"Could not reach Telegram: {type(exc).__name__}") from None


def deliver(schedule: SummarySchedule, subject: str, body: str) -> None:
    settings = DeliverySettings.load()
    if schedule.channel == SummarySchedule.Channel.EMAIL:
        send_email(settings, schedule.recipient, subject, body)
    else:
        send_telegram(settings, schedule.recipient, subject, body)
