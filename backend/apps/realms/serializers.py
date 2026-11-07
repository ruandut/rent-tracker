from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import Realm, RealmInvitation, RealmMembership


class RealmSerializer(serializers.ModelSerializer):
    """A realm as the requesting user sees it. `role` comes from the context's
    {realm id: role} map."""

    role = serializers.SerializerMethodField()
    member_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Realm
        fields = ["id", "name", "role", "member_count", "created_at"]
        read_only_fields = ["created_at"]

    def get_role(self, realm) -> str | None:
        return self.context.get("roles", {}).get(realm.id)

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Give the realm a name.")
        return value


class MemberSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(source="user.id", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)
    email = serializers.CharField(source="user.email", read_only=True)

    class Meta:
        model = RealmMembership
        fields = ["id", "username", "email", "role", "joined_at"]
        read_only_fields = ["joined_at"]


class InvitationSerializer(serializers.ModelSerializer):
    """What a realm's admins see. `link` lets them pass an invite on themselves when email
    isn't set up."""

    invited_by = serializers.CharField(source="invited_by.username", read_only=True, default=None)
    link = serializers.SerializerMethodField()

    class Meta:
        model = RealmInvitation
        fields = ["id", "email", "role", "status", "invited_by", "created_at", "link"]
        read_only_fields = ["status", "created_at"]

    def get_link(self, invitation) -> str | None:
        from .services import invite_link

        request = self.context.get("request")
        if request is None or invitation.status != RealmInvitation.Status.PENDING:
            return None
        return invite_link(request, invitation)


class ReceivedInvitationSerializer(serializers.ModelSerializer):
    """An invitation as its recipient sees it."""

    realm_name = serializers.CharField(source="realm.name", read_only=True)
    invited_by = serializers.CharField(source="invited_by.username", read_only=True, default=None)

    class Meta:
        model = RealmInvitation
        fields = ["id", "realm_name", "role", "invited_by", "created_at"]


class RegisterSerializer(serializers.Serializer):
    invite = serializers.UUIDField()
    username = serializers.RegexField(r"^[\w.@+-]{1,150}$")
    password = serializers.CharField(write_only=True)

    def validate_password(self, value):
        validate_password(value)
        return value
