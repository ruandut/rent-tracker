from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.accounts import captcha
from apps.core.throttling import AuthThrottle, with_defaults
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


class LoginView(TokenObtainPairView):
    """Username + password for a JWT pair, behind the captcha and the strict per-IP auth limit."""

    throttle_classes = with_defaults(AuthThrottle)

    def post(self, request, *args, **kwargs):
        # Before the password check, so every guess costs a solved captcha.
        captcha.verify(request)
        return super().post(request, *args, **kwargs)
