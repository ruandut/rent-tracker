"""Money in and out of the rental bank account(s), and moves between them.

Amounts are always stored positive; `Transaction.kind` says which way the money moved.
"""

from decimal import Decimal

from django.db import models
from django.db.models import F, Q, Sum
from django.db.models.functions import Coalesce

from apps.realms.models import TenantModel

ZERO = Decimal("0.00")


class RentalUnit(TenantModel):
    name = models.CharField(max_length=100)
    address = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["realm", "name"], name="rental_unit_name_unique_in_realm"
            )
        ]

    def __str__(self):
        return self.name


class PaymentMethod(TenantModel):
    class Kind(models.TextChoices):
        BANK_ACCOUNT = "bank_account", "Bank account"
        SAVINGS_ACCOUNT = "savings_account", "Savings account"
        CREDIT_CARD = "credit_card", "Credit card"
        DEBIT_CARD = "debit_card", "Debit card"
        CASH = "cash", "Cash"
        OTHER = "other", "Other"

    name = models.CharField(max_length=100)
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
        constraints = [
            models.UniqueConstraint(
                fields=["realm", "name"], name="payment_method_name_unique_in_realm"
            )
        ]

    def __str__(self):
        return self.name


class Beneficiary(TenantModel):
    """Someone a payment goes to (or comes from), e.g. a partner who gets a share of the rent."""

    name = models.CharField(max_length=100)
    relationship = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "beneficiaries"
        constraints = [
            models.UniqueConstraint(
                fields=["realm", "name"], name="beneficiary_name_unique_in_realm"
            )
        ]

    def __str__(self):
        return self.name


class Tag(TenantModel):
    name = models.CharField(max_length=50)
    color = models.CharField(max_length=20, default="slate")
    # System tags (e.g. "maintenance", made with each realm) can be renamed but not deleted.
    is_system = models.BooleanField(default=False)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["realm", "name"], name="tag_name_unique_in_realm")
        ]

    def __str__(self):
        return self.name


class TransactionQuerySet(models.QuerySet):
    def totals(self) -> dict[str, Decimal]:
        """{"income": .., "expense": .., "net": ..}; transfers count as neither."""
        agg = self.aggregate(
            income=Coalesce(Sum("amount", filter=Q(kind=Transaction.Kind.INCOME)), ZERO),
            expense=Coalesce(Sum("amount", filter=Q(kind=Transaction.Kind.EXPENSE)), ZERO),
        )
        return {**agg, "net": agg["income"] - agg["expense"]}


class Transaction(TenantModel):
    class Kind(models.TextChoices):
        INCOME = "income", "Income"
        EXPENSE = "expense", "Expense"
        # Between two of your own accounts: moves balances, but isn't money earned or spent.
        TRANSFER = "transfer", "Transfer"

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
    # Where a transfer went; `payment_method` is where it came from.
    transfer_to = models.ForeignKey(
        PaymentMethod,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="transfers_in",
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
            models.CheckConstraint(
                condition=Q(kind="transfer", transfer_to__isnull=False)
                | (~Q(kind="transfer") & Q(transfer_to__isnull=True)),
                name="transaction_transfer_has_target",
            ),
            models.CheckConstraint(
                condition=Q(transfer_to__isnull=True) | ~Q(transfer_to=F("payment_method")),
                name="transaction_transfer_between_accounts",
            ),
        ]

    def __str__(self):
        return f"{self.date} {self.kind} {self.amount} {self.description}"
