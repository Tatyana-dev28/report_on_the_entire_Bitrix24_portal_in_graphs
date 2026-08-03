/**
 * F-09: how to interpret corridor deviations for a metric.
 * Affects highlight colors only — not values or corridor math.
 */
export type MetricDirection =
  | 'higher_better'
  | 'lower_better'
  | 'range_normal'
  | 'none';

export const METRIC_DIRECTION_OPTIONS: Array<{ value: MetricDirection; label: string }> = [
  { value: 'higher_better', label: 'Больше — лучше' },
  { value: 'lower_better', label: 'Меньше — лучше' },
  { value: 'range_normal', label: 'Норма внутри диапазона' },
  { value: 'none', label: 'Без оценки' },
];

/** Special key for the main chart corridor setting. */
export const MAIN_INDICATOR_DIRECTION_KEY = '__main_indicator__';

/**
 * Staff metric defaults. Unknown / ambiguous ids must NOT be guessed — resolve to `none`.
 */
export const STAFF_METRIC_DIRECTIONS: Readonly<Record<string, MetricDirection>> = {
  deals_created: 'higher_better',
  deals_won: 'higher_better',
  deals_won_sum: 'higher_better',
  deals_conversion: 'higher_better',
  deals_lost: 'lower_better',
  deals_lost_sum: 'lower_better',

  leads_created: 'higher_better',
  leads_quality: 'higher_better',
  leads_quality_sum: 'higher_better',
  leads_conversion: 'higher_better',
  leads_bad: 'lower_better',
  leads_bad_sum: 'lower_better',

  invoices_created: 'higher_better',
  invoices_won: 'higher_better',
  invoices_won_sum: 'higher_better',
  invoices_conversion: 'higher_better',
  invoices_lost: 'lower_better',
  invoices_lost_sum: 'lower_better',

  quotes_created: 'higher_better',
  quotes_sent: 'higher_better',
  quotes_accepted: 'higher_better',
  quotes_accepted_sum: 'higher_better',
  quotes_conversion: 'higher_better',
  quotes_declined: 'lower_better',
  quotes_declined_sum: 'lower_better',

  contracts_created: 'higher_better',
  contracts_sent: 'higher_better',
  contracts_signed: 'higher_better',
  contracts_signed_sum: 'higher_better',
  contracts_conversion: 'higher_better',
  contracts_failed: 'lower_better',

  companies_new: 'higher_better',
  contacts_new: 'higher_better',

  calls_total: 'higher_better',
  calls_in: 'higher_better',
  calls_out: 'higher_better',
  calls_out_success: 'higher_better',
  calls_missed: 'lower_better',

  messages_new: 'higher_better',
  messages_total: 'higher_better',
  email_in: 'higher_better',
  email_out: 'higher_better',
  crm_forms: 'higher_better',

  tasks_created: 'higher_better',
  tasks_done: 'higher_better',
  tasks_overdue: 'lower_better',

  meetings_created: 'higher_better',
  activities_created: 'higher_better',
  activities_done: 'higher_better',
  activities_undone: 'lower_better',

  smart_process_success: 'higher_better',
  smart_process_success_sum: 'higher_better',
  smart_process_failed: 'lower_better',

  // Main chart corridor: treat as "more is better" for typical money/count success.
  [MAIN_INDICATOR_DIRECTION_KEY]: 'higher_better',
};

export const isMetricDirection = (value: unknown): value is MetricDirection =>
  value === 'higher_better'
  || value === 'lower_better'
  || value === 'range_normal'
  || value === 'none';

/**
 * Resolve direction for a metric id.
 * User override wins; then staff config; otherwise neutral `none` (never guess).
 */
export const resolveMetricDirection = (
  metricId: string,
  overrides?: Record<string, MetricDirection> | null,
): MetricDirection => {
  const override = overrides?.[metricId];
  if (isMetricDirection(override)) {
    return override;
  }

  return STAFF_METRIC_DIRECTIONS[metricId] ?? 'none';
};

/** Resolve across alias ids (funnel/smart action id variants). */
export const resolveMetricDirectionForIds = (
  metricIds: string[],
  overrides?: Record<string, MetricDirection> | null,
): MetricDirection => {
  for (const metricId of metricIds) {
    const override = overrides?.[metricId];
    if (isMetricDirection(override)) {
      return override;
    }
  }

  for (const metricId of metricIds) {
    const staff = STAFF_METRIC_DIRECTIONS[metricId];
    if (staff) {
      return staff;
    }
  }

  return 'none';
};
