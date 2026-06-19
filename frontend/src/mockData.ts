import {
  buildPeriodPoints,
  defaultDateRange,
  metrics,
  type DateRange,
  type MetricRow,
  type Period,
  type ReportPoint,
} from './services/report/reportCatalog';

const metricValue = (metric: MetricRow, index: number, period: Period) => {
  const periodFactor =
    period === 'hours' ? 0.05 : period === 'days' ? 0.9 : period === 'weeks' ? 5.2 : 18;

  const trendStep =
    period === 'hours' ? 0.0008 : period === 'days' ? 0.012 : period === 'weeks' ? 0.025 : 0.035;

  const wave = 1 + Math.sin((index + metric.base) / 2.3) * 0.18;
  const trend = 1 + index * trendStep;
  const value = metric.base * periodFactor * wave * trend;

  if (metric.type === 'percent') {
    return Math.min(98, Math.max(4, Math.round(metric.base + Math.sin(index / 1.7) * 7)));
  }

  return Math.max(0, Math.round(value));
};

const conversionValue = (success: number, created: number) => {
  if (created <= 0) {
    return 0;
  }

  return Math.round((success / created) * 1000) / 10;
};

export const buildReportData = (
  period: Period,
  range: DateRange = defaultDateRange,
): ReportPoint[] =>
  buildPeriodPoints(period, range).map((point, index) => {
    const values = metrics.reduce<Record<string, number>>((acc, metric) => {
      acc[metric.id] = metricValue(metric, index, period);
      return acc;
    }, {});

    values.deals_conversion = conversionValue(values.deals_won, values.deals_created);
    values.leads_conversion = conversionValue(values.leads_quality, values.leads_created);
    values.invoices_conversion = conversionValue(values.invoices_won, values.invoices_created);
    values.quotes_conversion = conversionValue(values.quotes_accepted, values.quotes_created);

    return {
      key: point.date.toISOString(),
      label: point.label,
      tooltipLabel: point.tooltipLabel,
      indicator: values.deals_won_sum,
      values,
    };
  });