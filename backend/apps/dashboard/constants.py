DEFAULT_REFRESH_INTERVAL_MINUTES = 10
ALLOWED_REFRESH_INTERVAL_MINUTES = (10, 30, 60)
REFRESH_RUN_RETENTION_DAYS = 14
SUCCESSFUL_SNAPSHOT_LIMIT = 3
STALE_ACTIVE_REFRESH_MINUTES = 40
STALE_PENDING_REFRESH_MINUTES = 2
STALE_RUNNING_IDLE_MINUTES = 3
REFRESH_HEARTBEAT_SECONDS = 20

REFRESH_PHASE_QUEUED = "queued"
REFRESH_PHASE_FETCHING = "fetching_bitrix"
REFRESH_PHASE_BUILDING = "building_report"
REFRESH_PHASE_SAVING = "saving_snapshot"

REFRESH_PHASE_LABELS = {
    REFRESH_PHASE_QUEUED: "В очереди на обновление…",
    REFRESH_PHASE_FETCHING: "Запрашиваю данные в Битрикс24. Это может занять несколько минут.",
    REFRESH_PHASE_BUILDING: "Собираю отчёт…",
    REFRESH_PHASE_SAVING: "Сохраняю данные…",
}

REFRESH_ERROR_BITRIX = (
    "Битрикс24 сейчас не отдал данные. Предыдущий отчёт сохранён — попробуйте ещё раз через пару минут."
)
REFRESH_ERROR_STALE = (
    "Обновление зависло и было остановлено. Обновите страницу и нажмите «Обновить сейчас»."
)
REFRESH_ERROR_GENERIC = (
    "Не удалось обновить данные. Обновите страницу и нажмите «Обновить сейчас»."
)
DASHBOARD_REFRESH_TICK_SECONDS = 60
DASHBOARD_ACCESS_COOKIE_NAME = "sapp_dashboard_access"
DASHBOARD_TRUSTED_DEVICE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 10
DASHBOARD_LAUNCH_TOKEN_MAX_AGE_SECONDS = 5 * 60
DASHBOARD_SHARE_COOKIE_NAME = "sapp_dashboard_share"
ALLOWED_SHARE_TTL_DAYS = (1, 7, 30)
