import re

from django.core.validators import validate_email
from django.utils import timezone
from rest_framework import serializers

from .crypto import encrypt
from .models import DeliverySettings, SummarySchedule

CHAT_ID = re.compile(r"^(-?\d+|@\w+)$")


class DeliverySettingsSerializer(serializers.ModelSerializer):
    """Credentials are write-only: the API only ever says whether they're set."""

    smtp_password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    telegram_bot_token = serializers.CharField(write_only=True, required=False, allow_blank=True)
    has_smtp_password = serializers.SerializerMethodField()
    has_telegram_bot_token = serializers.SerializerMethodField()

    class Meta:
        model = DeliverySettings
        fields = [
            "smtp_host",
            "smtp_port",
            "smtp_username",
            "smtp_use_tls",
            "from_email",
            "smtp_password",
            "telegram_bot_token",
            "has_smtp_password",
            "has_telegram_bot_token",
        ]

    def get_has_smtp_password(self, obj) -> bool:
        return bool(obj.smtp_password_encrypted)

    def get_has_telegram_bot_token(self, obj) -> bool:
        return bool(obj.telegram_bot_token_encrypted)

    def update(self, instance, validated_data):
        # Blank means "leave it as it is", since the form can never show the saved value.
        if password := validated_data.pop("smtp_password", ""):
            instance.smtp_password_encrypted = encrypt(password)
        if token := validated_data.pop("telegram_bot_token", ""):
            instance.telegram_bot_token_encrypted = encrypt(token)
        return super().update(instance, validated_data)


class SummaryScheduleSerializer(serializers.ModelSerializer):
    class Meta:
        model = SummarySchedule
        fields = [
            "id",
            "name",
            "channel",
            "recipient",
            "frequency",
            "start_at",
            "is_enabled",
            "next_run_at",
            "last_sent_at",
            "last_error",
        ]
        read_only_fields = ["next_run_at", "last_sent_at", "last_error"]

    def validate(self, attrs):
        current = self.instance
        channel = attrs.get("channel", current and current.channel)
        recipient = attrs.get("recipient", current and current.recipient).strip()
        if channel == SummarySchedule.Channel.EMAIL:
            try:
                validate_email(recipient)
            except Exception as exc:
                raise serializers.ValidationError({"recipient": "Enter an email address."}) from exc
        elif not CHAT_ID.match(recipient):
            raise serializers.ValidationError(
                {"recipient": "Enter a Telegram chat ID. Bots can't message phone numbers."}
            )
        attrs["recipient"] = recipient

        frequency = attrs.get("frequency", current and current.frequency)
        start_at = attrs.get("start_at", current and current.start_at)
        if frequency == SummarySchedule.Frequency.ONCE and start_at <= timezone.now():
            raise serializers.ValidationError({"start_at": "Pick a time in the future."})
        return attrs
