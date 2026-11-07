"""What every new realm's ledger starts with."""

from django.dispatch import receiver

from apps.realms.signals import realm_created

from .models import Tag

DEFAULT_TAGS = [("maintenance", "amber")]


@receiver(realm_created, dispatch_uid="ledger.set_up_realm")
def set_up_realm(sender, realm, **kwargs):
    Tag.objects.bulk_create(
        Tag(realm=realm, name=name, color=color, is_system=True) for name, color in DEFAULT_TAGS
    )
