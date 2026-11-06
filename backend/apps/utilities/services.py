"""Keeps the usage and charge rows a bill produces in step with that bill."""

from collections import defaultdict
from decimal import Decimal

from django.dispatch import receiver
from rest_framework.exceptions import ValidationError

from apps.bills.models import Bill, BillLine, Destination
from apps.bills.signals import bill_saved

from .models import MunicipalCharge, UtilityReading

READING_KINDS = {
    Destination.WATER: UtilityReading.Kind.WATER,
    Destination.ELECTRICITY: UtilityReading.Kind.ELECTRICITY,
}
CHARGE_CATEGORIES = {
    Destination.RATES_TAXES: MunicipalCharge.Category.RATES_TAXES,
    Destination.REFUSE: MunicipalCharge.Category.REFUSE,
    Destination.SEWERAGE: MunicipalCharge.Category.SEWERAGE,
    Destination.LEVY: MunicipalCharge.Category.LEVY,
    Destination.INSURANCE: MunicipalCharge.Category.INSURANCE,
    Destination.OTHER: MunicipalCharge.Category.OTHER,
}
CENT = Decimal("0.01")


@receiver(bill_saved, dispatch_uid="utilities.sync_bill")
def sync_bill(sender, bill: Bill, **kwargs):
    """One reading per unit and utility, one charge per unit and category, all at VAT-inclusive
    cost. A template's sections say which is which. Rows that already exist are updated so their
    ids and payment links survive an edit."""
    sections = bill.layout["sections"]
    destinations = {section["key"]: section["destination"] for section in sections}
    groups: dict[tuple, list[BillLine]] = defaultdict(list)
    for share in bill.units.prefetch_related("lines").select_related("rental_unit"):
        for line in share.lines.all():
            groups[share.rental_unit, destinations[line.section]].append(line)

    _sync_readings(bill, groups)
    _sync_charges(bill, groups)


def _sync_readings(bill, groups):
    wanted = {
        (unit, READING_KINDS[destination]): lines
        for (unit, destination), lines in groups.items()
        if destination in READING_KINDS
    }
    keep = {(unit.id, kind) for unit, kind in wanted}
    for row in bill.readings.all():
        if (row.rental_unit_id, row.kind) not in keep:
            row.delete()

    for (unit, kind), lines in wanted.items():
        clash = UtilityReading.objects.filter(rental_unit=unit, kind=kind, period=bill.period)
        if clash.exclude(bill=bill).exists():
            label = UtilityReading.Kind(kind).label.lower()
            raise ValidationError(
                {
                    "detail": f"{unit.name} already has {label} logged for "
                    f"{bill.period:%B %Y} that isn't from this bill. Delete it under "
                    "Water & electricity, then save again."
                }
            )
        UtilityReading.objects.update_or_create(
            bill=bill,
            rental_unit=unit,
            kind=kind,
            defaults={
                "period": bill.period,
                "usage": _usage(lines),
                "meter_reading": _meter_reading(lines),
                "cost": sum(line.total for line in lines),
            },
        )


def _sync_charges(bill, groups):
    wanted = {
        (unit, CHARGE_CATEGORIES[destination]): lines
        for (unit, destination), lines in groups.items()
        if destination in CHARGE_CATEGORIES
    }
    keep = {(unit.id, category) for unit, category in wanted}
    for row in bill.charges.all():
        if (row.rental_unit_id, row.category) not in keep:
            row.delete()

    for (unit, category), lines in wanted.items():
        MunicipalCharge.objects.update_or_create(
            bill=bill,
            rental_unit=unit,
            category=category,
            defaults={
                "period": bill.period,
                "amount": sum(line.total for line in lines),
                "description": "; ".join(line.description for line in lines if line.description)[
                    :255
                ],
            },
        )


def _usage(lines: list[BillLine]) -> Decimal | None:
    usages = [line.usage for line in lines if line.usage is not None]
    return sum(usages).quantize(CENT) if usages else None


def _meter_reading(lines: list[BillLine]) -> Decimal | None:
    """The closing reading, but only when a single meter feeds this row."""
    meters = {line.meter_number for line in lines if line.meter_number}
    readings = [line.meter_current for line in lines if line.meter_current is not None]
    return readings[0].quantize(CENT) if len(meters) <= 1 and len(readings) == 1 else None
