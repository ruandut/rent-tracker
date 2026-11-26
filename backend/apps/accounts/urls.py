from django.urls import path
from foundation.security.views import LoginView
from rest_framework_simplejwt.views import TokenRefreshView

from . import views

urlpatterns = [
    # The captcha's challenge, captcha/, comes from foundation.security.urls (config/urls.py).
    path("token/", LoginView.as_view(), name="token_obtain_pair"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("me/", views.me, name="me"),
]
