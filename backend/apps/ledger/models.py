"""Money in and out of the rental bank account(s).

Amounts are always stored positive; `Transaction.kind` says which way the money moved.
"""

from decimal import Decimal

from django.db import models
from django.db.models import Q, Sum
from django.db.models.functions import Coalesce

ZERO = Decimal("0.00")


class RentalUnit(models.Model):
    name = models.CharField(max_length=100, unique=True)
    address = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class PaymentMethod(models.Model):
    class Kind(models.TextChoices):
        BANK_ACCOUNT = "bank_account", "Bank account"
        CREDIT_CARD = "credit_card", "Credit card"
        DEBIT_CARD = "debit_card", "Debit card"
        CASH = "cash", "Cash"
        OTHER = "other", "Other"

    name = models.CharField(max_length=100, unique=True)
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.BANK_ACCOUNT)
    institution = models.CharField(max_length=100, blank=True)
    last4 = models.CharField("last 4 digits", max_length=4, blank=True)
    # Balance on the day you started tracking; the running balance adds transactions to it.
    opening_balance = models.DecimalField(max_digits=12, decimal_places=2, default=ZERO)
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Beneficiary(models.Model):
    """Someone a payment goes to (or comes from), e.g. a partner who gets a share of the rent."""

    name = models.CharField(max_length=100, unique=True)
    relationship = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "beneficiaries"

    def __str__(self):
        return self.name


class Tag(models.Model):
    name = models.CharField(max_length=50, unique=True)
    color = models.CharField(max_length=20, default="slate")
    # System tags (e.g. "maintenance", created by a migration) can be renamed but not deleted.
    is_system = models.BooleanField(default=False)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class TransactionQuerySet(models.QuerySet):
    def totals(self) -> dict[str, Decimal]:
        """{"income": .., "expense": .., "net": ..} for this queryset."""
        agg = self.aggregate(
            income=Coalesce(Sum("amount", filter=Q(kind=Transaction.Kind.INCOME)), ZERO),
            expense=Coalesce(Sum("amount", filter=Q(kind=Transaction.Kind.EXPENSE)), ZERO),
        )
        return {**agg, "net": agg["income"] - agg["expense"]}


class Transaction(models.Model):
    class Kind(models.TextChoices):
        INCOME = "income", "Income"
        EXPENSE = "expense", "Expense"

    class Source(models.TextChoices):
        MANUAL = "manual", "Manual"
        # Reserved for the Hatchet email-ingestion tasks.
        EMAIL = "email", "Email"

    kind = models.CharField(max_length=10, choices=Kind.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    date = models.DateField(db_index=True)
    description = models.CharField(max_length=255, blank=True)
    payment_method = models.ForeignKey(
        PaymentMethod, on_delete=models.PROTECT, related_name="transactions"
    )
    rental_unit = models.ForeignKey(
        RentalUnit, on_delete=models.SET_NULL, null=True, blank=True, related_name="transactions"
    )
    beneficiary = models.ForeignKey(
        Beneficiary, on_delete=models.SET_NULL, null=True, blank=True, related_name="transactions"
    )
    tags = models.ManyToManyField(Tag, blank=True, related_name="transactions")
    reference = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.MANUAL)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = TransactionQuerySet.as_manager()

    class Meta:
        ordering = ["-date", "-id"]
        constraints = [
            models.CheckConstraint(condition=Q(amount__gt=0), name="transaction_amount_positive"),
        ]

    def __str__(self):
        return f"{self.date} {self.kind} {self.amount} {self.description}"
