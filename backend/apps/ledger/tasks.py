"""Hatchet tasks for the ledger.

Placeholder for the planned email ingestion: a task will read bank / municipal emails and
create Transactions with source=EMAIL. For now it only proves the worker wiring works:
trigger `ledger-ping` from the Hatchet dashboard and it reports the transaction count.
"""

from hatchet_sdk import Context, EmptyModel

from apps.jobs.hatchet import get_hatchet

hatchet = get_hatchet()


@hatchet.task(name="ledger-ping")
def ledger_ping(input: EmptyModel, ctx: Context) -> dict:
    from .models import Transaction

    return {"transactions": Transaction.objects.count()}


TASKS = [ledger_ping]
