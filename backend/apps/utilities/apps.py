from django.apps import AppConfig


class UtilitiesConfig(AppConfig):
    name = "apps.utilities"
    label = "utilities"

    def ready(self):
        from . import services  # noqa: F401  (connects the bill_saved receiver)
