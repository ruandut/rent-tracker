"""Lets domain apps set up a new realm (default tags, bill templates) without this app importing
them."""

from django.dispatch import Signal

# Sent inside the creating transaction with `realm=`.
realm_created = Signal()
