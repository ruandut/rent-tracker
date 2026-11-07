from django.contrib import admin

from .models import Profile, Realm, RealmInvitation, RealmMembership


class MembershipInline(admin.TabularInline):
    model = RealmMembership
    extra = 0


@admin.register(Realm)
class RealmAdmin(admin.ModelAdmin):
    list_display = ["name", "created_at"]
    inlines = [MembershipInline]


@admin.register(RealmInvitation)
class RealmInvitationAdmin(admin.ModelAdmin):
    list_display = ["email", "realm", "role", "status", "created_at"]
    list_filter = ["status"]


admin.site.register(Profile)
