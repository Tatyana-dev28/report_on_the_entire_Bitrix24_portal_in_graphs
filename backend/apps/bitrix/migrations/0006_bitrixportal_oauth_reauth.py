from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("bitrix", "0005_bitrixportal_license_get_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="bitrixportal",
            name="oauth_reauth_required",
            field=models.BooleanField(
                db_index=True,
                default=False,
                help_text="Refresh token отозван. Отчёты и склад не ходят в Bitrix, пока портал не откроет или не переустановит приложение.",
                verbose_name="Нужна повторная установка OAuth",
            ),
        ),
        migrations.AddField(
            model_name="bitrixportal",
            name="oauth_reauth_required_at",
            field=models.DateTimeField(
                blank=True,
                null=True,
                verbose_name="Когда Bitrix отклонил refresh token",
            ),
        ),
        migrations.AddField(
            model_name="bitrixportal",
            name="oauth_reauth_error",
            field=models.CharField(
                blank=True,
                default="",
                max_length=255,
                verbose_name="Код ошибки обновления токена",
            ),
        ),
    ]
