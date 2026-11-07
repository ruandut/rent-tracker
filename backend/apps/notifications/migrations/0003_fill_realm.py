"""Moves the summary schedules and the one delivery settings row into the install's realm."""

from django.db import migrations


def fill_realm(apps, schema_editor):
    Realm = apps.get_model("realms", "Realm")
    Settings = apps.get_model("notifications", "DeliverySettings")
    Schedule = apps.get_model("notifications", "SummarySchedule")
    realm = Realm.objects.order_by("id").first()
    if realm is None:
        # Nobody has signed in yet, so these can only be empty or unused.
        Settings.objects.all().delete()
        if not Schedule.objects.exists():
            return
        realm = Realm.objects.create(name="My rentals")
    # There was only ever one settings row (pk=1); every realm gets its own from now on.
    first = Settings.objects.order_by("id").first()
    if first is not None:
        Settings.objects.exclude(pk=first.pk).delete()
        first.realm = realm
        first.save(update_fields=["realm"])
    Schedule.objects.filter(realm__isnull=True).update(realm=realm)


class Migration(migrations.Migration):
    dependencies = [
        ("notifications", "0002_realm"),
        ("ledger", "0006_fill_realm"),
        ("realms", "0002_default_realm"),
    ]

    operations = [migrations.RunPython(fill_realm, migrations.RunPython.noop)]
