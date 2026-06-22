from django.core.management.base import BaseCommand, CommandError

from apps.bitrix.models import BitrixPortal
from apps.bitrix.services.rest_client import BitrixRestClient, BitrixRestError


class Command(BaseCommand):
    help = "Проверяет Bitrix24 REST client на методе profile."

    def add_arguments(self, parser):
        parser.add_argument(
            "--domain",
            dest="domain",
            default="",
            help="Домен портала, например company.bitrix24.ru.",
        )
        parser.add_argument(
            "--member-id",
            dest="member_id",
            default="",
            help="member_id портала.",
        )

    def handle(self, *args, **options):
        domain = options["domain"]
        member_id = options["member_id"]

        queryset = BitrixPortal.objects.filter(is_active=True)

        if domain:
            queryset = queryset.filter(domain=domain)

        if member_id:
            queryset = queryset.filter(member_id=member_id)

        portal = queryset.order_by("-last_opened_at", "-created_at").first()

        if not portal:
            raise CommandError("Активный портал Bitrix24 не найден.")

        self.stdout.write(f"Portal: {portal.domain}")
        self.stdout.write(f"Member ID: {portal.member_id}")

        client = BitrixRestClient(portal)

        try:
            response = client.call_method("profile")
        except BitrixRestError as error:
            raise CommandError(str(error)) from error

        result = response.result or {}

        self.stdout.write(self.style.SUCCESS("Bitrix REST call success."))

        if isinstance(result, dict):
            self.stdout.write(f"User ID: {result.get('ID') or result.get('id') or '-'}")
            self.stdout.write(
                f"Name: {result.get('NAME') or result.get('name') or '-'}"
            )
            self.stdout.write(
                f"Last name: {result.get('LAST_NAME') or result.get('lastName') or '-'}"
            )
        else:
            self.stdout.write(str(result))