"""The database cache's table (settings.CACHES). A migration, so `migrate` on every start
creates it on fresh installs and upgrades alike, and tests get it too."""

from django.core.management import call_command
from django.db import migrations


def create_cache_table(apps, schema_editor):
    # Idempotent: skips tables that already exist.
    call_command("createcachetable", database=schema_editor.connection.alias, verbosity=0)


def drop_cache_table(apps, schema_editor):
    schema_editor.execute("DROP TABLE IF EXISTS django_cache")


class Migration(migrations.Migration):
    dependencies = []

    operations = [migrations.RunPython(create_cache_table, drop_cache_table)]
