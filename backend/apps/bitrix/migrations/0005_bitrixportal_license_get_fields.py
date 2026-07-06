from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("bitrix", "0004_bitrixportal_bitrix_license_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="bitrixportal",
            name="bitrix_license_edition",
            field=models.CharField(blank=True, db_index=True, default="", max_length=100, verbose_name="Bitrix24 license.get EDITION"),
        ),
        migrations.AddField(
            model_name="bitrixportal",
            name="bitrix_license_kind",
            field=models.CharField(blank=True, db_index=True, default="", max_length=100, verbose_name="Bitrix24 license.get TYPE"),
        ),
        migrations.AddField(
            model_name="bitrixportal",
            name="bitrix_license_max_users",
            field=models.PositiveIntegerField(blank=True, db_index=True, null=True, verbose_name="Bitrix24 license.get MAX_USERS"),
        ),
        migrations.AddField(
            model_name="bitrixportal",
            name="bitrix_license_expire_date",
            field=models.CharField(blank=True, default="", max_length=100, verbose_name="Bitrix24 license.get EXPIRE_DATE"),
        ),
        migrations.AddField(
            model_name="bitrixportal",
            name="bitrix_license_is_demo",
            field=models.BooleanField(blank=True, null=True, verbose_name="Bitrix24 license.get IS_DEMO"),
        ),
    ]
