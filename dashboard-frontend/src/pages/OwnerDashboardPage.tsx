import { useState } from 'react';
import { confirmOwnerDashboardAccess } from '../api/dashboardApi';
import { AccessConfirmationCard } from '../components/access/AccessConfirmationCard';
import { DashboardShell } from '../components/layout/DashboardShell';
import { DashboardReportView } from '../components/report/DashboardReportView';
import { UpdateStatusBar } from '../components/status/UpdateStatusBar';
import { useDashboardBootstrap } from '../hooks/useDashboardBootstrap';

export function OwnerDashboardPage() {
  const { data, loading, error } = useDashboardBootstrap();
  const [accessNotice, setAccessNotice] = useState('');
  const [accessBusy, setAccessBusy] = useState(false);

  const apiNotConfigured = error === 'VITE_API_BASE_URL is not set.';
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
      {error && !apiNotConfigured ? <div className="dashboard-state is-error">{error}</div> : null}

      {showAccessConfirmation ? (
        <AccessConfirmationCard
          notice={accessNotice}
          busy={accessBusy}
          onTrustDevice={() => confirmAccess(true)}
          onUseTemporaryAccess={() => confirmAccess(false)}
        />
      ) : null}

      {!loading && (!error || apiNotConfigured) && !showAccessConfirmation ? (
        <>
          <UpdateStatusBar status={data?.refreshStatus ?? null} />
          <DashboardReportView
            reports={data?.reports ?? []}
            selectedReportId={data?.selectedReportId ?? null}
            apiNotice={
              apiNotConfigured
                ? 'Локальный предпросмотр: API ещё не подключён, поэтому показан пример сохранённого отчёта.'
                : undefined
            }
          />
        </>
      ) : null}
    </DashboardShell>
  );
}
