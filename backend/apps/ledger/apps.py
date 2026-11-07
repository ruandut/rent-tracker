from django.apps import AppConfig


class LedgerConfig(AppConfig):
    name = "apps.ledger"
    label = "ledger"

    def ready(self):
        from . import defaults  # noqa: F401  (connects the realm_created receiver)
