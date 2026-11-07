"""Everything that changes who is in which realm. Views only translate HTTP to these calls."""

from django.apps import apps
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import Profile, Realm, RealmInvitation, RealmMembership
from .signals import realm_created

Role = RealmMembership.Role


def focus(user, realm: Realm | None) -> None:
    profile = Profile.of(user)
    profile.focused_realm = realm
    profile.save(update_fields=["focused_realm"])


@transaction.atomic
def create_realm(user, name: str) -> Realm:
    """A new realm with `user` as its admin, set up with the defaults and focused."""
    realm = Realm.objects.create(name=name.strip())
    RealmMembership.objects.create(user=user, realm=realm, role=Role.ADMIN)
    realm_created.send(sender=Realm, realm=realm)
    focus(user, realm)
    return realm


def _admins(realm: Realm):
    return RealmMembership.objects.filter(realm=realm, role=Role.ADMIN)


def _unfocus(user, realm: Realm) -> None:
    Profile.objects.filter(user=user, focused_realm=realm).update(focused_realm=None)


@transaction.atomic
def set_role(membership: RealmMembership, role: str) -> RealmMembership:
    if membership.is_admin and role != Role.ADMIN and _admins(membership.realm).count() == 1:
        raise ValidationError({"detail": "A realm needs at least one admin."})
    membership.role = role
    membership.save(update_fields=["role"])
    return membership


@transaction.atomic
def remove_member(membership: RealmMembership) -> None:
    if membership.is_admin and _admins(membership.realm).count() == 1:
        raise ValidationError({"detail": "A realm needs at least one admin."})
    membership.delete()
    _unfocus(membership.user, membership.realm)


@transaction.atomic
def leave(membership: RealmMembership, new_admin: RealmMembership | None = None) -> None:
    """Leave a realm. The last admin hands over to `new_admin` first.

    The only member can't leave: that would orphan the books, so they delete the realm instead.
    """
    realm = membership.realm
    others = RealmMembership.objects.filter(realm=realm).exclude(pk=membership.pk)
    if not others.exists():
        raise ValidationError(
            {"detail": "You're the only member. Delete the realm instead if you're done with it."}
        )
    if membership.is_admin and _admins(realm).count() == 1:
        if new_admin is None or new_admin.realm_id != realm.id or new_admin.pk == membership.pk:
            raise ValidationError({"new_admin": "Choose who takes over as admin."})
        set_role(new_admin, Role.ADMIN)
    membership.delete()
    _unfocus(membership.user, realm)


@transaction.atomic
def delete_realm(realm: Realm) -> None:
    """Deletes the realm and all its data.

    Transactions and bill shares protect the accounts and units they point at, so they go first.
    """
    apps.get_model("bills", "Bill").objects.filter(realm=realm).delete()
    apps.get_model("ledger", "Transaction").objects.filter(realm=realm).delete()
    Profile.objects.filter(focused_realm=realm).update(focused_realm=None)
    realm.delete()


def invite_link(request, invitation: RealmInvitation) -> str:
    return request.build_absolute_uri(f"/register?invite={invitation.token}")


def _account_for(email: str):
    return get_user_model().objects.filter(email__iexact=email).first()


@transaction.atomic
def invite(realm: Realm, email: str, role: str, invited_by) -> RealmInvitation:
    email = email.strip().lower()
    account = _account_for(email)
    if account and RealmMembership.objects.filter(realm=realm, user=account).exists():
        raise ValidationError({"email": "They're already a member."})
    if RealmInvitation.objects.filter(
        realm=realm, email__iexact=email, status=RealmInvitation.Status.PENDING
    ).exists():
        raise ValidationError({"email": "They already have a pending invitation."})
    return RealmInvitation.objects.create(
        realm=realm, email=email, role=role, invited_by=invited_by
    )


def send_invitation(request, invitation: RealmInvitation) -> bool:
    """Emails the invitation. False when it couldn't be sent; the link still works."""
    has_account = _account_for(invitation.email) is not None
    inviter = invitation.invited_by.username if invitation.invited_by else "Someone"
    if has_account:
        action = f"Sign in at {request.build_absolute_uri('/realms')} to accept it."
    else:
        action = f"Create your account here to join:\n{invite_link(request, invitation)}"
    try:
        send_mail(
            f"You're invited to {invitation.realm.name} on Rent Tracker",
            f"{inviter} invited you to {invitation.realm.name} on Rent Tracker.\n\n{action}\n",
            settings.DEFAULT_FROM_EMAIL,
            [invitation.email],
        )
    except OSError:
        return False
    return True


def _respond(invitation: RealmInvitation, status: str) -> None:
    if invitation.status != RealmInvitation.Status.PENDING:
        raise ValidationError({"detail": "This invitation was already answered."})
    invitation.status = status
    invitation.responded_at = timezone.now()
    invitation.save(update_fields=["status", "responded_at"])


@transaction.atomic
def accept(invitation: RealmInvitation, user) -> RealmMembership:
    _respond(invitation, RealmInvitation.Status.ACCEPTED)
    membership, _ = RealmMembership.objects.get_or_create(
        user=user, realm=invitation.realm, defaults={"role": invitation.role}
    )
    focus(user, invitation.realm)
    return membership


@transaction.atomic
def reject(invitation: RealmInvitation) -> None:
    _respond(invitation, RealmInvitation.Status.REJECTED)


@transaction.atomic
def register(invitation: RealmInvitation, username: str, password: str):
    """A new account for the invited address, which joins the invitation's realm."""
    if invitation.status != RealmInvitation.Status.PENDING:
        raise ValidationError({"detail": "This invitation was already answered."})
    users = get_user_model().objects
    if users.filter(username__iexact=username).exists():
        raise ValidationError({"username": "That username is taken."})
    if _account_for(invitation.email):
        raise ValidationError(
            {"detail": "This address already has an account. Sign in to accept the invitation."}
        )
    user = users.create_user(username=username, email=invitation.email, password=password)
    accept(invitation, user)
    return user
