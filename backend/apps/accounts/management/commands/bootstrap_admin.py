from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from environ import Env


class Command(BaseCommand):
    help = "Create the first admin from ADMIN_USERNAME / ADMIN_PASSWORD, if missing."

    def handle(self, *args, **options):
        env = Env()
        username = env("ADMIN_USERNAME", default="")
        password = env("ADMIN_PASSWORD", default="")
        if not username or not password:
            raise CommandError("ADMIN_USERNAME and ADMIN_PASSWORD must be set")
        users = get_user_model().objects
        if users.filter(username=username).exists():
            self.stdout.write(f"Admin {username} already exists.")
            return
        users.create_superuser(username=username, password=password)
        self.stdout.write(self.style.SUCCESS(f"Created admin {username}."))
