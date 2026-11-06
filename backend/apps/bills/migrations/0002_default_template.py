from django.db import migrations


def _vat():
    return {"key": "vat", "label": "VAT", "type": "money", "required": False, "usage_only": False}


def _field(key, label, type_="text", usage_only=False):
    return {
        "key": key,
        "label": label,
        "type": type_,
        "required": False,
        "usage_only": usage_only,
    }


def _metered_fields():
    return [
        _vat(),
        _field("meter_number", "Meter number"),
        _field("meter_previous", "Previous reading", "number", usage_only=True),
        _field("meter_current", "Current reading", "number", usage_only=True),
        _field("usage", "Usage", "number", usage_only=True),
        _field("reading_from", "Previous reading date", "date", usage_only=True),
        _field("reading_to", "Current reading date", "date", usage_only=True),
    ]


def _section(key, label, destination, items, fields=None, usage_unit=""):
    return {
        "key": key,
        "label": label,
        "destination": destination,
        "usage_unit": usage_unit,
        "fields": fields or [_vat()],
        "items": [{"label": item, "charge_type": charge} for item, charge in items],
    }


# Frozen here rather than imported, as a migration must keep meaning the same thing.
DEFINITION = {
    "bill_fields": [
        {**_field("account_number", "Account number"), "required": True},
        _field("invoice_number", "Invoice number"),
        _field("statement_date", "Statement date", "date"),
        _field("due_date", "Due date", "date"),
        _field("opening_balance", "Opening balance", "money"),
        _field("stated_total", "Total levies for the month", "money"),
        _field("amount_due", "Amount due", "money"),
    ],
    "sections": [
        _section(
            "rates", "Property rates", "rates_taxes", [("Rates", "basic"), ("Rebate", "rebate")]
        ),
        _section("refuse", "Waste disposal", "refuse", [("Refuse", "basic")]),
        _section("sanitation", "Sanitation", "sewerage", [("Sanitation", "basic")]),
        _section(
            "electricity",
            "Electricity",
            "electricity",
            [("Basic", "basic"), ("Amperage", "capacity"), ("Usage", "usage")],
            _metered_fields(),
            "kWh",
        ),
        _section(
            "water",
            "Water",
            "water",
            [("Basic", "basic"), ("Free water", "rebate"), ("Metered usage", "usage")],
            _metered_fields(),
            "kL",
        ),
        _section("other", "Other", "other", [("Item", "other")]),
    ],
}


def create_default(apps, schema_editor):
    apps.get_model("bills", "BillTemplate").objects.create(
        name="George Municipality", is_default=True, definition=DEFINITION
    )


class Migration(migrations.Migration):
    dependencies = [("bills", "0001_initial")]

    operations = [migrations.RunPython(create_default, migrations.RunPython.noop)]
