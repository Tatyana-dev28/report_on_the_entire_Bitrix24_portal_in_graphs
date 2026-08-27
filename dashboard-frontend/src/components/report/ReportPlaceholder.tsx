import type { DashboardSavedReport } from '../../api/types';

type ReportPlaceholderProps = {
  reports: DashboardSavedReport[];
  selectedReportId: string | null;
};

export function ReportPlaceholder({ reports, selectedReportId }: ReportPlaceholderProps) {
  const selectedReport = reports.find((report) => report.id === selectedReportId) ?? reports[0] ?? null;

  return (
    <div className="dashboard-report-placeholder">
      <div>
        <p className="dashboard-eyebrow">WEB-режим</p>
        <h1>{selectedReport?.name ?? 'Сохранённый отчёт'}</h1>
        <span>
          Здесь будет подключён текущий интерфейс отчёта без оболочки Битрикс24.
        </span>
      </div>
    </div>
  );
}
