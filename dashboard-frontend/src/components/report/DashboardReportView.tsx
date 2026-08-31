import { CalendarDays, ChevronDown, Download, RefreshCw, Settings2 } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DashboardSavedReport } from '../../api/types';
import { buildDemoDashboardReport, getMetricSectionLabel } from '../../reportData/demoReport';

type DashboardReportViewProps = {
  reports: DashboardSavedReport[];
  selectedReportId: string | null;
  apiNotice?: string;
};

export function DashboardReportView({ reports, selectedReportId, apiNotice }: DashboardReportViewProps) {
  const report = buildDemoDashboardReport(reports, selectedReportId);
  const selectedReport = report.reports.find((item) => item.id === report.selectedReportId) ?? report.reports[0];
  const chartData = report.reportData.map((point) => ({
    name: point.label,
    tooltipLabel: point.tooltipLabel,
    value: point.values[report.mainMetric.id] ?? 0,
  }));
  const totalMainValue = report.reportData.reduce(
    (sum, point) => sum + (point.values[report.mainMetric.id] ?? 0),
    0,
  );

  return (
    <div className="web-report">
      <div className="web-report-toolbar">
        <div className="web-report-selects" aria-label="Параметры отчёта">
          <button className="web-select-button web-select-button--saved" type="button">
            <span>{selectedReport?.name ?? 'Сохранённый отчёт'}</span>
            <ChevronDown size={18} />
          </button>
          <button className="web-select-button" type="button">
            <span>{report.periodLabel}</span>
            <ChevronDown size={18} />
          </button>
          <button className="web-date-button" type="button">
            <CalendarDays size={18} />
            <span>{report.rangeLabel}</span>
          </button>
        </div>
        <div className="web-report-actions">
          <button className="web-icon-button" type="button" aria-label="Настроить показатели">
            <Settings2 size={18} />
          </button>
          <button className="web-action-button" type="button">
            <RefreshCw size={17} />
            <span>Обновить</span>
          </button>
          <button className="web-action-button web-action-button--green" type="button">
            <Download size={17} />
            <span>Скачать</span>
          </button>
        </div>
      </div>

      {apiNotice ? <div className="web-report-notice">{apiNotice}</div> : null}

      <section className="web-report-surface">
        <aside className="web-report-left">
          <div className="web-panel-title">
            <p>Показатели бизнеса</p>
            <span>WEB-режим</span>
          </div>
          <button className="web-business-card" type="button">
            <strong>Показать автоматически</strong>
            <em>Система всё настроит за вас</em>
          </button>
          <button className="web-business-card is-active" type="button">
            <strong>Настроить показатели</strong>
            <em>Период, главный и остальные</em>
          </button>
          <button className="web-business-card web-business-card--primary" type="button">
            <strong>Показать сводку</strong>
            <em>Отобразить выбранный набор</em>
          </button>
        </aside>

        <section className="web-report-main">
          <div className="web-main-metric">
            <div>
              <p>Главный показатель</p>
              <h2>{report.mainMetric.label}</h2>
              <span>{report.rangeLabel}</span>
            </div>
            <strong>{report.formatValue(totalMainValue, report.mainMetric.type)}</strong>
          </div>

          <div className="web-chart-card">
            <div className="web-chart-head">
              <div>
                <p>График</p>
                <strong>{report.mainMetric.label}</strong>
              </div>
              <span>Тренд включён</span>
            </div>
            <div className="web-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 12, right: 18, left: 6, bottom: 8 }}>
                  <CartesianGrid stroke="#edf2f7" vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#6a7482', fontSize: 12 }} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#6a7482', fontSize: 12 }}
                    width={74}
                    tickFormatter={(value) => report.formatValue(Number(value), report.mainMetric.type)}
                  />
                  <Tooltip
                    formatter={(value) => report.formatValue(Number(value), report.mainMetric.type)}
                    labelFormatter={(_, payload) => payload[0]?.payload.tooltipLabel ?? ''}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#2274ff"
                    strokeWidth={3}
                    dot={{ r: 4, strokeWidth: 2, fill: '#ffffff' }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="web-table-card">
            <div className="web-table-head">
              <strong>Показатели</strong>
              {report.reportData.map((point) => (
                <span key={point.key}>{point.label}</span>
              ))}
            </div>
            {report.tableMetrics.map((metric) => (
              <div className="web-table-row" key={metric.id}>
                <div>
                  <strong>{metric.label}</strong>
                  <span>{getMetricSectionLabel(metric.id)}</span>
                </div>
                {report.reportData.map((point) => (
                  <span key={`${metric.id}-${point.key}`}>
                    {report.formatValue(point.values[metric.id] ?? 0, metric.type)}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </section>
      </section>
    </div>
  );
}
