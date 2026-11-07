"""Demo data: a login and a realm with two units, accounts, people, tags and ~12 months of
activity.

Idempotent: re-running only tops up what's missing (the transaction history is created
once, when the realm has no transactions yet). `--reset` wipes the demo realm's ledger, bill and
utility data first.
"""

import random
from datetime import date
from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.bills.models import Bill
from apps.ledger.models import Beneficiary, PaymentMethod, RentalUnit, Tag, Transaction
from apps.realms.models import RealmMembership
from apps.realms.services import create_realm
from apps.utilities.models import MunicipalCharge, UtilityReading

DEMO_USER = ("admin", "admin")
DEMO_REALM = "Demo rentals"
UNITS = [
    ("Flat A", "12 Oak Street, Unit A", Decimal("9500")),
    ("Cottage", "12 Oak Street, Garden Cottage", Decimal("6800")),
]
TAGS = [
    ("rent", "emerald"),
    ("utilities", "sky"),
    ("rates & taxes", "violet"),
    ("insurance", "slate"),
    ("garden", "lime"),
]


def _months(count: int) -> list[date]:
    today = date.today().replace(day=1)
    out = []
    year, month = today.year, today.month
    for _ in range(count):
        out.append(date(year, month, 1))
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    return list(reversed(out))


def _d(value: float) -> Decimal:
    return Decimal(str(round(value, 2)))


class Command(BaseCommand):
    help = "Seed a demo user (admin / admin) and sample data. DEBUG only."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Delete existing data first")

    @transaction.atomic
    def handle(self, *args, reset, **options):
        if not settings.DEBUG:
            raise CommandError("seed only runs with DEBUG=true")
        random.seed(42)

        user, created = get_user_model().objects.get_or_create(
            username=DEMO_USER[0], defaults={"is_staff": True, "is_superuser": True}
        )
        if created:
            user.set_password(DEMO_USER[1])
            user.save()

        # The demo user's oldest realm, which is where the realms migration put earlier demo data.
        membership = (
            RealmMembership.objects.filter(user=user).select_related("realm").order_by("id").first()
        )
        realm = membership.realm if membership else create_realm(user, DEMO_REALM)

        if reset:
            for model in (Bill, MunicipalCharge, UtilityReading, Transaction):
                model.objects.filter(realm=realm).delete()
            for model in (PaymentMethod, Beneficiary, RentalUnit):
                model.objects.filter(realm=realm).delete()
            Tag.objects.filter(realm=realm, is_system=False).delete()

        units = {
            name: RentalUnit.objects.get_or_create(
                realm=realm, name=name, defaults={"address": address}
            )[0]
            for name, address, _ in UNITS
        }
        rent = {name: amount for name, _, amount in UNITS}
        cheque, _ = PaymentMethod.objects.get_or_create(
            realm=realm,
            name="Rental cheque account",
            defaults={
                "kind": PaymentMethod.Kind.BANK_ACCOUNT,
                "institution": "FNB",
                "last4": "4821",
                "opening_balance": Decimal("15000"),
            },
        )
        card, _ = PaymentMethod.objects.get_or_create(
            realm=realm,
            name="Rental credit card",
            defaults={
                "kind": PaymentMethod.Kind.CREDIT_CARD,
                "institution": "FNB",
                "last4": "9034",
            },
        )
        wife, _ = Beneficiary.objects.get_or_create(
            realm=realm, name="Wife", defaults={"relationship": "Spouse – share of the rent"}
        )
        handyman, _ = Beneficiary.objects.get_or_create(
            realm=realm, name="Sipho (handyman)", defaults={"relationship": "Contractor"}
        )
        tags = {
            name: Tag.objects.get_or_create(realm=realm, name=name, defaults={"color": c})[0]
            for name, c in TAGS
        }
        tags["maintenance"] = Tag.objects.get(realm=realm, name="maintenance")

        if Transaction.objects.filter(realm=realm).exists():
            self.stdout.write("Transactions already exist; skipping history (use --reset).")
            return

        today = date.today()

        def add(kind, amount, day, desc, method=cheque, unit=None, who=None, tag_names=()):
            if day > today:
                return
            tx = Transaction.objects.create(
                realm=realm,
                kind=kind,
                amount=_d(amount),
                date=day,
                description=desc,
                payment_method=method,
                rental_unit=unit,
                beneficiary=who,
            )
            tx.tags.set([tags[name] for name in tag_names])
            return tx

        income, expense = Transaction.Kind.INCOME, Transaction.Kind.EXPENSE
        for month in _months(12):
            label = month.strftime("%B")
            for name, unit in units.items():
                add(
                    income,
                    rent[name],
                    month.replace(day=random.randint(1, 3)),
                    f"Rent {label} – {name}",
                    unit=unit,
                    tag_names=["rent"],
                )

                water = random.uniform(8, 18)
                power = random.uniform(220, 480)
                water_cost, power_cost = water * 38.5, power * 3.4
                UtilityReading.objects.create(
                    realm=realm,
                    rental_unit=unit,
                    kind=UtilityReading.Kind.WATER,
                    period=month,
                    usage=_d(water),
                    cost=_d(water_cost),
                )
                UtilityReading.objects.create(
                    realm=realm,
                    rental_unit=unit,
                    kind=UtilityReading.Kind.ELECTRICITY,
                    period=month,
                    usage=_d(power),
                    cost=_d(power_cost),
                )
                add(
                    expense,
                    water_cost + power_cost,
                    month.replace(day=20),
                    f"Municipal utilities {label} – {name}",
                    unit=unit,
                    tag_names=["utilities"],
                )

                rates = 1150 if name == "Flat A" else 780
                paid = add(
                    expense,
                    rates,
                    month.replace(day=7),
                    f"Rates & taxes {label} – {name}",
                    unit=unit,
                    tag_names=["rates & taxes"],
                )
                MunicipalCharge.objects.create(
                    realm=realm,
                    rental_unit=unit,
                    category=MunicipalCharge.Category.RATES_TAXES,
                    period=month,
                    amount=_d(rates),
                    transaction=paid,
                )
                MunicipalCharge.objects.create(
                    realm=realm,
                    rental_unit=unit,
                    category=MunicipalCharge.Category.REFUSE,
                    period=month,
                    amount=_d(245 if name == "Flat A" else 185),
                )

            add(expense, 4000, month.replace(day=5), f"Rent share {label}", who=wife)
            add(
                expense,
                389,
                month.replace(day=1),
                f"Building insurance {label}",
                tag_names=["insurance"],
            )
            if random.random() < 0.5:
                unit = random.choice(list(units.values()))
                job = random.choice(
                    [
                        "Leaking geyser valve",
                        "Fix gate motor",
                        "Repaint bathroom",
                        "Unblock drain",
                        "Replace stove plate",
                    ]
                )
                add(
                    expense,
                    random.uniform(450, 3200),
                    month.replace(day=random.randint(10, 26)),
                    job,
                    method=card,
                    unit=unit,
                    who=handyman,
                    tag_names=["maintenance"],
                )
            if random.random() < 0.4:
                add(
                    expense,
                    random.uniform(300, 700),
                    month.replace(day=15),
                    "Garden service",
                    method=card,
                    tag_names=["garden"],
                )

        count = Transaction.objects.filter(realm=realm).count()
        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded {count} transactions in {realm}. "
                f"Log in as {DEMO_USER[0]} / {DEMO_USER[1]}."
            )
        )
