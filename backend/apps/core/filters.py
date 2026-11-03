"""The date-range + rental-unit filter every list screen shares.

Query params: ?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&unit=<id>
Both dates are inclusive. Bad values raise a 400 instead of being silently ignored.
"""

from dataclasses import dataclass
from datetime import date

from django.db.models import Q
from rest_framework.exceptions import ValidationError


@dataclass(frozen=True)
class RangeFilter:
    date_from: date | None = None
    date_to: date | None = None
    unit: int | None = None

    @classmethod
    def from_request(cls, request) -> RangeFilter:
        params = request.query_params
        return cls(
            date_from=_parse_date(params.get("date_from"), "date_from"),
            date_to=_parse_date(params.get("date_to"), "date_to"),
            unit=_parse_int(params.get("unit"), "unit"),
        )

    def q(self, date_field: str = "date", unit_field: str = "rental_unit", prefix: str = "") -> Q:
        """Q for these filters; `prefix` targets a related model (e.g. "transactions__")."""
        q = Q()
        if self.date_from:
            q &= Q(**{f"{prefix}{date_field}__gte": self.date_from})
        if self.date_to:
            q &= Q(**{f"{prefix}{date_field}__lte": self.date_to})
        if self.unit:
            q &= Q(**{f"{prefix}{unit_field}_id": self.unit})
        return q


def _parse_date(value: str | None, name: str) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValidationError({name: "Use YYYY-MM-DD."}) from exc


def _parse_int(value: str | None, name: str) -> int | None:
    if not value:
        return None
    try:
        return int(value)
    except ValueError as exc:
        raise ValidationError({name: "Must be an id."}) from exc
