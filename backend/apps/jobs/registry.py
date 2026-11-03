"""Find every Hatchet task in the project.

Convention: a Django app that owns background work has `tasks.py` (or a `tasks/` package)
exposing `TASKS = [...]`. The worker registers all of them, so domain apps keep their tasks
next to their models instead of in one central jobs module.
"""

from importlib import import_module
from importlib.util import find_spec

from django.apps import apps


def discover_tasks() -> list:
    found = []
    for config in apps.get_app_configs():
        if not config.name.startswith("apps."):
            continue
        module_name = f"{config.name}.tasks"
        if find_spec(module_name) is None:
            continue
        # Import errors inside a tasks module should fail loudly, not be skipped.
        found.extend(getattr(import_module(module_name), "TASKS", []))
    return found
