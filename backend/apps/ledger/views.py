from datetime import date

from django.db.models import Count, F, Q, Sum
from django.db.models.deletion import ProtectedError
from django.db.models.functions import Coalesce, TruncMonth
from rest_framework import viewsets
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.core.filters import RangeFilter

from .models import ZERO, Beneficiary, PaymentMethod, RentalUnit, Tag, Transaction
from .serializers import (
    BeneficiarySerializer,
    PaymentMethodSerializer,
    RentalUnitSerializer,
    TagSerializer,
    TransactionSerializer,
)

INCOME = Q(transactions__kind=Transaction.Kind.INCOME)
EXPENSE = Q(transactions__kind=Transaction.Kind.EXPENSE)


def _sum(condition: Q):
    return Coalesce(Sum("transactions__amount", filter=condition), ZERO)


def active_accounts():
    """Active payment methods with their all-time balance, which ignores any filters."""
    return PaymentMethod.objects.filter(is_active=True).annotate(
        balance=F("opening_balance") + _sum(INCOME) - _sum(EXPENSE)
    )


class ProtectedDestroyMixin:
    protected_message = "This is still used by transactions."

    def perform_destroy(self, instance):
        try:
            instance.delete()
        except ProtectedError as exc:
            raise ValidationError({"detail": self.protected_message}) from exc


# NB: Django drops Meta.ordering from aggregated (GROUP BY) queries, so every annotated
# queryset below orders explicitly.


class RentalUnitViewSet(viewsets.ModelViewSet):
    """Units with income/expense totals inside the active date range."""

    serializer_class = RentalUnitSerializer

    def get_queryset(self):
        f = RangeFilter.from_request(self.request)
        # The unit filter narrows the list itself rather than the totals.
        in_range = RangeFilter(f.date_from, f.date_to).q(prefix="transactions__")
        qs = RentalUnit.objects.annotate(
            income=_sum(INCOME & in_range), expense=_sum(EXPENSE & in_range)
        ).order_by("name")
        return qs.filter(id=f.unit) if f.unit and self.action == "list" else qs


class PaymentMethodViewSet(ProtectedDestroyMixin, viewsets.ModelViewSet):
    """Cards/accounts. `balance` is all-time; `income`/`expense` respect the filters."""

    serializer_class = PaymentMethodSerializer
    protected_message = "This payment method has transactions. Mark it inactive instead."

    def get_queryset(self):
        in_range = RangeFilter.from_request(self.request).q(prefix="transactions__")
        return PaymentMethod.objects.annotate(
            balance=F("opening_balance") + _sum(INCOME) - _sum(EXPENSE),
            income=_sum(INCOME & in_range),
            expense=_sum(EXPENSE & in_range),
        ).order_by("-is_active", "name")


class BeneficiaryViewSet(viewsets.ModelViewSet):
    serializer_class = BeneficiarySerializer

    def get_queryset(self):
        in_range = RangeFilter.from_request(self.request).q(prefix="transactions__")
        return Beneficiary.objects.annotate(
            paid=_sum(EXPENSE & in_range),
            received=_sum(INCOME & in_range),
            count=Count("transactions", filter=in_range),
        ).order_by("name")


class TagViewSet(viewsets.ModelViewSet):
    serializer_class = TagSerializer

    def get_queryset(self):
        in_range = RangeFilter.from_request(self.request).q(prefix="transactions__")
        return Tag.objects.annotate(
            total=_sum(EXPENSE & in_range), count=Count("transactions", filter=in_range)
        ).order_by("name")

    def perform_destroy(self, instance):
        if instance.is_system:
            raise ValidationError({"detail": f'"{instance.name}" is a system tag.'})
        instance.delete()


class TransactionViewSet(viewsets.ModelViewSet):
    """All money movement. Filters: date range, unit, kind, payment_method, beneficiary, tag, q."""

    serializer_class = TransactionSerializer

    def get_queryset(self):
        qs = Transaction.objects.select_related(
            "payment_method", "rental_unit", "beneficiary"
        ).prefetch_related("tags")
        if self.action != "list":
            return qs
        params = self.request.query_params
        qs = qs.filter(RangeFilter.from_request(self.request).q())
        if kind := params.get("kind"):
            qs = qs.filter(kind=kind)
        for field in ("payment_method", "beneficiary"):
            if value := params.get(field):
                qs = qs.filter(**{f"{field}_id": value})
        if tag := params.get("tag"):
            qs = qs.filter(tags__id=tag)
        if q := params.get("q"):
            qs = qs.filter(
                Q(description__icontains=q) | Q(reference__icontains=q) | Q(notes__icontains=q)
            )
        return qs.distinct()


def _money(totals: dict) -> dict:
    return {key: float(value) for key, value in totals.items()}


@api_view(["GET"])
def dashboard(request):
    f = RangeFilter.from_request(request)
    today = date.today()
    month_start = today.replace(day=1)

    accounts = active_accounts()
    unit_q = RangeFilter(unit=f.unit).q()
    month = Transaction.objects.filter(unit_q, date__gte=month_start, date__lte=today).totals()
    in_range = Transaction.objects.filter(f.q())

    monthly = (
        in_range.annotate(month=TruncMonth("date"))
        .values("month")
        .annotate(
            income=Coalesce(Sum("amount", filter=Q(kind=Transaction.Kind.INCOME)), ZERO),
            expense=Coalesce(Sum("amount", filter=Q(kind=Transaction.Kind.EXPENSE)), ZERO),
        )
        .order_by("month")
    )
    by_tag = (
        in_range.filter(kind=Transaction.Kind.EXPENSE, tags__isnull=False)
        .values("tags__id", "tags__name", "tags__color")
        .annotate(total=Sum("amount"))
        .order_by("-total")
    )
    recent = in_range.select_related(
        "payment_method", "rental_unit", "beneficiary"
    ).prefetch_related("tags")[:8]

    return Response(
        {
            "balance": float(sum((a.balance for a in accounts), ZERO)),
            "accounts": [
                {"id": a.id, "name": a.name, "kind": a.kind, "balance": float(a.balance)}
                for a in accounts
            ],
            "month": {"start": month_start, **_money(month)},
            "range": _money(in_range.totals()),
            "monthly": [
                {
                    "month": row["month"].strftime("%Y-%m"),
                    "income": float(row["income"]),
                    "expense": float(row["expense"]),
                }
                for row in monthly
            ],
            "by_tag": [
                {
                    "id": row["tags__id"],
                    "name": row["tags__name"],
                    "color": row["tags__color"],
                    "total": float(row["total"]),
                }
                for row in by_tag
            ],
            "recent": TransactionSerializer(recent, many=True).data,
        }
    )
