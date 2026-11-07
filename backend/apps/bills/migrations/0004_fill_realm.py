"""Moves existing bills and templates into the install's realm (see realms 0002)."""

from django.db import migrations


def fill_realm(apps, schema_editor):
    Realm = apps.get_model("realms", "Realm")
    Bill = apps.get_model("bills", "Bill")
    BillTemplate = apps.get_model("bills", "BillTemplate")
    realm = Realm.objects.order_by("id").first()
    if realm is None:
        # A fresh install: the only template is the one bills 0002 seeded. Each realm gets its
        # own now, when it's created.
        BillTemplate.objects.filter(bills__isnull=True).delete()
        if not (Bill.objects.exists() or BillTemplate.objects.exists()):
            return
        realm = Realm.objects.create(name="My rentals")
    BillTemplate.objects.filter(realm__isnull=True).update(realm=realm)
    Bill.objects.filter(realm__isnull=True).update(realm=realm)


class Migration(migrations.Migration):
    dependencies = [
        ("bills", "0003_realm"),
        ("ledger", "0006_fill_realm"),
        ("realms", "0002_default_realm"),
    ]

    operations = [migrations.RunPython(fill_realm, migrations.RunPython.noop)]
