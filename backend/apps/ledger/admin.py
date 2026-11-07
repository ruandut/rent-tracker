from django.contrib import admin

from .models import Beneficiary, PaymentMethod, RentalUnit, Tag, Transaction

admin.site.register([RentalUnit, PaymentMethod, Beneficiary, Tag])


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = [
        "date",
        "kind",
        "amount",
        "description",
        "payment_method",
        "transfer_to",
        "rental_unit",
    ]
    list_filter = ["kind", "payment_method", "rental_unit", "tags"]
    search_fields = ["description", "reference"]
