"""Municipal bills as they arrive: one printed bill, split between any number of rental units.

Bill is the document itself. BillUnit is one rental unit's share of it, and BillLine is a billed
item in that share. Money stays signed the way the bill means it: anything printed in brackets
(rebates, credits) is negative.

Municipalities print different things, so a BillTemplate defines which fields and services a bill
has. Built-in fields map to the columns below, because other code relies on what they mean; a
template can relabel, reorder or drop them. Custom fields are stored in `extra`. A bill copies its
template into `layout` when logged, so editing a template never changes bills already recorded.
"""

from decimal import Decimal

from django.db import models

from apps.ledger.models import RentalUnit

ZERO = Decimal("0.00")


# Field key -> type, for the fields with a column of their own.
BILL_FIELDS = {
    "account_number": "text",
    "invoice_number": "text",
    "statement_date": "date",
    "due_date": "date",
    "opening_balance": "money",
    "stated_total": "money",
    "amount_due": "money",
}
LINE_FIELDS = {
    "vat": "money",
    "meter_number": "text",
    "meter_previous": "number",
    "meter_current": "number",
    "reading_from": "date",
    "reading_to": "date",
    "usage": "number",
}


class Destination(models.TextChoices):
    """Where a service's cost goes once a bill is saved."""

    WATER = "water", "Water readings"
    ELECTRICITY = "electricity", "Electricity readings"
    RATES_TAXES = "rates_taxes", "Rates & taxes"
    REFUSE = "refuse", "Refuse"
    SEWERAGE = "sewerage", "Sewerage"
    LEVY = "levy", "Levy"
    INSURANCE = "insurance", "Insurance"
    OTHER = "other", "Other charges"
    NONE = "none", "Nowhere, bill only"


class BillTemplate(models.Model):
    """A municipality's bill layout. `definition` is checked by TemplateDefinitionSerializer."""

    name = models.CharField(max_length=100, unique=True)
    is_default = models.BooleanField(default=False)
    definition = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-is_default", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["is_default"],
                condition=models.Q(is_default=True),
                name="one_default_bill_template",
            )
        ]

    def __str__(self):
        return self.name


class Bill(models.Model):
    template = models.ForeignKey(
        BillTemplate, on_delete=models.SET_NULL, null=True, blank=True, related_name="bills"
    )
    # This bill's own copy of the template, plus its name at the time.
    layout = models.JSONField(default=dict)
    # Always the 1st of the month the bill is for.
    period = models.DateField(db_index=True)
    account_number = models.CharField(max_length=50)
    invoice_number = models.CharField(max_length=50, blank=True)
    statement_date = models.DateField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)
    opening_balance = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    # What the bill itself says, kept apart from the line total so the two can be compared.
    stated_total = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Total levies for the month, including VAT",
    )
    amount_due = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    raw_text = models.TextField("raw bill content", blank=True)
    notes = models.TextField(blank=True)
    extra = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-period", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["account_number", "period"], name="one_bill_per_account_month"
            )
        ]

    def __str__(self):
        return f"Bill {self.account_number} {self.period:%Y-%m}"

    def save(self, *args, **kwargs):
        self.period = self.period.replace(day=1)
        super().save(*args, **kwargs)


class BillUnit(models.Model):
    """One rental unit's share of a printed bill."""

    bill = models.ForeignKey(Bill, on_delete=models.CASCADE, related_name="units")
    # Protected: a unit's billing history shouldn't vanish with the unit.
    rental_unit = models.ForeignKey(
        RentalUnit, on_delete=models.PROTECT, related_name="bill_shares"
    )
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            models.UniqueConstraint(fields=["bill", "rental_unit"], name="one_share_per_bill_unit")
        ]

    def __str__(self):
        return f"{self.rental_unit} on {self.bill}"


class BillLine(models.Model):
    class ChargeType(models.TextChoices):
        BASIC = "basic", "Basic / fixed"
        CAPACITY = "capacity", "Amperage"
        USAGE = "usage", "Usage"
        REBATE = "rebate", "Rebate / free allowance"
        OTHER = "other", "Other"

    bill_unit = models.ForeignKey(BillUnit, on_delete=models.CASCADE, related_name="lines")
    position = models.PositiveSmallIntegerField(default=0)
    # The key of a section in the bill's layout.
    section = models.CharField(max_length=50)
    charge_type = models.CharField(
        max_length=20, choices=ChargeType.choices, default=ChargeType.OTHER
    )
    description = models.CharField(max_length=255, blank=True)
    meter_number = models.CharField(max_length=50, blank=True)
    meter_previous = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    meter_current = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    reading_from = models.DateField(null=True, blank=True)
    reading_to = models.DateField(null=True, blank=True)
    usage = models.DecimalField(
        max_digits=12, decimal_places=3, null=True, blank=True, help_text="kL or kWh"
    )
    amount_excl = models.DecimalField("charge excluding VAT", max_digits=12, decimal_places=2)
    vat = models.DecimalField(max_digits=12, decimal_places=2, default=ZERO)
    extra = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self):
        return f"{self.section}: {self.description}"

    @property
    def total(self) -> Decimal:
        return self.amount_excl + self.vat


class BillAttachment(models.Model):
    """The original file.

    Stored in Postgres so it needs no media volume on the server and can only be reached through
    the authenticated API. It is a separate table so that reading bills never loads the bytes.
    """

    bill = models.OneToOneField(Bill, on_delete=models.CASCADE, related_name="attachment")
    filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)
    size = models.PositiveIntegerField()
    data = models.BinaryField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.filename
