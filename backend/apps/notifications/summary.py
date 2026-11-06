"""The summary text itself: where the account stands, to date."""

from datetime import date
from decimal import Decimal

from django.utils import timezone

from apps.ledger.models import Transaction
from apps.ledger.views import active_accounts


def money(value: Decimal) -> str:
    sign = "-" if value < 0 else ""
    return f"{sign}R {abs(value):,.2f}".replace(",", " ")


def _totals(label: str, start: date, today: date) -> list[str]:
    totals = Transaction.objects.filter(date__gte=start, date__lte=today).totals()
    return [
        label,
        f"  In:  {money(totals['income'])}",
        f"  Out: {money(totals['expense'])}",
        f"  Net: {money(totals['net'])}",
    ]


def build_summary() -> tuple[str, str]:
    """(subject, body) as plain text, which reads the same in an email and in Telegram."""
    today = timezone.localdate()
    accounts = list(active_accounts())
    balance = sum((account.balance for account in accounts), Decimal("0"))

    lines = [f"Account balance: {money(balance)}"]
    lines += [f"  {account.name}: {money(account.balance)}" for account in accounts]
    lines += ["", *_totals(f"{today:%B %Y} to date", today.replace(day=1), today)]
    lines += ["", *_totals(f"{today.year} to date", today.replace(month=1, day=1), today)]

    subject = f"Rent Tracker summary, {today.day} {today:%B %Y}"
    return subject, "\n".join(lines)
