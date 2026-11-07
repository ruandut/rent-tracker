"""Moves existing ledger rows into the install's realm (see realms 0002)."""

from django.db import migrations

MODELS = ["RentalUnit", "PaymentMethod", "Beneficiary", "Tag", "Transaction"]


def fill_realm(apps, schema_editor):
    Realm = apps.get_model("realms", "Realm")
    models = [apps.get_model("ledger", name) for name in MODELS]
    realm = Realm.objects.order_by("id").first()
    if realm is None:
        # A fresh install: the only rows are system tags that ledger 0002 seeded. Each realm gets
        # its own now, when it's created.
        apps.get_model("ledger", "Tag").objects.filter(is_system=True).delete()
        if not any(model.objects.exists() for model in models):
            return
        realm = Realm.objects.create(name="My rentals")
    for model in models:
        model.objects.filter(realm__isnull=True).update(realm=realm)


class Migration(migrations.Migration):
    dependencies = [("ledger", "0005_realm"), ("realms", "0002_default_realm")]

    operations = [migrations.RunPython(fill_realm, migrations.RunPython.noop)]
