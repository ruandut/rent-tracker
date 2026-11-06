from rest_framework import viewsets
from rest_framework.exceptions import ValidationError

from apps.core.filters import RangeFilter

from .models import MunicipalCharge, UtilityReading
from .serializers import MunicipalChargeSerializer, UtilityReadingSerializer


class RangeFilteredViewSet(viewsets.ModelViewSet):
    """Applies the shared date range (on `period`) + unit filter to list requests."""

    def get_queryset(self):
        qs = super().get_queryset().select_related("rental_unit")
        if self.action != "list":
            return qs
        f = RangeFilter.from_request(self.request)
        # A month counts as "in range" if any part of it is: compare against the month start.
        if f.date_from:
            f = RangeFilter(f.date_from.replace(day=1), f.date_to, f.unit)
        return qs.filter(f.q(date_field="period"))

    def _reject_if_from_bill(self, instance):
        if instance.bill_id:
            raise ValidationError({"detail": "This came from a municipal bill. Edit the bill."})

    def perform_update(self, serializer):
        self._reject_if_from_bill(serializer.instance)
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        self._reject_if_from_bill(instance)
        super().perform_destroy(instance)


class UtilityReadingViewSet(RangeFilteredViewSet):
    queryset = UtilityReading.objects.all()
    serializer_class = UtilityReadingSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "list" and (kind := self.request.query_params.get("kind")):
            qs = qs.filter(kind=kind)
        return qs


class MunicipalChargeViewSet(RangeFilteredViewSet):
    queryset = MunicipalCharge.objects.all()
    serializer_class = MunicipalChargeSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "list" and (category := self.request.query_params.get("category")):
            qs = qs.filter(category=category)
        return qs
