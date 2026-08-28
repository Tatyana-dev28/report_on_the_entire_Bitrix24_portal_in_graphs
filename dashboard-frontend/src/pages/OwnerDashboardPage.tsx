import { useState } from 'react';
import { confirmOwnerDashboardAccess } from '../api/dashboardApi';
import { AccessConfirmationCard } from '../components/access/AccessConfirmationCard';
import { DashboardShell } from '../components/layout/DashboardShell';
import { ReportPlaceholder } from '../components/report/ReportPlaceholder';
import { UpdateStatusBar } from '../components/status/UpdateStatusBar';
import { useDashboardBootstrap } from '../hooks/useDashboardBootstrap';

export function OwnerDashboardPage() {
  const { data, loading, error } = useDashboardBootstrap();
  const [accessNotice, setAccessNotice] = useState('');
  const [accessBusy, setAccessBusy] = useState(false);

  const showAccessConfirmation = !loading && !error && data?.access === 'needs_confirmation';

  const confirmAccess = (trusted: boolean) => {
    setAccessBusy(true);
    setAccessNotice('');

    confirmOwnerDashboardAccess(trusted)
      .then(() => {
        setAccessNotice(
          trusted
            ? 'Вход сохранён на этом компьютере.'
            : 'Временный вход активен до закрытия страницы.',
        );
      })
      .catch((confirmError) => {
        setAccessNotice(
          confirmError instanceof Error
            ? confirmError.message
            : 'Не удалось подтвердить вход в WEB-дашборд.',
        );
      })
      .finally(() => {
        setAccessBusy(false);
      });
  };

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
          busy={accessBusy}
          onTrustDevice={() => confirmAccess(true)}
          onUseTemporaryAccess={() => confirmAccess(false)}
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
