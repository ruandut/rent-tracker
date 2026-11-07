from rest_framework import serializers

from .models import Beneficiary, PaymentMethod, RentalUnit, Tag, Transaction


class RentalUnitSerializer(serializers.ModelSerializer):
    income = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    expense = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)

    class Meta:
        model = RentalUnit
        fields = ["id", "name", "address", "notes", "is_active", "income", "expense"]


class PaymentMethodSerializer(serializers.ModelSerializer):
    balance = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    income = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    expense = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    moved_in = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    moved_out = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)

    class Meta:
        model = PaymentMethod
        fields = [
            "id",
            "name",
            "kind",
            "institution",
            "last4",
            "opening_balance",
            "is_active",
            "notes",
            "balance",
            "income",
            "expense",
            "moved_in",
            "moved_out",
        ]

    def validate_last4(self, value):
        if value and (len(value) != 4 or not value.isdigit()):
            raise serializers.ValidationError("Enter exactly 4 digits, or leave it blank.")
        return value


class BeneficiarySerializer(serializers.ModelSerializer):
    paid = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    received = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Beneficiary
        fields = ["id", "name", "relationship", "notes", "paid", "received", "count"]


class TagSerializer(serializers.ModelSerializer):
    total = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Tag
        fields = ["id", "name", "color", "is_system", "total", "count"]
        read_only_fields = ["is_system"]


class TransactionSerializer(serializers.ModelSerializer):
    payment_method_name = serializers.CharField(source="payment_method.name", read_only=True)
    transfer_to_name = serializers.CharField(
        source="transfer_to.name", read_only=True, default=None
    )
    rental_unit_name = serializers.CharField(
        source="rental_unit.name", read_only=True, default=None
    )
    beneficiary_name = serializers.CharField(
        source="beneficiary.name", read_only=True, default=None
    )
    tags = serializers.PrimaryKeyRelatedField(many=True, queryset=Tag.objects.all(), required=False)

    class Meta:
        model = Transaction
        fields = [
            "id",
            "kind",
            "amount",
            "date",
            "description",
            "payment_method",
            "payment_method_name",
            "transfer_to",
            "transfer_to_name",
            "rental_unit",
            "rental_unit_name",
            "beneficiary",
            "beneficiary_name",
            "tags",
            "reference",
            "notes",
            "source",
            "created_at",
        ]
        read_only_fields = ["source", "created_at"]

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be more than zero.")
        return value

    def validate(self, attrs):
        current = self.instance
        kind = attrs.get("kind", current.kind if current else None)
        if kind != Transaction.Kind.TRANSFER:
            return {**attrs, "transfer_to": None}

        source = attrs.get("payment_method", current.payment_method if current else None)
        target = attrs.get("transfer_to", current.transfer_to if current else None)
        if target is None:
            raise serializers.ValidationError({"transfer_to": "Choose where the money went."})
        if target == source:
            raise serializers.ValidationError({"transfer_to": "Choose a different account."})
        # A transfer is between your own accounts, so it has no unit, payee or spending tag.
        return {**attrs, "rental_unit": None, "beneficiary": None, "tags": []}
