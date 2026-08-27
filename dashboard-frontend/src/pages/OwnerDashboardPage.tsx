import { DashboardShell } from '../components/layout/DashboardShell';
import { ReportPlaceholder } from '../components/report/ReportPlaceholder';
import { UpdateStatusBar } from '../components/status/UpdateStatusBar';
import { useDashboardBootstrap } from '../hooks/useDashboardBootstrap';

export function OwnerDashboardPage() {
  const { data, loading, error } = useDashboardBootstrap();

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

      {!loading && !error ? (
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
