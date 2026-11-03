from django.db import migrations

DEFAULT_TAGS = [("maintenance", "amber")]


def create_default_tags(apps, schema_editor):
    Tag = apps.get_model("ledger", "Tag")
    for name, color in DEFAULT_TAGS:
        Tag.objects.update_or_create(name=name, defaults={"color": color, "is_system": True})


class Migration(migrations.Migration):
    dependencies = [("ledger", "0001_initial")]

    operations = [migrations.RunPython(create_default_tags, migrations.RunPython.noop)]
