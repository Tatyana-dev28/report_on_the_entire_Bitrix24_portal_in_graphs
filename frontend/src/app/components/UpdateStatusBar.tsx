import { formatDashboardStatusTime } from '../utils/formatDashboardStatusTime';

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

export function UpdateStatusBar({ status, canRefresh = false, onRefresh }: UpdateStatusBarProps) {
  const refreshDisabled = !canRefresh || Boolean(status?.isRefreshing) || !onRefresh;

  return (
    <div className="report-update-status-bar" aria-label="Актуальность данных">
      <span>Обновлено: {formatDashboardStatusTime(status?.lastSuccessfulUpdateAt ?? null)}</span>
      {status?.isRefreshing ? (
        <strong>Обновляем данные... Последние данные: {formatDashboardStatusTime(status.lastSuccessfulUpdateAt)}</strong>
      ) : (
        <span>Следующее обновление: {formatDashboardStatusTime(status?.nextUpdateAt ?? null)}</span>
      )}
      {status?.lastAttemptFailedAt && !status.isRefreshing ? (
        <em>
          Обновление в {formatDashboardStatusTime(status.lastAttemptFailedAt)} не удалось
          {status.lastErrorMessage ? `. ${status.lastErrorMessage}` : ''}
        </em>
      ) : null}
      {canRefresh ? (
        <button
          type="button"
          className={`report-update-now-button${refreshDisabled ? '' : ' is-active'}`}
          disabled={refreshDisabled}
          onClick={onRefresh}
        >
          Обновить сейчас
        </button>
      ) : null}
    </div>
  );
}
