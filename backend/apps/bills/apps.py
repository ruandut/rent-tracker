from django.apps import AppConfig


class BillsConfig(AppConfig):
    name = "apps.bills"
    label = "bills"

    def ready(self):
        from . import defaults  # noqa: F401  (connects the realm_created receiver)
