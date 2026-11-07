"""Which realm a request works in, and the pieces that keep every endpoint inside it.

A browser tab names its realm in the X-Realm header, so two tabs on different realms can't write
into each other's. Without the header, the user's focused realm is used. Either way the user must
be a member, or the request is refused.

`InRealm` is a default permission class (see settings), so a new endpoint is realm-gated unless
it says otherwise. It sets `request.realm` and `request.membership`. Querysets still have to be
filtered: RealmScopedViewSet does that for viewsets, and every endpoint has an isolation test.
"""

from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied

# Kept apart from access.py: DRF imports this from settings while loading its own views module.
from .models import Profile, RealmMembership

REALM_HEADER = "X-Realm"


class RealmRequired(PermissionDenied):
    """403 with a machine-readable `code`, so the frontend can tell this apart from others."""

    def __init__(self, detail: str, code: str):
        super().__init__({"detail": detail, "code": code})


def membership_for(user, realm_id) -> RealmMembership | None:
    try:
        realm_id = int(realm_id)
    except TypeError, ValueError:
        return None
    return (
        RealmMembership.objects.select_related("realm").filter(user=user, realm_id=realm_id).first()
    )


def default_membership(user) -> RealmMembership | None:
    """The focused realm, or else the oldest one the user belongs to (which becomes the focus)."""
    profile = Profile.of(user)
    if profile.focused_realm_id and (membership := membership_for(user, profile.focused_realm_id)):
        return membership
    membership = (
        RealmMembership.objects.select_related("realm").filter(user=user).order_by("id").first()
    )
    realm = membership.realm if membership else None
    if profile.focused_realm != realm:
        profile.focused_realm = realm
        profile.save(update_fields=["focused_realm"])
    return membership


def resolve_membership(request) -> RealmMembership:
    asked = request.headers.get(REALM_HEADER)
    if asked:
        membership = membership_for(request.user, asked)
        if membership is None:
            raise RealmRequired("You aren't a member of that realm.", "not_member")
        return membership
    membership = default_membership(request.user)
    if membership is None:
        raise RealmRequired("Create a realm or accept an invitation first.", "no_realm")
    return membership


class InRealm(permissions.BasePermission):
    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        membership = resolve_membership(request)
        request.membership = membership
        request.realm = membership.realm
        return True
