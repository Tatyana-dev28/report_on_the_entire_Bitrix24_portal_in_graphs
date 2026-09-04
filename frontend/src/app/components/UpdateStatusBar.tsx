type DashboardRefreshStatus = {
  lastSuccessfulUpdateAt: string | null;
  nextUpdateAt: string | null;
  isRefreshing: boolean;
  lastAttemptFailedAt: string | null;
  lastErrorMessage: string;
};

type UpdateStatusBarProps = {
  status: DashboardRefreshStatus | null;
  canRefresh?: boolean;
  onRefresh?: () => void;
};

const formatStatusTime = (value: string | null) => {
  if (!value) {
    return 'не задано';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
};

export function UpdateStatusBar({ status, canRefresh = false, onRefresh }: UpdateStatusBarProps) {
  const refreshDisabled = !canRefresh || Boolean(status?.isRefreshing) || !onRefresh;

  return (
    <div className="report-update-status-bar" aria-label="Актуальность данных">
      <span>Обновлено: {formatStatusTime(status?.lastSuccessfulUpdateAt ?? null)}</span>
      {status?.isRefreshing ? (
        <strong>Обновляем данные... Последние данные: {formatStatusTime(status.lastSuccessfulUpdateAt)}</strong>
      ) : (
        <span>Следующее обновление: {formatStatusTime(status?.nextUpdateAt ?? null)}</span>
      )}
      {status?.lastAttemptFailedAt && !status.isRefreshing ? (
        <em>
          Обновление в {formatStatusTime(status.lastAttemptFailedAt)} не удалось
          {status.lastErrorMessage ? `. ${status.lastErrorMessage}` : ''}
        </em>
      ) : null}
      <button
        type="button"
        className={`report-update-now-button${refreshDisabled ? '' : ' is-active'}`}
        disabled={refreshDisabled}
        onClick={onRefresh}
      >
        Обновить сейчас
      </button>
    </div>
  );
}
