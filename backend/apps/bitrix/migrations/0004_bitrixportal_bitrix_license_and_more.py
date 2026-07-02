from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("bitrix", "0003_bitrixevent_idempotency_key_hash_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="bitrixportal",
            name="bitrix_license",
            field=models.CharField(blank=True, db_index=True, default="", max_length=100, verbose_name="Bitrix24 LICENSE"),
        ),
        migrations.AddField(
            model_name="bitrixportal",
            name="bitrix_license_checked_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True, verbose_name="Bitrix24 license checked at"),
        ),
        migrations.AddField(
            model_name="bitrixportal",
            name="bitrix_license_family",
            field=models.CharField(blank=True, db_index=True, default="", max_length=100, verbose_name="Bitrix24 LICENSE_FAMILY"),
        ),
        migrations.AddField(
            model_name="bitrixportal",
            name="bitrix_license_type",
            field=models.CharField(blank=True, db_index=True, default="", max_length=100, verbose_name="Bitrix24 LICENSE_TYPE"),
        ),
    ]
