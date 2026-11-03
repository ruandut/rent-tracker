from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter(trailing_slash=True)
router.register("readings", views.UtilityReadingViewSet, basename="reading")
router.register("charges", views.MunicipalChargeViewSet, basename="charge")

urlpatterns = router.urls
