"""Monthly utility usage (water, electricity) and municipal charges (rates & taxes etc.) per unit.

These are records of what the municipality billed. Paying the bill is still a ledger
Transaction; link it with `transaction` if you want the two tied together.

A row with `bill` set was produced by that logged bill (see services.py) and is changed by
editing the bill. Rows without it are entered by hand.
"""

from django.db import models

from apps.bills.models import Bill
from apps.ledger.models import RentalUnit, Transaction


def _first_of_month(value):
    return value.replace(day=1) if value else value


class UtilityReading(models.Model):
    class Kind(models.TextChoices):
        WATER = "water", "Water"
        ELECTRICITY = "electricity", "Electricity"

    UNITS = {Kind.WATER: "kL", Kind.ELECTRICITY: "kWh"}

    rental_unit = models.ForeignKey(RentalUnit, on_delete=models.CASCADE, related_name="readings")
    kind = models.CharField(max_length=20, choices=Kind.choices)
    # Always the 1st of the month the usage belongs to.
    period = models.DateField()
    meter_reading = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    # Empty when the cost is known but the usage isn't, as on a prepaid electricity bill.
    usage = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True, help_text="kL or kWh"
    )
    cost = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    notes = models.TextField(blank=True)
    bill = models.ForeignKey(
        Bill, on_delete=models.CASCADE, null=True, blank=True, related_name="readings"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-period", "rental_unit__name", "kind"]
        constraints = [
            models.UniqueConstraint(
                fields=["rental_unit", "kind", "period"], name="one_reading_per_unit_kind_month"
            )
        ]

    def __str__(self):
        return f"{self.rental_unit} {self.kind} {self.period:%Y-%m}"

    def save(self, *args, **kwargs):
        self.period = _first_of_month(self.period)
        super().save(*args, **kwargs)


class MunicipalCharge(models.Model):
    class Category(models.TextChoices):
        RATES_TAXES = "rates_taxes", "Rates & taxes"
        REFUSE = "refuse", "Refuse"
        SEWERAGE = "sewerage", "Sewerage"
        LEVY = "levy", "Levy"
        INSURANCE = "insurance", "Insurance"
        OTHER = "other", "Other"

    rental_unit = models.ForeignKey(RentalUnit, on_delete=models.CASCADE, related_name="charges")
    category = models.CharField(max_length=20, choices=Category.choices)
    period = models.DateField()
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    description = models.CharField(max_length=255, blank=True)
    transaction = models.ForeignKey(
        Transaction, on_delete=models.SET_NULL, null=True, blank=True, related_name="charges"
    )
    notes = models.TextField(blank=True)
    bill = models.ForeignKey(
        Bill, on_delete=models.CASCADE, null=True, blank=True, related_name="charges"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-period", "rental_unit__name", "category"]

    def __str__(self):
        return f"{self.rental_unit} {self.category} {self.period:%Y-%m}"

    def save(self, *args, **kwargs):
        self.period = _first_of_month(self.period)
        super().save(*args, **kwargs)
