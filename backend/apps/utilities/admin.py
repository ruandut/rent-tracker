from django.contrib import admin

from .models import MunicipalCharge, UtilityReading


@admin.register(UtilityReading)
class UtilityReadingAdmin(admin.ModelAdmin):
    list_display = ["period", "rental_unit", "kind", "usage", "cost"]
    list_filter = ["kind", "rental_unit"]


@admin.register(MunicipalCharge)
class MunicipalChargeAdmin(admin.ModelAdmin):
    list_display = ["period", "rental_unit", "category", "amount"]
    list_filter = ["category", "rental_unit"]
