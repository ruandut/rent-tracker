from django.contrib import admin

from .models import Bill, BillLine, BillTemplate, BillUnit


class BillUnitInline(admin.TabularInline):
    model = BillUnit
    extra = 0
    show_change_link = True


class BillLineInline(admin.TabularInline):
    model = BillLine
    extra = 0


admin.site.register(BillTemplate)


@admin.register(Bill)
class BillAdmin(admin.ModelAdmin):
    list_display = ["period", "account_number", "invoice_number", "stated_total"]
    inlines = [BillUnitInline]


@admin.register(BillUnit)
class BillUnitAdmin(admin.ModelAdmin):
    list_display = ["bill", "rental_unit"]
    inlines = [BillLineInline]
