from django.conf import settings
from django.db import connection
from django.http import FileResponse
from django.views.decorators.cache import never_cache
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
    return Response({"postgres": "ok"})


@never_cache
def spa(request):
    return FileResponse(open(settings.SPA_INDEX, "rb"), content_type="text/html")
