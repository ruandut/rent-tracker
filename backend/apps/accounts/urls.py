from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from . import captcha, views

urlpatterns = [
    path("captcha/", captcha.ChallengeView.as_view(), name="captcha"),
    path("token/", views.LoginView.as_view(), name="token_obtain_pair"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("me/", views.me, name="me"),
]
