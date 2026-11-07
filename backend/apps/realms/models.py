"""Multi-tenancy. A realm is one set of books: its own units, accounts, bills and summaries.

People join realms through memberships, as an admin or a member. Every domain row belongs to
exactly one realm (TenantModel), and every API request works inside one realm (see access.py).
"""

import uuid

from django.conf import settings
from django.db import models


class Realm(models.Model):
    name = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name", "id"]

    def __str__(self):
        return self.name


class TenantModel(models.Model):
    """Base for every row that belongs to a realm. Deleting the realm deletes the row."""

    realm = models.ForeignKey(Realm, on_delete=models.CASCADE, related_name="+")

    class Meta:
        abstract = True


class RealmMembership(models.Model):
    class Role(models.TextChoices):
        ADMIN = "admin", "Admin"
        MEMBER = "member", "Member"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="realm_memberships"
    )
    realm = models.ForeignKey(Realm, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.MEMBER)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["joined_at", "id"]
        constraints = [
            models.UniqueConstraint(fields=["user", "realm"], name="one_membership_per_realm")
        ]

    def __str__(self):
        return f"{self.user} in {self.realm} ({self.role})"

    @property
    def is_admin(self) -> bool:
        return self.role == self.Role.ADMIN


class RealmInvitation(models.Model):
    """An invitation for an email address. Someone with an account accepts it in the app;
    anyone else registers through the link, which carries the token."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"
        REJECTED = "rejected", "Rejected"

    realm = models.ForeignKey(Realm, on_delete=models.CASCADE, related_name="invitations")
    email = models.EmailField()
    role = models.CharField(
        max_length=10, choices=RealmMembership.Role.choices, default=RealmMembership.Role.MEMBER
    )
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    responded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["realm", "email"],
                condition=models.Q(status="pending"),
                name="one_pending_invite_per_realm_email",
            )
        ]

    def __str__(self):
        return f"{self.email} to {self.realm} ({self.status})"


class Profile(models.Model):
    """Per-user settings that Django's own User has no column for.

    A side table rather than a custom user model, which can't be swapped in safely once a
    database exists.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile"
    )
    # The realm a new session opens in. Each browser tab still says which realm it means.
    focused_realm = models.ForeignKey(
        Realm, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    def __str__(self):
        return f"Profile of {self.user}"

    @classmethod
    def of(cls, user) -> Profile:
        return cls.objects.get_or_create(user=user)[0]
