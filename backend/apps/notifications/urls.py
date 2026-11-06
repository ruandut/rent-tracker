from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter(trailing_slash=True)
router.register("schedules", views.SummaryScheduleViewSet, basename="schedule")

urlpatterns = [path("settings/", views.delivery_settings, name="delivery-settings"), *router.urls]
