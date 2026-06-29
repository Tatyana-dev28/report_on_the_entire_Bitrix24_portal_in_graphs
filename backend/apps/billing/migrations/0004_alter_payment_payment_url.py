from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("billing", "0003_paymentwebhookevent_idempotency_key_hash_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="payment",
            name="payment_url",
            field=models.URLField(
                blank=True,
                max_length=4096,
                verbose_name="Ссылка на оплату",
            ),
        ),
    ]
