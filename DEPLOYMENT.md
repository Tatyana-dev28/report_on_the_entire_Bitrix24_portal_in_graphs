# Deployment checklist

This project is ready for an MVP-style VPS deployment with the database and Redis
running on the same server as the app.

## Server services

Install on the VPS:

- Python 3.12+ and build tools
- Node.js 20+
- MySQL server
- Redis server
- nginx

Keep MySQL and Redis private:

- MySQL host: `127.0.0.1`
- Redis URL: `redis://127.0.0.1:6379/1`
- Do not open ports `3306` or `6379` in the firewall.

## Backend env

Create `backend/.env` on the VPS from `backend/.env.example`.

For production use values like:

```env
DEBUG=false
SECRET_KEY=<long-random-secret>
FIELD_ENCRYPTION_KEY=<fernet-key>
FIELD_HASH_SECRET=<long-random-secret>

ALLOWED_HOSTS=api.example.com,example.com
CORS_ALLOWED_ORIGINS=https://example.com
CSRF_TRUSTED_ORIGINS=https://api.example.com,https://example.com

DATABASE_ENGINE=mysql
MYSQL_DATABASE=bitrix_reports
MYSQL_USER=bitrix_reports
MYSQL_PASSWORD=<strong-password>
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306

CACHE_BACKEND=redis
REDIS_URL=redis://127.0.0.1:6379/1
REPORT_SESSION_CACHE_TTL_SECONDS=1800
REPORT_BACKGROUND_BACKEND=celery
CELERY_BROKER_URL=redis://127.0.0.1:6379/2
CELERY_RESULT_BACKEND=redis://127.0.0.1:6379/2
SENTRY_DSN=
SENTRY_ENVIRONMENT=production

USE_X_FORWARDED_HOST=true
SECURE_PROXY_SSL_HEADER=true
SECURE_SSL_REDIRECT=true
SESSION_COOKIE_SECURE=true
CSRF_COOKIE_SECURE=true
SECURE_HSTS_SECONDS=0
ALLOW_IFRAME_EMBED=true

BITRIX_CLIENT_ID=<bitrix-app-client-id>
BITRIX_CLIENT_SECRET=<bitrix-app-client-secret>
BITRIX_PORTAL_TOKEN_MAX_AGE_SECONDS=43200
REPORT_DATA_PROVIDER=bitrix
FRONTEND_URL=https://example.com

ROBOKASSA_MERCHANT_LOGIN=<robokassa-merchant-login>
ROBOKASSA_PASSWORD1=<robokassa-password-1>
ROBOKASSA_PASSWORD2=<robokassa-password-2>
ROBOKASSA_TEST_MODE=false
ROBOKASSA_PAYMENT_URL=https://auth.robokassa.ru/Merchant/Index.aspx
ROBOKASSA_RECEIPT_TAX=none
ROBOKASSA_RECEIPT_SNO=
```

Enable HSTS only after HTTPS is verified:

```env
SECURE_HSTS_SECONDS=31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS=true
SECURE_HSTS_PRELOAD=true
```

## Backend commands

Run from the project root:

```bash
python -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
python backend/manage.py migrate
python backend/manage.py collectstatic --noinput
python backend/manage.py check --deploy
gunicorn config.wsgi:application --chdir backend --bind 127.0.0.1:8000
celery -A config.celery:app worker --workdir backend --loglevel=INFO --concurrency=2
```

For systemd, run gunicorn and celery worker as two separate services from the
same virtualenv. Bind gunicorn to `127.0.0.1:8000`. nginx should proxy `/api/`,
`/admin/`, and `/bitrix/` to gunicorn.

## Frontend env and build

Create `frontend/.env.production` from `frontend/.env.production.example`:

```env
VITE_USE_MOCK_DATA=false
VITE_API_BASE_URL=https://api.example.com
```

Then build:

```bash
cd frontend
npm ci
npm run build
```

Serve `frontend/dist` through nginx.

## MySQL backup

Add a daily cron backup on the VPS. Example:

```bash
mkdir -p /var/backups/bitrix-reports
mysqldump -u bitrix_reports -p bitrix_reports | gzip > /var/backups/bitrix-reports/bitrix_reports_$(date +%F).sql.gz
find /var/backups/bitrix-reports -type f -mtime +14 -delete
```

Prefer a root-only `.my.cnf` or a protected backup script so the password is not
visible in shell history.

## Bitrix24 settings

After the domain is ready, update the Bitrix24 app settings to use the real
HTTPS URLs for the app page and OAuth/install handlers. Then install the app in
a test portal and check:

- catalog loads from `GET /api/reports/catalog/`
- preview builds through `POST /api/reports/preview/`
- OAuth token errors are shown clearly in the frontend
- report results are stored in Redis, while MySQL keeps session metadata

## Robokassa settings

In the Robokassa cabinet, set the URLs to the public backend domain:

```text
Result URL:  https://api.example.com/api/billing/robokassa/result/
Success URL: https://api.example.com/api/billing/robokassa/success/
Fail URL:    https://api.example.com/api/billing/robokassa/fail/
```

Use `POST` for Result URL if the cabinet asks for a method. Keep
`ROBOKASSA_TEST_MODE=true` until the full payment loop is verified, then switch
it to `false` and restart the backend.

Set `ROBOKASSA_RECEIPT_TAX` to the VAT code that matches the seller's tax
settings in Robokassa. The default `none` means VAT is not charged. Fill
`ROBOKASSA_RECEIPT_SNO` only when Robokassa requires the taxation system for
fiscal receipts.
