"""Puts an existing install's people into one realm, which the domain apps' data then joins.

A fresh install has no users yet and gets no realm here: the first admin gets one when created.
"""

from django.conf import settings
from django.db import migrations

NAME = "My rentals"


def create_default_realm(apps, schema_editor):
    User = apps.get_model(*settings.AUTH_USER_MODEL.split("."))
    Realm = apps.get_model("realms", "Realm")
    Membership = apps.get_model("realms", "RealmMembership")
    Profile = apps.get_model("realms", "Profile")
    users = list(User.objects.order_by("id"))
    if not users or Realm.objects.exists():
        return
    realm = Realm.objects.create(name=NAME)
    for user in users:
        # Everyone could do everything before, so everyone starts as an admin.
        Membership.objects.create(user=user, realm=realm, role="admin")
        Profile.objects.update_or_create(user=user, defaults={"focused_realm": realm})


class Migration(migrations.Migration):
    dependencies = [
        ("realms", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [migrations.RunPython(create_default_realm, migrations.RunPython.noop)]
