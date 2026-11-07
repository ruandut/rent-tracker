"""Gives existing readings and charges their unit's realm."""

from django.db import migrations
from django.db.models import OuterRef, Subquery


def fill_realm(apps, schema_editor):
    RentalUnit = apps.get_model("ledger", "RentalUnit")
    unit_realm = Subquery(RentalUnit.objects.filter(pk=OuterRef("rental_unit")).values("realm"))
    for name in ("UtilityReading", "MunicipalCharge"):
        apps.get_model("utilities", name).objects.filter(realm__isnull=True).update(
            realm=unit_realm
        )


class Migration(migrations.Migration):
    dependencies = [("utilities", "0003_realm"), ("ledger", "0006_fill_realm")]

    operations = [migrations.RunPython(fill_realm, migrations.RunPython.noop)]
