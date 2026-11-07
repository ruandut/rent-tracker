from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.realms.models import RealmInvitation, RealmMembership
from apps.realms.permissions import resolve_membership


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    """Who's signed in, the realm this request works in (null when there's none) and the realms
    they can switch to."""
    user = request.user
    try:
        current = resolve_membership(request)
    except PermissionDenied:
        current = None
    realms = RealmMembership.objects.filter(user=user).select_related("realm")
    pending = (
        RealmInvitation.objects.filter(
            email__iexact=user.email, status=RealmInvitation.Status.PENDING
        ).count()
        if user.email
        else 0
    )
    return Response(
        {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "realm": _realm(current) if current else None,
            "realms": sorted((_realm(m) for m in realms), key=lambda r: r["name"].lower()),
            "pending_invitations": pending,
        }
    )


def _realm(membership: RealmMembership) -> dict:
    return {"id": membership.realm_id, "name": membership.realm.name, "role": membership.role}
