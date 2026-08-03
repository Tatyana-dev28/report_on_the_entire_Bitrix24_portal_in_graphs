import type { ChartDisplayMode, ChartMetricMode } from '../types';

/**
 * F-06: configurable automatic report preset.
 * Change this object to adjust auto-pick behaviour without editing UI components.
 */
export const AUTOMATIC_REPORT_PRESET = {
  /** Main chart metric mode after auto-pick. */
  chartMetricMode: 'money' as ChartMetricMode,
  chartDisplayMode: 'sum' as ChartDisplayMode,

  /**
   * Sections to enable. `null` = every section from the live catalog.
   * Example: ['deals', 'leads', 'telephony']
   */
  sectionIds: null as string[] | null,

  /**
   * Metrics per section. `null` = every metric in the enabled sections.
   * Example: { deals: ['deal_won_sum', 'deal_won_count'], leads: ['lead_created'] }
   */
  metricIdsBySection: null as Record<string, string[]> | null,

  /**
   * Preferred static/entity source ids for the table (besides the chart funnel).
   * `null` = all available portal sources from the catalog.
   * Example: ['lead-default', 'telephony-default', 'task-default']
   */
  preferredEntitySourceIds: null as string[] | null,

  /** Section ids that should appear first in the table. */
  sectionOrderPriority: ['deals'] as string[],

  /** Date range strategy for auto-pick. */
  dateRangeStrategy: 'previousWeekFromYesterday' as const,
} as const;

export type AutomaticReportPresetConfig = typeof AUTOMATIC_REPORT_PRESET;
