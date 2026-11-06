"""Lets other domains react to a logged bill without this app importing them."""

from django.dispatch import Signal

# Sent inside the save's transaction with `bill=`; a receiver that raises rolls the save back.
bill_saved = Signal()
