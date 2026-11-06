from django.db import transaction

from .models import Bill, BillLine, BillTemplate, BillUnit
from .signals import bill_saved


@transaction.atomic
def save_template(template: BillTemplate | None, fields: dict) -> BillTemplate:
    """Create or update a template, keeping exactly one default."""
    if template is None:
        template = BillTemplate(**fields)
    else:
        for name, value in fields.items():
            setattr(template, name, value)
    if template.is_default:
        BillTemplate.objects.exclude(pk=template.pk).filter(is_default=True).update(
            is_default=False
        )
    template.save()
    return template


@transaction.atomic
def save_bill(bill: Bill | None, fields: dict, units: list[dict] | None) -> Bill:
    """Create or update a bill. `units`, when given, replaces its shares and their lines."""
    if bill is None:
        bill = Bill(**fields)
    else:
        for name, value in fields.items():
            setattr(bill, name, value)
    bill.save()
    if units is not None:
        bill.units.all().delete()
        for position, unit in enumerate(units):
            share = BillUnit.objects.create(
                bill=bill, rental_unit=unit["rental_unit"], position=position
            )
            BillLine.objects.bulk_create(
                BillLine(bill_unit=share, position=index, **line)
                for index, line in enumerate(unit.get("lines", []))
            )
    bill_saved.send(sender=Bill, bill=bill)
    return bill
