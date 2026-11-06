from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter(trailing_slash=True)
router.register("bills", views.BillViewSet, basename="bill")
router.register("bill-templates", views.BillTemplateViewSet, basename="bill-template")

urlpatterns = router.urls
