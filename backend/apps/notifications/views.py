from rest_framework import viewsets
from rest_framework.decorators import action, api_view
from rest_framework.response import Response

from .delivery import DeliveryError
from .models import DeliverySettings, SummarySchedule
from .serializers import DeliverySettingsSerializer, SummaryScheduleSerializer
from .services import reschedule, send_summary


class SummaryScheduleViewSet(viewsets.ModelViewSet):
    queryset = SummarySchedule.objects.all()
    serializer_class = SummaryScheduleSerializer

    def perform_create(self, serializer):
        self._save(serializer)

    def perform_update(self, serializer):
        self._save(serializer)

    def _save(self, serializer):
        schedule = serializer.save()
        reschedule(schedule)
        schedule.save(update_fields=["next_run_at", "is_enabled"])

    @action(detail=True, methods=["post"])
    def test(self, request, pk=None):
        """Sends now and reports what really happened. Doesn't touch the schedule.

        Synchronous on purpose: a queued job could only say "accepted", which is exactly the
        false comfort someone pressing Test is trying to rule out.
        """
        try:
            send_summary(self.get_object())
        except DeliveryError as exc:
            return Response({"sent": False, "error": str(exc)})
        return Response({"sent": True, "error": ""})


@api_view(["GET", "PATCH"])
def delivery_settings(request):
    settings = DeliverySettings.load()
    if request.method == "GET":
        return Response(DeliverySettingsSerializer(settings).data)
    serializer = DeliverySettingsSerializer(settings, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data)
