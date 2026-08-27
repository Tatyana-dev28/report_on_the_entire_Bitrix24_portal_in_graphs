import type { DashboardRefreshStatus } from '../../api/types';

type UpdateStatusBarProps = {
  status: DashboardRefreshStatus | null;
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

export function UpdateStatusBar({ status }: UpdateStatusBarProps) {
  return (
    <div className="dashboard-status-bar" aria-label="Актуальность данных">
      <span>Обновлено: {formatStatusTime(status?.lastSuccessfulUpdateAt ?? null)}</span>
      <span>Следующее обновление: {formatStatusTime(status?.nextUpdateAt ?? null)}</span>
      {status?.isRefreshing ? <strong>Обновляем данные...</strong> : null}
      {status?.lastAttemptFailedAt ? <em>Последняя попытка не удалась</em> : null}
    </div>
  );
}
