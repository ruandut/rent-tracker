"""Viewset and serializer bases that keep an endpoint inside the request's realm.

See permissions.py for how the realm is chosen. Querysets still have to be filtered:
RealmScopedViewSet does that for viewsets, and every endpoint has an isolation test.
"""

from rest_framework import serializers, viewsets

from .models import Realm, TenantModel


class RealmScopedViewSet(viewsets.ModelViewSet):
    """Every lookup (list, detail, custom actions via get_object) is limited to the request's
    realm, and new rows are created in it."""

    def filter_queryset(self, queryset):
        return super().filter_queryset(queryset).filter(realm=self.request.realm)

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "realm": self.request.realm}


def _context_realm(context) -> Realm | None:
    if realm := context.get("realm"):
        return realm
    request = context.get("request")
    return getattr(request, "realm", None)


class RealmUniqueValidator:
    """Like UniqueTogetherValidator, inside the serializer's realm."""

    requires_context = True

    def __init__(self, fields: tuple[str, ...], message: str):
        self.fields = fields
        self.message = message

    def __call__(self, attrs, serializer):
        instance = serializer.instance
        if instance is not None and not any(name in attrs for name in self.fields):
            return
        values = {
            name: attrs[name] if name in attrs else getattr(instance, name, None)
            for name in self.fields
        }
        model = serializer.Meta.model
        clash = model.objects.filter(realm=serializer.realm, **values)
        if instance is not None:
            clash = clash.exclude(pk=instance.pk)
        if clash.exists():
            raise serializers.ValidationError({self.fields[0]: self.message})


def _narrow(field, realm):
    """Limit a related field's choices to rows in this realm."""
    if isinstance(field, serializers.ManyRelatedField):
        field = field.child_relation
    queryset = getattr(field, "queryset", None)
    if queryset is None or not issubclass(queryset.model, TenantModel):
        return
    field.queryset = queryset.filter(realm=realm) if realm else queryset.none()


class RealmScopedSerializer(serializers.ModelSerializer):
    """A serializer for a TenantModel, or a nested one inside it.

    Foreign keys only accept rows from the request's realm, `realm_unique` lists the field sets
    that must be unique within a realm, and saving a new row puts it in the realm.
    """

    realm_unique: dict[tuple[str, ...], str] = {}

    @property
    def realm(self) -> Realm | None:
        return _context_realm(self.context)

    def get_fields(self):
        fields = super().get_fields()
        for field in fields.values():
            _narrow(field, self.realm)
        return fields

    def get_validators(self):
        return [
            *super().get_validators(),
            *(RealmUniqueValidator(names, message) for names, message in self.realm_unique.items()),
        ]

    def save(self, **kwargs):
        if self.instance is None and issubclass(self.Meta.model, TenantModel):
            kwargs.setdefault("realm", self.realm)
        return super().save(**kwargs)
