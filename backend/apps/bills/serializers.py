from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

from django.core.validators import FileExtensionValidator
from rest_framework import serializers
from rest_framework.validators import UniqueTogetherValidator

from .models import (
    BILL_FIELDS,
    LINE_FIELDS,
    ZERO,
    Bill,
    BillLine,
    BillTemplate,
    BillUnit,
    Destination,
)
from .services import save_bill, save_template

MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
# The type is taken from this list rather than from what the browser claims.
ATTACHMENT_TYPES = {
    "pdf": "application/pdf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "txt": "text/plain",
    "eml": "message/rfc822",
    "html": "text/html",
}


def attachment_type(filename: str) -> str:
    return ATTACHMENT_TYPES[Path(filename).suffix.lstrip(".").lower()]


class TemplateFieldSerializer(serializers.Serializer):
    key = serializers.RegexField(r"^[a-z][a-z0-9_]{0,49}$")
    label = serializers.CharField(max_length=100)
    type = serializers.ChoiceField(choices=["text", "number", "money", "date"])
    required = serializers.BooleanField(default=False)
    # Shown only on lines charged for usage, like meter readings.
    usage_only = serializers.BooleanField(default=False)


class TemplateItemSerializer(serializers.Serializer):
    label = serializers.CharField(max_length=100)
    charge_type = serializers.ChoiceField(choices=BillLine.ChargeType.choices)


class TemplateSectionSerializer(serializers.Serializer):
    key = serializers.RegexField(r"^[a-z][a-z0-9_]{0,49}$")
    label = serializers.CharField(max_length=100)
    destination = serializers.ChoiceField(choices=Destination.choices)
    usage_unit = serializers.CharField(max_length=20, allow_blank=True, default="")
    fields = TemplateFieldSerializer(many=True, default=list)
    items = TemplateItemSerializer(many=True, default=list)

    def validate_fields(self, fields):
        return _checked_fields(fields, LINE_FIELDS)


def _checked_fields(fields: list[dict], builtin: dict[str, str]) -> list[dict]:
    keys = [field["key"] for field in fields]
    if len(set(keys)) != len(keys):
        raise serializers.ValidationError("Each field needs its own key.")
    for field in fields:
        if field["key"] in builtin and field["type"] != builtin[field["key"]]:
            raise serializers.ValidationError(
                f"{field['label']} is a built-in {builtin[field['key']]} field."
            )
    return fields


class TemplateDefinitionSerializer(serializers.Serializer):
    bill_fields = TemplateFieldSerializer(many=True)
    sections = TemplateSectionSerializer(many=True, allow_empty=False)

    def validate_bill_fields(self, fields):
        fields = _checked_fields(fields, BILL_FIELDS)
        if not any(f["key"] == "account_number" and f["required"] for f in fields):
            raise serializers.ValidationError(
                "A template needs a required account number, which tells bills apart."
            )
        return fields

    def validate_sections(self, sections):
        keys = [section["key"] for section in sections]
        if len(set(keys)) != len(keys):
            raise serializers.ValidationError("Each section needs its own key.")
        return sections


class BillTemplateSerializer(serializers.ModelSerializer):
    definition = serializers.JSONField()
    bill_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = BillTemplate
        fields = ["id", "name", "is_default", "definition", "bill_count"]
        # save_template hands the default over, so a second one isn't a conflict.
        extra_kwargs = {"is_default": {"validators": []}}

    def validate_definition(self, value):
        # Checked on its own: a partial update must still get a complete definition.
        definition = TemplateDefinitionSerializer(data=value)
        definition.is_valid(raise_exception=True)
        return definition.validated_data

    def create(self, validated_data):
        return save_template(None, validated_data)

    def update(self, instance, validated_data):
        return save_template(instance, validated_data)


def _is_blank(value) -> bool:
    return value is None or value == ""


def _custom_values(fields: list[dict], builtin: dict, values: dict) -> dict:
    """Only the custom fields this layout defines, each checked against its type."""
    clean = {}
    for field in fields:
        value = values.get(field["key"])
        if field["key"] in builtin or _is_blank(value):
            continue
        try:
            if field["type"] in ("number", "money"):
                Decimal(str(value))
            elif field["type"] == "date":
                date.fromisoformat(str(value))
        except (InvalidOperation, ValueError) as exc:
            raise serializers.ValidationError(
                {"extra": f"{field['label']} isn't a valid {field['type']}."}
            ) from exc
        clean[field["key"]] = str(value)
    return clean


class BillLineSerializer(serializers.ModelSerializer):
    total = serializers.DecimalField(max_digits=13, decimal_places=2, read_only=True)
    extra = serializers.DictField(required=False)

    class Meta:
        model = BillLine
        fields = [
            "id",
            "section",
            "charge_type",
            "description",
            "meter_number",
            "meter_previous",
            "meter_current",
            "reading_from",
            "reading_to",
            "usage",
            "amount_excl",
            "vat",
            "extra",
            "total",
        ]


class BillUnitSerializer(serializers.ModelSerializer):
    rental_unit_name = serializers.CharField(source="rental_unit.name", read_only=True)
    total = serializers.SerializerMethodField()
    lines = BillLineSerializer(many=True, required=False)

    class Meta:
        model = BillUnit
        fields = ["id", "rental_unit", "rental_unit_name", "total", "lines"]

    def get_total(self, share) -> Decimal:
        return sum((line.total for line in share.lines.all()), ZERO)


class BillSummarySerializer(serializers.ModelSerializer):
    """A bill without its lines or raw content: what the list screen needs.

    With `unit` in the context, the money covers only that unit's share.
    """

    template_name = serializers.SerializerMethodField()
    total_excl = serializers.SerializerMethodField()
    total_vat = serializers.SerializerMethodField()
    total = serializers.SerializerMethodField()
    services = serializers.SerializerMethodField()
    units = serializers.SerializerMethodField()

    class Meta:
        model = Bill
        fields = [
            "id",
            "template",
            "template_name",
            "period",
            "account_number",
            "invoice_number",
            "statement_date",
            "due_date",
            "opening_balance",
            "stated_total",
            "amount_due",
            "total_excl",
            "total_vat",
            "total",
            "services",
            "units",
        ]

    def get_template_name(self, bill) -> str:
        return bill.layout.get("name", "")

    def _lines(self, bill) -> list[BillLine]:
        unit = self.context.get("unit")
        return [
            line
            for share in bill.units.all()
            if not unit or share.rental_unit_id == unit
            for line in share.lines.all()
        ]

    def get_total_excl(self, bill) -> Decimal:
        return sum((line.amount_excl for line in self._lines(bill)), ZERO)

    def get_total_vat(self, bill) -> Decimal:
        return sum((line.vat for line in self._lines(bill)), ZERO)

    def get_total(self, bill) -> Decimal:
        return sum((line.total for line in self._lines(bill)), ZERO)

    def get_services(self, bill) -> dict:
        """{service label: {total, usage, usage_unit, destination}}, in the layout's order."""
        lines = self._lines(bill)
        services: dict = {}
        for section in bill.layout.get("sections", []):
            mine = [line for line in lines if line.section == section["key"]]
            if not mine:
                continue
            usages = [line.usage for line in mine if line.usage is not None]
            services[section["label"]] = {
                "total": sum((line.total for line in mine), ZERO),
                "usage": sum(usages) if usages else None,
                "usage_unit": section.get("usage_unit", ""),
                "destination": section["destination"],
            }
        return services

    def get_units(self, bill) -> list[dict]:
        return [
            {
                "rental_unit": share.rental_unit_id,
                "rental_unit_name": share.rental_unit.name,
                "total": sum((line.total for line in share.lines.all()), ZERO),
            }
            for share in bill.units.all()
        ]


class BillSerializer(BillSummarySerializer):
    units = BillUnitSerializer(many=True, allow_empty=False)
    attachment = serializers.SerializerMethodField()
    extra = serializers.DictField(required=False)

    class Meta(BillSummarySerializer.Meta):
        fields = [
            *BillSummarySerializer.Meta.fields,
            "layout",
            "extra",
            "raw_text",
            "notes",
            "attachment",
        ]
        read_only_fields = ["layout"]
        extra_kwargs = {"template": {"required": True, "allow_null": False}}
        validators = [
            UniqueTogetherValidator(
                queryset=Bill.objects.all(),
                fields=["account_number", "period"],
                message="There is already a bill for this account and month.",
            )
        ]

    def to_internal_value(self, data):
        # Normalise before the uniqueness check runs, so any day in a month collides correctly.
        value = super().to_internal_value(data)
        if "period" in value:
            value["period"] = value["period"].replace(day=1)
        return value

    def validate_units(self, units):
        rental_units = [unit["rental_unit"] for unit in units]
        if len(set(rental_units)) != len(rental_units):
            raise serializers.ValidationError("Each rental unit can only appear once on a bill.")
        return units

    def validate(self, attrs):
        # A bill keeps its layout for life, so the template only counts when it's first logged.
        attrs.pop("template", None) if self.instance else None
        layout = (
            self.instance.layout
            if self.instance
            else {"name": attrs["template"].name, **attrs["template"].definition}
        )
        attrs["layout"] = layout

        current = {} if self.instance is None else self.instance.extra
        if "extra" in attrs:
            attrs["extra"] = _custom_values(layout["bill_fields"], BILL_FIELDS, attrs["extra"])
        extra = attrs.get("extra", current)
        for field in layout["bill_fields"]:
            if field["required"]:
                stored = getattr(self.instance, field["key"], None)
                value = extra.get(field["key"], attrs.get(field["key"], stored))
                if _is_blank(value):
                    raise serializers.ValidationError(
                        {field["key"]: f"{field['label']} is needed."}
                    )

        sections = {section["key"]: section for section in layout["sections"]}
        for unit in attrs.get("units", []):
            for line in unit.get("lines", []):
                self._validate_line(line, sections)
        return attrs

    def _validate_line(self, line, sections):
        section = sections.get(line["section"])
        if section is None:
            raise serializers.ValidationError(
                {"units": f"This bill has no section called {line['section']}."}
            )
        keys = {field["key"] for field in section["fields"]}
        if line.get("usage") is not None and "usage" not in keys:
            raise serializers.ValidationError({"usage": f"{section['label']} doesn't track usage."})
        line["extra"] = _custom_values(section["fields"], LINE_FIELDS, line.get("extra", {}))
        for field in section["fields"]:
            if not field["required"]:
                continue
            if field["usage_only"] and line.get("charge_type") != BillLine.ChargeType.USAGE:
                continue
            if _is_blank(line["extra"].get(field["key"], line.get(field["key"]))):
                raise serializers.ValidationError(
                    {"units": f"{field['label']} is needed on {section['label']} lines."}
                )

    def get_attachment(self, bill) -> dict | None:
        # Missing reverse one-to-ones raise a subclass of AttributeError.
        attachment = getattr(bill, "attachment", None)
        if attachment is None:
            return None
        return {
            "filename": attachment.filename,
            "content_type": attachment.content_type,
            "size": attachment.size,
        }

    def create(self, validated_data):
        units = validated_data.pop("units")
        return save_bill(None, validated_data, units)

    def update(self, instance, validated_data):
        units = validated_data.pop("units", None)
        return save_bill(instance, validated_data, units)


class AttachmentUploadSerializer(serializers.Serializer):
    file = serializers.FileField(
        validators=[FileExtensionValidator(allowed_extensions=list(ATTACHMENT_TYPES))]
    )

    def validate_file(self, value):
        if value.size > MAX_ATTACHMENT_BYTES:
            raise serializers.ValidationError("The file is larger than 10 MB.")
        return value
