import { formatDashboardStatusTime } from '../utils/formatDashboardStatusTime';

type DashboardRefreshStatus = {
  lastSuccessfulUpdateAt: string | null;
  nextUpdateAt: string | null;
  isRefreshing: boolean;
  lastAttemptFailedAt: string | null;
  lastErrorMessage: string;
  phase?: string;
  phaseLabel?: string;
};

type UpdateStatusBarProps = {
  status: DashboardRefreshStatus | null;
  canRefresh?: boolean;
  onRefresh?: () => void;
  isApplyingData?: boolean;
};

export function UpdateStatusBar({
  status,
  canRefresh = false,
  onRefresh,
  isApplyingData = false,
}: UpdateStatusBarProps) {
  const refreshDisabled = !canRefresh || Boolean(status?.isRefreshing) || isApplyingData || !onRefresh;
  const lastUpdated = formatDashboardStatusTime(status?.lastSuccessfulUpdateAt ?? null);
  const liveLabel = status?.isRefreshing
    ? (status.phaseLabel || 'Обновляю данные…')
    : isApplyingData
      ? 'Обновляю экран…'
      : '';

  return (
    <div className="report-update-status-bar" aria-label="Актуальность данных">
      <span>Обновлено: {lastUpdated}</span>
      {liveLabel ? (
        <strong>
          {liveLabel}
          {' '}
          Сейчас на экране данные на {lastUpdated}.
        </strong>
      ) : (
        <span>Следующее обновление: {formatDashboardStatusTime(status?.nextUpdateAt ?? null)}</span>
      )}
      {status?.lastAttemptFailedAt && !status.isRefreshing && !isApplyingData ? (
        <em>
          {status.lastErrorMessage
            || `Обновление в ${formatDashboardStatusTime(status.lastAttemptFailedAt)} не удалось. Обновите страницу и нажмите «Обновить сейчас».`}
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
