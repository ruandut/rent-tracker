from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter(trailing_slash=True)
router.register("units", views.RentalUnitViewSet, basename="unit")
router.register("payment-methods", views.PaymentMethodViewSet, basename="payment-method")
router.register("beneficiaries", views.BeneficiaryViewSet, basename="beneficiary")
router.register("tags", views.TagViewSet, basename="tag")
router.register("transactions", views.TransactionViewSet, basename="transaction")

urlpatterns = [path("dashboard/", views.dashboard, name="dashboard"), *router.urls]
