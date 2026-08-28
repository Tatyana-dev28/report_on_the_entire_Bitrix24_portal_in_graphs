import { useState } from 'react';
import { AccessConfirmationCard } from '../components/access/AccessConfirmationCard';
import { DashboardShell } from '../components/layout/DashboardShell';
import { ReportPlaceholder } from '../components/report/ReportPlaceholder';
import { UpdateStatusBar } from '../components/status/UpdateStatusBar';
import { useDashboardBootstrap } from '../hooks/useDashboardBootstrap';

export function OwnerDashboardPage() {
  const { data, loading, error } = useDashboardBootstrap();
  const [accessNotice, setAccessNotice] = useState('');

  const showAccessConfirmation = !loading && !error && data?.access === 'needs_confirmation';

  return (
    <DashboardShell>
      <header className="dashboard-header">
        <div>
          <p className="dashboard-eyebrow">Портальный дашборд</p>
          <h1>Аналитика портала</h1>
        </div>
      </header>

      {loading ? <div className="dashboard-state">Проверяем доступ...</div> : null}
      {error ? <div className="dashboard-state is-error">{error}</div> : null}

      {showAccessConfirmation ? (
        <AccessConfirmationCard
          notice={accessNotice}
          onTrustDevice={() =>
            setAccessNotice('Сценарий доверенного устройства подготовлен. Реальное сохранение входа подключим после личной ссылки владельца.')
          }
          onUseTemporaryAccess={() =>
            setAccessNotice('Сценарий временного входа подготовлен. Реальная сессия будет жить только пока страница открыта.')
          }
        />
      ) : null}

      {!loading && !error && !showAccessConfirmation ? (
        <>
          <UpdateStatusBar status={data?.refreshStatus ?? null} />
          <ReportPlaceholder
            reports={data?.reports ?? []}
            selectedReportId={data?.selectedReportId ?? null}
          />
        </>
      ) : null}
    </DashboardShell>
  );
}
