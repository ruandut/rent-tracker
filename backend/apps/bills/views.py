from django.db.models import Count, Prefetch
from django.http import HttpResponse
from django.utils.http import content_disposition_header
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from apps.core.filters import RangeFilter
from apps.realms.access import RealmScopedViewSet

from .models import Bill, BillAttachment, BillTemplate, Meter
from .pdf_reader import ReadError, extract_text, read_bill
from .serializers import (
    AttachmentUploadSerializer,
    BillPdfSerializer,
    BillSerializer,
    BillSummarySerializer,
    BillTemplateSerializer,
    MeterSerializer,
    attachment_type,
)


class BillTemplateViewSet(RealmScopedViewSet):
    """The bill layouts to choose from. Bills keep their own copy, so these stay safe to change."""

    serializer_class = BillTemplateSerializer
    # Annotating drops Meta.ordering, so it's spelled out again.
    queryset = BillTemplate.objects.annotate(bill_count=Count("bills")).order_by(
        "-is_default", "name"
    )

    def perform_destroy(self, instance):
        if instance.is_default:
            raise ValidationError(
                {"detail": "This is the default template. Make another one the default first."}
            )
        instance.delete()


class MeterViewSet(RealmScopedViewSet):
    """Municipal meters and the units they serve, so a bill PDF's lines find their unit."""

    serializer_class = MeterSerializer
    queryset = Meter.objects.select_related("rental_unit")


class BillViewSet(RealmScopedViewSet):
    """Logged bills. The list takes the shared date range and rental unit filters."""

    def get_serializer_class(self):
        return BillSummarySerializer if self.action == "list" else BillSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if self.action == "list":
            context["unit"] = RangeFilter.from_request(self.request).unit
        return context

    def get_queryset(self):
        qs = Bill.objects.prefetch_related("units__rental_unit", "units__lines")
        if self.action != "list":
            return qs.prefetch_related(Prefetch("attachment", BillAttachment.objects.defer("data")))
        f = RangeFilter.from_request(self.request)
        # A month counts as "in range" if any part of it is: compare against the month start.
        date_from = f.date_from.replace(day=1) if f.date_from else None
        in_range = RangeFilter(date_from, f.date_to, f.unit)
        return qs.filter(
            in_range.q(date_field="period", unit_field="units__rental_unit")
        ).distinct()

    @action(detail=False, methods=["post"], url_path="read-pdf", parser_classes=[MultiPartParser])
    def read_pdf(self, request):
        """Reads a bill PDF into a draft for the editor. Nothing is saved."""
        upload = BillPdfSerializer(data=request.data, context={"realm": request.realm})
        upload.is_valid(raise_exception=True)
        template = upload.validated_data["template"]
        owners = dict(
            Meter.objects.filter(realm=request.realm).values_list("number", "rental_unit_id")
        )
        try:
            text = extract_text(upload.validated_data["file"].read())
            draft = read_bill(text, template.definition, owners)
        except ReadError as exc:
            raise ValidationError({"file": [str(exc)]}) from exc
        existing = Bill.objects.filter(
            realm=request.realm,
            account_number=draft["values"]["account_number"],
            period=draft["period"],
        ).first()
        return Response({**draft, "existing_bill": existing.id if existing else None})

    @action(detail=True, methods=["get", "post", "delete"], parser_classes=[MultiPartParser])
    def attachment(self, request, pk=None):
        """GET downloads the original file, POST replaces it, DELETE removes it."""
        bill = self.get_object()
        if request.method == "POST":
            upload = AttachmentUploadSerializer(data=request.data)
            upload.is_valid(raise_exception=True)
            file = upload.validated_data["file"]
            BillAttachment.objects.update_or_create(
                bill=bill,
                defaults={
                    "filename": file.name,
                    "content_type": attachment_type(file.name),
                    "size": file.size,
                    "data": file.read(),
                },
            )
            return Response(status=status.HTTP_204_NO_CONTENT)

        attachment = BillAttachment.objects.filter(bill=bill).first()
        if attachment is None:
            raise NotFound("This bill has no attachment.")
        if request.method == "DELETE":
            attachment.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        return HttpResponse(
            bytes(attachment.data),
            content_type=attachment.content_type,
            headers={
                "Content-Disposition": content_disposition_header(True, attachment.filename),
            },
        )
