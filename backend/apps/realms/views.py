"""Realm management. These work on any realm the user belongs to, by id, rather than on the
request's current realm, so they use IsAuthenticated instead of the default InRealm."""

from django.contrib.auth import get_user_model
from django.db.models import Count
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from . import services
from .models import Realm, RealmInvitation, RealmMembership
from .serializers import (
    InvitationSerializer,
    MemberSerializer,
    RealmSerializer,
    ReceivedInvitationSerializer,
    RegisterSerializer,
)

Pending = RealmInvitation.Status.PENDING


def _received(user):
    if not user.email:
        return RealmInvitation.objects.none()
    return RealmInvitation.objects.filter(email__iexact=user.email, status=Pending)


class RealmViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]
    lookup_value_regex = r"\d+"

    # --- helpers ---------------------------------------------------------------------------

    def _membership(self, pk) -> RealmMembership:
        """The user's own membership of realm `pk`; 404 for realms they aren't in."""
        return get_object_or_404(
            RealmMembership.objects.select_related("realm"), realm_id=pk, user=self.request.user
        )

    def _admin(self, pk) -> RealmMembership:
        membership = self._membership(pk)
        if not membership.is_admin:
            raise PermissionDenied("Only realm admins can do this.")
        return membership

    def _realm_data(self, realm: Realm, role: str) -> dict:
        realm.member_count = realm.memberships.count()
        return RealmSerializer(realm, context={"roles": {realm.id: role}}).data

    # --- realms ----------------------------------------------------------------------------

    def list(self, request):
        memberships = RealmMembership.objects.filter(user=request.user)
        roles = dict(memberships.values_list("realm_id", "role"))
        realms = (
            Realm.objects.filter(id__in=roles)
            .annotate(member_count=Count("memberships"))
            .order_by("name", "id")
        )
        return Response(RealmSerializer(realms, many=True, context={"roles": roles}).data)

    def create(self, request):
        serializer = RealmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        realm = services.create_realm(request.user, serializer.validated_data["name"])
        return Response(
            self._realm_data(realm, RealmMembership.Role.ADMIN), status=status.HTTP_201_CREATED
        )

    def retrieve(self, request, pk=None):
        membership = self._membership(pk)
        return Response(self._realm_data(membership.realm, membership.role))

    def partial_update(self, request, pk=None):
        membership = self._admin(pk)
        serializer = RealmSerializer(membership.realm, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(self._realm_data(membership.realm, membership.role))

    def destroy(self, request, pk=None):
        """Deletes the realm and everything in it. The body must repeat the realm's name."""
        realm = self._admin(pk).realm
        if (request.data.get("confirm") or "").strip() != realm.name:
            raise ValidationError({"confirm": "Type the realm's name to confirm."})
        services.delete_realm(realm)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def switch(self, request, pk=None):
        membership = self._membership(pk)
        services.focus(request.user, membership.realm)
        return Response(self._realm_data(membership.realm, membership.role))

    @action(detail=True, methods=["post"])
    def leave(self, request, pk=None):
        membership = self._membership(pk)
        new_admin = None
        if new_admin_id := request.data.get("new_admin"):
            new_admin = RealmMembership.objects.filter(realm_id=pk, user_id=new_admin_id).first()
            if new_admin is None:
                raise ValidationError({"new_admin": "They aren't a member of this realm."})
        services.leave(membership, new_admin)
        return Response(status=status.HTTP_204_NO_CONTENT)

    # --- members ---------------------------------------------------------------------------

    @action(detail=True, methods=["get"])
    def members(self, request, pk=None):
        self._membership(pk)
        rows = RealmMembership.objects.filter(realm_id=pk).select_related("user")
        return Response(MemberSerializer(rows, many=True).data)

    @action(detail=True, methods=["patch", "delete"], url_path=r"members/(?P<user_id>\d+)")
    def member(self, request, pk=None, user_id=None):
        me = self._admin(pk)
        target = get_object_or_404(
            RealmMembership.objects.select_related("user", "realm"), realm_id=pk, user_id=user_id
        )
        if request.method == "DELETE":
            if target.pk == me.pk:
                raise ValidationError({"detail": "Use Leave to remove yourself."})
            services.remove_member(target)
            return Response(status=status.HTTP_204_NO_CONTENT)
        role = request.data.get("role")
        if role not in RealmMembership.Role.values:
            raise ValidationError({"role": "Choose admin or member."})
        return Response(MemberSerializer(services.set_role(target, role)).data)

    # --- invitations a realm sent -----------------------------------------------------------

    @action(detail=True, methods=["get", "post"])
    def invitations(self, request, pk=None):
        me = self._admin(pk)
        if request.method == "GET":
            rows = RealmInvitation.objects.filter(realm_id=pk, status=Pending).select_related(
                "invited_by"
            )
            return Response(
                InvitationSerializer(rows, many=True, context={"request": request}).data
            )
        serializer = InvitationSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        invitation = services.invite(
            me.realm,
            serializer.validated_data["email"],
            serializer.validated_data.get("role", RealmMembership.Role.MEMBER),
            request.user,
        )
        sent = services.send_invitation(request, invitation)
        data = InvitationSerializer(invitation, context={"request": request}).data
        return Response({**data, "email_sent": sent}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["delete"], url_path=r"invitations/(?P<invitation_id>\d+)")
    def invitation(self, request, pk=None, invitation_id=None):
        self._admin(pk)
        get_object_or_404(RealmInvitation, realm_id=pk, pk=invitation_id, status=Pending).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # --- invitations the user received ------------------------------------------------------

    @action(detail=False, methods=["get"], url_path="received")
    def received(self, request):
        rows = _received(request.user).select_related("realm", "invited_by")
        return Response(ReceivedInvitationSerializer(rows, many=True).data)

    @action(
        detail=False,
        methods=["post"],
        url_path=r"received/(?P<invitation_id>\d+)/(?P<answer>accept|reject)",
    )
    def answer(self, request, invitation_id=None, answer=None):
        invitation = get_object_or_404(_received(request.user), pk=invitation_id)
        if answer == "reject":
            services.reject(invitation)
            return Response(status=status.HTTP_204_NO_CONTENT)
        membership = services.accept(invitation, request.user)
        return Response(self._realm_data(membership.realm, membership.role))


# --- public: joining by invitation link -----------------------------------------------------


def _pending_by_token(token) -> RealmInvitation:
    return get_object_or_404(
        RealmInvitation.objects.select_related("realm", "invited_by"), token=token, status=Pending
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def invitation_by_token(request, token):
    invitation = _pending_by_token(token)
    return Response(
        {
            "realm_name": invitation.realm.name,
            "email": invitation.email,
            "invited_by": invitation.invited_by.username if invitation.invited_by else None,
            "has_account": get_user_model().objects.filter(email__iexact=invitation.email).exists(),
        }
    )


@api_view(["POST"])
@permission_classes([AllowAny])
def register(request):
    """Creates an account from an invitation link and signs it in. There's no open sign-up."""
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    user = services.register(_pending_by_token(data["invite"]), data["username"], data["password"])
    refresh = RefreshToken.for_user(user)
    return Response(
        {"refresh": str(refresh), "access": str(refresh.access_token)},
        status=status.HTTP_201_CREATED,
    )
