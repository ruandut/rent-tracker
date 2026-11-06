from rest_framework import serializers
from rest_framework.validators import UniqueTogetherValidator

from .models import MunicipalCharge, UtilityReading


def _first_of_month(value):
    return value.replace(day=1)


class UtilityReadingSerializer(serializers.ModelSerializer):
    rental_unit_name = serializers.CharField(source="rental_unit.name", read_only=True)

    class Meta:
        model = UtilityReading
        fields = [
            "id",
            "rental_unit",
            "rental_unit_name",
            "kind",
            "period",
            "meter_reading",
            "usage",
            "cost",
            "notes",
            "bill",
        ]
        read_only_fields = ["bill"]
        validators = [
            UniqueTogetherValidator(
                queryset=UtilityReading.objects.all(),
                fields=["rental_unit", "kind", "period"],
                message="There is already a reading for this unit, type and month.",
            )
        ]

    def to_internal_value(self, data):
        # Normalise before the uniqueness check runs, so any day in a month collides correctly.
        value = super().to_internal_value(data)
        if "period" in value:
            value["period"] = _first_of_month(value["period"])
        return value


class MunicipalChargeSerializer(serializers.ModelSerializer):
    rental_unit_name = serializers.CharField(source="rental_unit.name", read_only=True)

    class Meta:
        model = MunicipalCharge
        fields = [
            "id",
            "rental_unit",
            "rental_unit_name",
            "category",
            "period",
            "amount",
            "description",
            "transaction",
            "notes",
            "bill",
        ]
        read_only_fields = ["bill"]

    def validate_period(self, value):
        return _first_of_month(value)
