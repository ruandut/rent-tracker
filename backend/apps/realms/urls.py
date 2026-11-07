from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter(trailing_slash=True)
router.register("realms", views.RealmViewSet, basename="realm")

urlpatterns = [
    path("auth/register/", views.register, name="register"),
    path("auth/invitations/<uuid:token>/", views.invitation_by_token, name="invitation-by-token"),
    *router.urls,
]
