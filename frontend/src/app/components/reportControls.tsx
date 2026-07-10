import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  CalendarDays,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Settings2,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import {
  formatMetricValue,
  formatRangeLabel,
  metricSections,
  type DateRange,
  type MetricRow,
  type Period,
  type ReportPoint,
} from '../../services/report/reportCatalog';
import {
  LAST_AVAILABLE_MONTH_INDEX,
  MONTH_LABELS,
  CHART_AXIS_WIDTH,
  chartDisplayModeOptions,
  chartMetricModeOptions,
  createDefaultSchedule,
  scheduleTimeOptions,
  weekDayOptions,
} from '../constants';
import type {
  ActiveChartPoint,
  ChartDotPayloadProps,
  ChartDraftSettings,
  RecommendedThresholdValues,
  ReportFilters,
  SavedReportViewOption,
  ScheduleFilters,
  SelectOption,
  ThresholdValues,
} from '../types';
import { ChartPointTooltip, HoverChartDot } from './charts';
import {
  CustomSelect,
  FloatingPopover,
  TooltipButton,
  TooltipPortal,
  useOutsideClose,
} from './common';
import {
  getRangeFromMonthIndexes,
  monthIndex,
  toMonthInputValue,
} from '../utils/dateRanges';
import { formatAxisTick, getChartDomain } from '../utils/reportCalculations';
import {
  calculateRecommendedThresholds,
  getAppliedThresholdItems,
  getThresholdAverage,
  getThresholdLineLabel,
  parseThreshold,
  thresholdLineColors,
} from '../utils/thresholds';

export function SavedViewLabel({ label }: { label: string }) {
  const labelRef = useRef<HTMLSpanElement>(null);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties | null>(null);

  const showTooltip = () => {
    const labelElement = labelRef.current;

    if (!labelElement) {
      return;
    }

    const labelRect = labelElement.getBoundingClientRect();
    const appRect = labelElement.closest('.report-card')?.getBoundingClientRect();
    const boundary = appRect ?? {
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      left: 0,
      width: window.innerWidth,
      height: window.innerHeight,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    };
    const maxWidth = Math.max(160, Math.min(420, boundary.width - 24));
    const estimatedWidth = Math.min(maxWidth, Math.max(140, label.length * 7 + 24));
    const estimatedHeight = 36;
    const left = Math.min(
      Math.max(labelRect.left + labelRect.width / 2 - estimatedWidth / 2, boundary.left + 12),
      boundary.right - estimatedWidth - 12,
    );
    const top = Math.max(labelRect.top - 10, boundary.top + estimatedHeight + 12);

    setTooltipStyle({
      left,
      top,
      maxWidth,
      transform: 'translateY(-100%)',
    });
  };

  return (
    <span
      className="saved-view-label"
      onMouseEnter={showTooltip}
      onMouseLeave={() => setTooltipStyle(null)}
      onFocus={showTooltip}
      onBlur={() => setTooltipStyle(null)}
      ref={labelRef}
      tabIndex={0}
    >
      {label}
      {tooltipStyle && <TooltipPortal label={label} style={tooltipStyle} />}
    </span>
  );
}

export function SavedViewsSelect({
  options,
  value,
  onChange,
  onSaveClick,
  onEdit,
  onDelete,
}: {
  options: SavedReportViewOption[];
  value: string;
  onChange: (value: string) => void;
  onSaveClick: () => void;
  onEdit: (value: string) => void;
  onDelete: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [actionsOpenFor, setActionsOpenFor] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false), [popoverRef]);
  const selected = options.find((option) => option.value === value) ?? options[0];
  const maxLabelLength = options.reduce((max, option) => Math.max(max, option.label.length), 0);
  const expectedWidth =
    typeof window === 'undefined'
      ? 320
      : Math.min(Math.max(300, maxLabelLength * 7 + 104), window.innerWidth * 0.75);

  return (
    <div className={`select-shell view-select ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        className="select-trigger"
        type="button"
        aria-label="Сохраненные отображения отчета"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected.label}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="select-menu saved-view-menu"
          expectedWidth={expectedWidth}
          expectedHeight={320}
          role="listbox"
        >
          <div className="saved-view-list">
            {options.map((option) => (
              <div
                className={`saved-view-row ${option.value === value ? 'is-selected' : ''}`}
                key={option.value}
                role="option"
                aria-selected={option.value === value}
              >
                <button
                  className="select-option saved-view-select-button"
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <SavedViewLabel label={option.label} />
                  {option.value === value && <Check size={15} />}
                </button>
                {!option.isSystem && (
                  <div className="saved-view-actions">
                    <button
                      className="saved-view-more-button"
                      type="button"
                      aria-label="Действия отображения"
                      onClick={(event) => {
                        event.stopPropagation();
                        setActionsOpenFor((current) => (current === option.value ? null : option.value));
                      }}
                    >
                      <MoreVertical size={15} />
                    </button>
                    {actionsOpenFor === option.value && (
                      <div className="saved-view-actions-menu">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setActionsOpenFor(null);
                            setOpen(false);
                            onEdit(option.value);
                          }}
                        >
                          Редактировать
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setActionsOpenFor(null);
                            setOpen(false);
                            onDelete(option.value);
                          }}
                        >
                          Удалить
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="saved-view-action">
            <button
              className="select-option save-view-option"
              type="button"
              onClick={() => {
                setOpen(false);
                onSaveClick();
              }}
            >
              <span>Сохранить текущее отображение отчета</span>
            </button>
          </div>
        </FloatingPopover>
      )}
    </div>
  );
}

export function DateRangePicker({
  period,
  range,
  onChange,
}: {
  period: Period;
  range: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false), [popoverRef]);
  const isMonthMode = period === 'months';
  const [visibleYear, setVisibleYear] = useState(() => Number(range.start.slice(0, 4)));
  const [monthAnchor, setMonthAnchor] = useState<number | null>(null);

  useEffect(() => {
    if (open && isMonthMode) {
      setVisibleYear(Number(range.start.slice(0, 4)));
    }
  }, [isMonthMode, open, range.start]);

  const updateDate = (field: keyof DateRange, value: string) => {
    if (!value) {
      return;
    }

    onChange({ ...range, [field]: value });
  };

  const selectMonth = (index: number) => {
    if (index > LAST_AVAILABLE_MONTH_INDEX) {
      return;
    }

    if (monthAnchor === null) {
      setMonthAnchor(index);
      onChange(getRangeFromMonthIndexes(index, index));
      return;
    }

    onChange(getRangeFromMonthIndexes(monthAnchor, index));
    setMonthAnchor(null);
  };

  const selectedStartMonth = monthIndex(toMonthInputValue(range.start));
  const selectedEndMonth = monthIndex(toMonthInputValue(range.end));
  const selectedMonthMin = Math.min(selectedStartMonth, selectedEndMonth);
  const selectedMonthMax = Math.max(selectedStartMonth, selectedEndMonth);

  return (
    <div className={`date-picker-shell ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        className="date-trigger"
        type="button"
        aria-label="Выбор диапазона периода"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <CalendarDays size={17} />
        <span>{formatRangeLabel(period, range)}</span>
        <ChevronDown size={16} />
      </button>

      {open && !isMonthMode && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="date-popover"
          expectedWidth={360}
          expectedHeight={150}
        >
          <p>Период отчета</p>
          <div className={`date-fields ${period === 'hours' ? 'single-field' : ''}`}>
            <label>
              <span>{period === 'hours' ? 'Дата' : 'Дата начала'}</span>
              <input
                type="date"
                value={range.start}
                onChange={(event) =>
                  period === 'hours'
                    ? onChange({ start: event.target.value, end: event.target.value })
                    : updateDate('start', event.target.value)
                }
              />
            </label>
            {period !== 'hours' && (
              <label>
                <span>Дата окончания</span>
                <input
                  type="date"
                  value={range.end}
                  onChange={(event) => updateDate('end', event.target.value)}
                />
              </label>
            )}
          </div>
        </FloatingPopover>
      )}

      {open && isMonthMode && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="date-popover month-popover"
          expectedWidth={330}
          expectedHeight={260}
        >
          <div className="month-head">
            <button type="button" aria-label="Предыдущий год" onClick={() => setVisibleYear((year) => year - 1)}>
              <ChevronDown size={16} />
            </button>
            <p>{visibleYear}</p>
            <button type="button" aria-label="Следующий год" onClick={() => setVisibleYear((year) => year + 1)}>
              <ChevronDown size={16} />
            </button>
          </div>
          <div className="month-grid">
            {MONTH_LABELS.map((label, month) => {
              const index = visibleYear * 12 + month;
              const selected = index >= selectedMonthMin && index <= selectedMonthMax;
              const disabled = index > LAST_AVAILABLE_MONTH_INDEX;

              return (
                <button
                  className={`month-option ${selected ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}`}
                  type="button"
                  key={label}
                  disabled={disabled}
                  onClick={() => selectMonth(index)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </FloatingPopover>
      )}
    </div>
  );
}

export function MultiSelect({
  values,
  options,
  onChange,
  searchPlaceholder = 'Поиск по источникам',
  noResultsLabel = 'Источники не найдены',
  onSelectAll,
  onReset,
  onApply,
  variant = 'dropdown',
}: {
  values: string[];
  options: SelectOption<string>[];
  onChange: (values: string[]) => void;
  searchPlaceholder?: string;
  noResultsLabel?: string;
  onSelectAll?: () => void;
  onReset?: () => void;
  onApply?: () => void;
  variant?: 'dropdown' | 'inline';
}) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const ref = useOutsideClose<HTMLDivElement>(open, () => {
    setOpen(false);
    setSearchQuery('');
  }, [popoverRef]);
  const optionLabelByValue = useMemo(
    () => new Map(options.map((option) => [option.value, option.label])),
    [options],
  );
  const label =
    values.length === options.length
      ? 'Все источники'
      : values.length
        ? values.map((value) => optionLabelByValue.get(value) ?? value).join(', ')
        : 'Не выбрано';

  const filteredOptions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return options;
    }

    return options.filter((option) => {
      const normalizedQuery = query.toLowerCase();

      return (
        option.label.toLowerCase().includes(normalizedQuery) ||
        option.value.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [options, searchQuery]);

  const groupedOptions = useMemo(() => {
    const groups: Array<{ label: string; options: SelectOption<string>[] }> = [];
    const groupByLabel = new Map<string, SelectOption<string>[]>();

    filteredOptions.forEach((option) => {
      if (!option.group) {
        return;
      }

      if (!groupByLabel.has(option.group)) {
        const groupOptions: SelectOption<string>[] = [];
        groupByLabel.set(option.group, groupOptions);
        groups.push({ label: option.group, options: groupOptions });
      }

      groupByLabel.get(option.group)?.push(option);
    });

    return groups;
  }, [filteredOptions]);
  const hasGroupedOptions = groupedOptions.length > 0;

  const clearSearch = () => {
    setSearchQuery('');
    searchInputRef.current?.focus();
  };

  const toggleValue = (value: string) => {
    if (values.includes(value)) {
      onChange(values.filter((item) => item !== value));
      return;
    }

    onChange([...values, value]);
  };

  const renderOption = (option: SelectOption<string>) => (
    <label className="multi-option" key={option.value}>
      <input
        type="checkbox"
        checked={values.includes(option.value)}
        onChange={() => toggleValue(option.value)}
      />
      <span>{option.label}</span>
    </label>
  );

  const renderOptionsList = () => (
    <>
      <div className="multi-search-wrapper">
        <input
          ref={searchInputRef}
          type="text"
          className="multi-search-input"
          placeholder={searchPlaceholder}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
        {searchQuery && (
          <button
            type="button"
            className="multi-search-clear"
            aria-label="Очистить поиск"
            onClick={clearSearch}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {(onSelectAll || onReset || onApply) && (
        <div className="multi-actions">
          {onSelectAll && (
            <button type="button" className="multi-action-button" onClick={onSelectAll}>
              Выбрать все
            </button>
          )}
          {onReset && (
            <button type="button" className="multi-action-button" onClick={onReset}>
              Сбросить
            </button>
          )}
          {onApply && (
            <button type="button" className="multi-action-button multi-action-button--primary" onClick={onApply}>
              Применить
            </button>
          )}
        </div>
      )}
      <div className="multi-options-list">
        {filteredOptions.length === 0 ? (
          <div className="multi-no-results">{noResultsLabel}</div>
        ) : hasGroupedOptions ? (
          groupedOptions.map((group, index) => (
            <div
              className={`multi-option-group ${index > 0 ? 'is-separated' : ''}`}
              key={group.label}
            >
              <div className="multi-option-group-label">{group.label}</div>
              {group.options.map(renderOption)}
            </div>
          ))
        ) : (
          filteredOptions.map(renderOption)
        )}
      </div>
    </>
  );

  if (variant === 'inline') {
    return <div className="multi-select-inline">{renderOptionsList()}</div>;
  }

  return (
    <div className={`select-shell multi-select ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        className="select-trigger"
        type="button"
        aria-label="Выбор источников отчета"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{label}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="select-menu multi-menu"
          expectedWidth={280}
          expectedHeight={680}
        >
          {renderOptionsList()}
        </FloatingPopover>
      )}
    </div>
  );
}

export function SectionMetricsMenu({
  section,
  metricMap,
  enabledMetricIds,
  onToggleMetric,
  onSelectAll,
  onReset,
  onApply,
}: {
  section: { id: string; label: string; metricIds: string[] };
  metricMap: Map<string, MetricRow>;
  enabledMetricIds: Set<string>;
  onToggleMetric: (metricId: string) => void;
  onSelectAll: () => void;
  onReset: () => void;
  onApply: (sectionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false), [popoverRef]);

  const handleApply = () => {
    onApply(section.id);
    setOpen(false);
  };

  return (
    <div className={`section-metrics-shell ${open ? 'is-open' : ''}`} ref={ref}>
      <TooltipButton
        label="Настройка показателей раздела"
        onClick={() => setOpen((current) => !current)}
        className={`section-settings-button ${open ? 'active-pin' : ''}`}
      >
        <Settings2 size={14} />
      </TooltipButton>
      {open && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="settings-popover section-metrics-popover"
          expectedWidth={320}
          expectedHeight={400}
        >
          <div className="section-metrics-head">
            <p>{section.label}</p>
            <button
              className="row-menu-close"
              type="button"
              aria-label="Закрыть настройку показателей"
              onClick={() => setOpen(false)}
            >
              <X size={14} />
            </button>
          </div>
          <div className="table-settings-actions section-metrics-actions">
            <button type="button" onClick={onSelectAll}>
              Выбрать все
            </button>
            <button type="button" onClick={onReset}>
              Сбросить
            </button>
            <button type="button" className="apply-settings-button" onClick={handleApply}>
              Применить
            </button>
          </div>
          <div className="settings-list section-metrics-list">
            {section.metricIds.map((metricId) => {
              const metric = metricMap.get(metricId);

              if (!metric) {
                return null;
              }

              return (
                <label className="settings-option" key={metric.id}>
                  <input
                    type="checkbox"
                    checked={enabledMetricIds.has(metric.id)}
                    onChange={() => onToggleMetric(metric.id)}
                  />
                  <span>{metric.label}</span>
                </label>
              );
            })}
          </div>
        </FloatingPopover>
      )}
    </div>
  );
}

export function TableSettingsMenu({
  selectedSources,
  crmSourceOptions,
  onSourcesChange,
  onApply,
  trigger = 'icon',
}: {
  selectedSources: string[];
  crmSourceOptions: SelectOption<string>[];
  onSourcesChange: (values: string[]) => void;
  onApply: () => void;
  trigger?: 'icon' | 'text';
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false), [popoverRef]);

  const handleApply = () => {
    onApply();
    setOpen(false);
  };

  return (
    <div className={`menu-button-shell ${open ? 'is-open' : ''}`} ref={ref}>
      {trigger === 'icon' ? (
        <TooltipButton
          label="Настройка таблицы"
          onClick={() => setOpen((current) => !current)}
          className={open ? 'active-pin' : ''}
        >
          <Settings2 size={18} />
        </TooltipButton>
      ) : (
        <button
          className={`left-panel-action-button ${open ? 'active-pin' : ''}`}
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <Settings2 size={16} />
          <span>Настройка таблицы</span>
        </button>
      )}
      {open && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="settings-popover table-settings-popover"
          expectedWidth={300}
          expectedHeight={660}
        >
          <div className="table-settings-head">
            <p>Настройка таблицы</p>
            <button
              className="row-menu-close"
              type="button"
              aria-label="Закрыть настройку таблицы"
              onClick={() => setOpen(false)}
            >
              <X size={14} />
            </button>
          </div>
          <div className="table-settings-sources-block">
            <MultiSelect
              variant="inline"
              values={selectedSources}
              options={crmSourceOptions}
              onChange={onSourcesChange}
              onSelectAll={() =>
                onSourcesChange(crmSourceOptions.map((option) => option.value))
              }
              onReset={() => onSourcesChange([])}
              onApply={handleApply}
              searchPlaceholder="Поиск по источникам"
              noResultsLabel="Источники не найдены"
            />
          </div>
        </FloatingPopover>
      )}
    </div>
  );
}

export function ConfigureChartMenu({
  filters,
  crmSourceOptions,
  mainThreshold,
  mainRecommendedThreshold,
  onApply,
  onDraftChange,
  onThresholdApply,
  onThresholdReset,
}: {
  filters: ReportFilters;
  crmSourceOptions: SelectOption<string>[];
  mainThreshold: ThresholdValues;
  mainRecommendedThreshold: RecommendedThresholdValues;
  onApply: (settings: ChartDraftSettings) => void;
  onDraftChange: (settings: ChartDraftSettings) => void;
  onThresholdApply: (value: ThresholdValues) => void;
  onThresholdReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftSettings, setDraftSettings] = useState<ChartDraftSettings>(() => ({
    selectedSources: [...filters.selectedSources],
    chartDisplayMode: filters.chartDisplayMode,
    metricMode: filters.metricMode,
    schedule: {
      ...filters.schedule,
      weekendDayIds: [...filters.schedule.weekendDayIds],
    },
  }));
  const popoverRef = useRef<HTMLDivElement>(null);
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false), [popoverRef]);

  const persistDraftSettings = (settings: ChartDraftSettings) => {
    onDraftChange({
      selectedSources: [...settings.selectedSources],
      chartDisplayMode: settings.chartDisplayMode,
      metricMode: settings.metricMode,
      schedule: {
        ...settings.schedule,
        weekendDayIds: [...settings.schedule.weekendDayIds],
      },
    });
  };

  const updateDraftSettings = (updater: (current: ChartDraftSettings) => ChartDraftSettings) => {
    setDraftSettings((current) => {
      const next = updater(current);
      persistDraftSettings(next);
      return next;
    });
  };

  const openMenu = () => {
    setDraftSettings({
      selectedSources: [...filters.selectedSources],
      chartDisplayMode: filters.chartDisplayMode,
      metricMode: filters.metricMode,
      schedule: {
        ...filters.schedule,
        weekendDayIds: [...filters.schedule.weekendDayIds],
      },
    });
    setOpen(true);
  };

  const applySettings = () => {
    onApply({
      selectedSources: [...draftSettings.selectedSources],
      chartDisplayMode: draftSettings.chartDisplayMode,
      metricMode: draftSettings.metricMode,
      schedule: {
        ...draftSettings.schedule,
        weekendDayIds: [...draftSettings.schedule.weekendDayIds],
      },
    });
    setOpen(false);
  };

  return (
    <div className={`menu-button-shell configure-chart-shell ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        className={`left-panel-action-button ${open ? 'active-pin' : ''}`}
        type="button"
        aria-expanded={open}
        onClick={open ? () => setOpen(false) : openMenu}
      >
        <SlidersHorizontal size={16} />
        <span>Настроить график</span>
      </button>
      {open && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="settings-popover configure-chart-popover"
          expectedWidth={360}
          expectedHeight={640}
        >
          <div className="configure-chart-head">
            <p>Настроить график</p>
            <button
              className="row-menu-close"
              type="button"
              aria-label="Закрыть настройки графика"
              onClick={() => setOpen(false)}
            >
              <X size={14} />
            </button>
          </div>
          <div className="configure-chart-fields">
            <MultiSelect
              values={draftSettings.selectedSources}
              options={crmSourceOptions}
              onChange={(selectedSources) =>
                updateDraftSettings((current) => ({
                  ...current,
                  selectedSources,
                }))
              }
              onSelectAll={() =>
                updateDraftSettings((current) => ({
                  ...current,
                  selectedSources: crmSourceOptions.map((option) => option.value),
                }))
              }
              onReset={() =>
                updateDraftSettings((current) => ({
                  ...current,
                  selectedSources: [],
                }))
              }
              onApply={applySettings}
            />
            {draftSettings.selectedSources.length > 1 && (
              <CustomSelect
                options={chartDisplayModeOptions}
                value={draftSettings.chartDisplayMode}
                onChange={(chartDisplayMode) =>
                  updateDraftSettings((current) => ({
                    ...current,
                    chartDisplayMode,
                  }))
                }
                ariaLabel="Режим отображения CRM-разделов"
                className="chart-mode-select"
              />
            )}
            <CustomSelect
              options={chartMetricModeOptions}
              value={draftSettings.metricMode}
              onChange={(metricMode) =>
                updateDraftSettings((current) => ({
                  ...current,
                  metricMode,
                }))
              }
              ariaLabel="Что считаем"
              className="chart-mode-select"
            />
            <ThresholdMenu
              value={mainThreshold}
              recommended={mainRecommendedThreshold}
              onApply={onThresholdApply}
              onReset={onThresholdReset}
            />
            <ScheduleMenu
              schedule={draftSettings.schedule}
              onChange={(schedule) =>
                updateDraftSettings((current) => ({
                  ...current,
                  schedule,
                }))
              }
            />
          </div>
          <button className="configure-chart-apply blue-button" type="button" onClick={applySettings}>
            Применить
          </button>
        </FloatingPopover>
      )}
    </div>
  );
}

export function ThresholdEditor({
  threshold,
  recommended,
  onApply,
  onReset,
  onClose,
}: {
  threshold: ThresholdValues;
  recommended: RecommendedThresholdValues;
  onApply: (value: ThresholdValues) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [manualUpper, setManualUpper] = useState(threshold.upper);
  const [manualLower, setManualLower] = useState(threshold.lower);
  const manualAverage = getThresholdAverage({ upper: manualUpper, lower: manualLower });
  const canApplyManual = parseThreshold(manualUpper) !== null && parseThreshold(manualLower) !== null;
  const canApplyRecommended =
    parseThreshold(recommended.upper) !== null && parseThreshold(recommended.lower) !== null;
  const resetValues = () => {
    setManualUpper('');
    setManualLower('');
    onReset();
  };

  return (
    <div className="threshold-editor">
      <div className="threshold-popover-head">
        <p>Пороговые значения</p>
        <button className="popover-reset-button compact-reset-button" type="button" onClick={resetValues}>
          Сбросить
        </button>
      </div>
      <div className="threshold-editor-grid">
        <div className="threshold-column">
          <p>Ручные значения</p>
          <label className="threshold-field compact-threshold-field">
            <span>Верхнее значение</span>
            <input
              type="number"
              value={manualUpper}
              onChange={(event) => setManualUpper(event.target.value)}
              placeholder="1200000"
            />
          </label>
          <label className="threshold-field compact-threshold-field">
            <span>Нижнее значение</span>
            <input
              type="number"
              value={manualLower}
              onChange={(event) => setManualLower(event.target.value)}
              placeholder="800000"
            />
          </label>
          <label className="threshold-field compact-threshold-field">
            <span>Среднее значение</span>
            <input value={manualAverage === null ? '' : manualAverage} readOnly />
          </label>
          <button
            className="threshold-apply-button manual-apply-button"
            type="button"
            disabled={!canApplyManual}
            onClick={() => {
              onApply({ upper: manualUpper, lower: manualLower, mode: 'manual' });
              onClose();
            }}
          >
            Применить
          </button>
        </div>
        <div className="threshold-column">
          <p>Рекомендованные значения</p>
          <label className="threshold-field compact-threshold-field">
            <span>Рекомендованное верхнее значение</span>
            <input value={recommended.upper} readOnly />
          </label>
          <label className="threshold-field compact-threshold-field">
            <span>Рекомендованное нижнее значение</span>
            <input value={recommended.lower} readOnly />
          </label>
          <label className="threshold-field compact-threshold-field">
            <span>Рекомендованное среднее значение</span>
            <input value={recommended.average} readOnly />
          </label>
          <button
            className="threshold-apply-button recommended-apply-button"
            type="button"
            disabled={!canApplyRecommended}
            onClick={() => {
              onApply({ upper: recommended.upper, lower: recommended.lower, mode: 'recommended' });
              onClose();
            }}
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}

export function ThresholdMenu({
  value,
  recommended,
  onApply,
  onReset,
}: {
  value: ThresholdValues;
  recommended: RecommendedThresholdValues;
  onApply: (value: ThresholdValues) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false), [popoverRef]);

  return (
    <div className={`threshold-shell ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        className="threshold-trigger"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <SlidersHorizontal size={17} />
        <span>Пороговые значения</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="settings-popover threshold-popover"
          expectedWidth={520}
          expectedHeight={330}
        >
          <ThresholdEditor
            threshold={value}
            recommended={recommended}
            onApply={onApply}
            onReset={onReset}
            onClose={() => setOpen(false)}
          />
        </FloatingPopover>
      )}
    </div>
  );
}

export function ScheduleMenu({
  schedule,
  onChange,
}: {
  schedule: ScheduleFilters;
  onChange: (schedule: ScheduleFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false), [popoverRef]);

  const updateSchedule = (nextSchedule: ScheduleFilters) => {
    onChange({
      ...nextSchedule,
      weekendDayIds: [...nextSchedule.weekendDayIds],
    });
  };

  const toggleWeekendDay = (dayId: number) => {
    const weekendDayIds = schedule.weekendDayIds.includes(dayId)
      ? schedule.weekendDayIds.filter((currentDayId) => currentDayId !== dayId)
      : [...schedule.weekendDayIds, dayId];

    updateSchedule({
      ...schedule,
      weekendDayIds,
    });
  };

  return (
    <div className={`threshold-shell schedule-shell ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        className="threshold-trigger schedule-trigger"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <CalendarClock size={17} />
        <span>Расписание</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="settings-popover schedule-popover"
          expectedWidth={320}
          expectedHeight={430}
        >
          <p>Расписание</p>
          <div className="schedule-form">
            <label className="schedule-field">
              <span>Начало рабочего дня</span>
              <select
                value={schedule.workdayStart}
                onChange={(event) =>
                  updateSchedule({
                    ...schedule,
                    workdayStart: event.target.value,
                  })
                }
              >
                <option value="">00:00</option>
                {scheduleTimeOptions.filter((time) => time !== '00:00').map((time) => (
                  <option value={time} key={time}>
                    {time}
                  </option>
                ))}
              </select>
            </label>
            <label className="schedule-field">
              <span>Конец рабочего дня</span>
              <select
                value={schedule.workdayEnd}
                onChange={(event) =>
                  updateSchedule({
                    ...schedule,
                    workdayEnd: event.target.value,
                  })
                }
              >
                <option value="">00:00</option>
                {scheduleTimeOptions.filter((time) => time !== '00:00').map((time) => (
                  <option value={time} key={time}>
                    {time}
                  </option>
                ))}
              </select>
            </label>
            <div className="schedule-field">
              <span>Выходные дни</span>
              <div className="schedule-day-grid">
                {weekDayOptions.map((day) => {
                  const selected = schedule.weekendDayIds.includes(day.id);

                  return (
                    <button
                      className={`schedule-day-button ${selected ? 'is-selected' : ''}`}
                      type="button"
                      key={day.id}
                      onClick={() => toggleWeekendDay(day.id)}
                    >
                      <span>{day.label}</span>
                      {selected && <Check size={13} />}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="schedule-field">
              <span>Первый день недели</span>
              <div className="schedule-day-grid">
                {weekDayOptions.map((day) => {
                  const selected = schedule.calendarWeekStart === day.id;

                  return (
                    <button
                      className={`schedule-day-button ${selected ? 'is-selected' : ''}`}
                      type="button"
                      key={day.id}
                      onClick={() =>
                        updateSchedule({
                          ...schedule,
                          calendarWeekStart: day.id,
                        })
                      }
                    >
                      <span>{day.label}</span>
                      {selected && <Check size={13} />}
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              className="popover-reset-button"
              type="button"
              onClick={() => updateSchedule(createDefaultSchedule())}
            >
              Сбросить
            </button>
          </div>
        </FloatingPopover>
      )}
    </div>
  );
}

export function RowThresholdMenu({
  value,
  onChange,
}: {
  value: ThresholdValues;
  onChange: (value: ThresholdValues) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false));
  const average = getThresholdAverage(value);

  return (
    <div className={`row-threshold-shell ${open ? 'is-open' : ''}`} ref={ref}>
      <TooltipButton
        label="Пороговые значения"
        className={`row-action-button ${open ? 'active-pin' : ''}`}
        onClick={() => setOpen((current) => !current)}
      >
        <SlidersHorizontal size={14} />
      </TooltipButton>
      {open && (
        <div className="settings-popover row-threshold-popover">
          <p>Пороговые значения</p>
          <label className="threshold-field">
            <span>Верхнее значение</span>
            <input
              type="number"
              value={value.upper}
              onChange={(event) => onChange({ ...value, upper: event.target.value })}
              placeholder="Например, 80"
            />
          </label>
          <label className="threshold-field">
            <span>Нижнее значение</span>
            <input
              type="number"
              value={value.lower}
              onChange={(event) => onChange({ ...value, lower: event.target.value })}
              placeholder="Например, 30"
            />
          </label>
          <label className="threshold-field">
            <span>Среднее значение</span>
            <input value={average === null ? '' : average} readOnly />
          </label>
          <button
            className="popover-reset-button"
            type="button"
            onClick={() => onChange({ upper: '', lower: '' })}
          >
            Сбросить
          </button>
        </div>
      )}
    </div>
  );
}

export function RowActionsMenu({
  employeesOpen,
  chartOpen,
  threshold,
  recommendedThreshold,
  onToggleEmployees,
  onToggleChart,
  onThresholdChange,
  showEmployees = true,
}: {
  employeesOpen: boolean;
  chartOpen: boolean;
  threshold: ThresholdValues;
  recommendedThreshold: RecommendedThresholdValues;
  onToggleEmployees: () => void;
  onToggleChart: () => void;
  onThresholdChange: (value: ThresholdValues) => void;
  /** Hide employees action when per-source employee breakdown is unavailable. */
  showEmployees?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'actions' | 'thresholds'>('actions');
  const popoverRef = useRef<HTMLDivElement>(null);
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false), [popoverRef]);

  const openActions = () => {
    setMode('actions');
    setOpen((current) => !current);
  };

  return (
    <div className={`row-actions-shell ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        className="more-menu-button"
        type="button"
        aria-label="Действия показателя"
        aria-expanded={open}
        onClick={openActions}
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="settings-popover row-actions-popover"
          expectedWidth={mode === 'actions' ? 280 : 520}
          expectedHeight={mode === 'actions' ? 158 : 330}
        >
          {mode === 'actions' ? (
            <div className="row-actions-list">
              <div className="row-actions-menu-head">
                <p>Действия</p>
                <button
                  className="row-menu-close"
                  type="button"
                  aria-label="Закрыть меню"
                  onClick={() => setOpen(false)}
                >
                  <X size={14} />
                </button>
              </div>
              {showEmployees && (
                <button
                  className={`row-action-menu-item ${employeesOpen ? 'is-active' : ''}`}
                  type="button"
                  onClick={() => {
                    onToggleEmployees();
                    setOpen(false);
                  }}
                >
                  <span>{employeesOpen ? 'Скрыть сотрудников' : 'Показать сотрудников'}</span>
                  {employeesOpen && <Check size={14} />}
                </button>
              )}
              <button
                className={`row-action-menu-item ${chartOpen ? 'is-active' : ''}`}
                type="button"
                onClick={() => {
                  onToggleChart();
                  setOpen(false);
                }}
              >
                <span>{chartOpen ? 'Скрыть график' : 'Показать график'}</span>
                {chartOpen && <Check size={14} />}
              </button>
              <button
                className="row-action-menu-item"
                type="button"
                onClick={() => setMode('thresholds')}
              >
                <span>Пороговые значения</span>
              </button>
            </div>
          ) : (
            <div className="row-threshold-fields">
              <div className="row-popover-head">
                <button type="button" onClick={() => setMode('actions')}>
                  Назад
                </button>
                <button
                  className="row-menu-close"
                  type="button"
                  aria-label="Закрыть меню"
                  onClick={() => setOpen(false)}
                >
                  <X size={14} />
                </button>
              </div>
              <ThresholdEditor
                threshold={threshold}
                recommended={recommendedThreshold}
                onApply={onThresholdChange}
                onReset={() => onThresholdChange({ upper: '', lower: '', mode: null })}
                onClose={() => setOpen(false)}
              />
            </div>
          )}
        </FloatingPopover>
      )}
    </div>
  );
}

export function RowMetricChart({
  metric,
  reportData,
  threshold,
  valuesByPeriod,
}: {
  metric: MetricRow;
  reportData: ReportPoint[];
  threshold?: ThresholdValues;
  /** When set, chart reads these period values instead of point.values[metric.id]. */
  valuesByPeriod?: Record<string, number>;
}) {
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const [activePoint, setActivePoint] = useState<ActiveChartPoint | null>(null);
  const chartData = useMemo(
    () =>
      reportData.map((point, index) => {
        const raw = valuesByPeriod
          ? valuesByPeriod[point.key]
          : point.values[metric.id];
        const numeric = typeof raw === 'number' ? raw : Number(raw);

        return {
          label: point.label,
          tooltipLabel: point.tooltipLabel,
          value: Number.isFinite(numeric) ? numeric : 0,
          chartIndex: index,
          xIndex: index + 0.5,
        };
      }),
    [metric.id, reportData, valuesByPeriod],
  );
  const thresholdValues = useMemo(
    () =>
      [
        parseThreshold(threshold?.upper ?? ''),
        parseThreshold(threshold?.lower ?? ''),
        threshold ? getThresholdAverage(threshold) : null,
      ].filter((item): item is number => item !== null),
    [threshold],
  );
  const domain = useMemo(
    () => getChartDomain([...chartData.map((point) => point.value), ...thresholdValues]),
    [chartData, thresholdValues],
  );
  const upper = parseThreshold(threshold?.upper ?? '');
  const lower = parseThreshold(threshold?.lower ?? '');
  const average = threshold ? getThresholdAverage(threshold) : null;
  const activeDataPoint = activePoint ? chartData[activePoint.index] : null;
  const thresholdItems = getAppliedThresholdItems(threshold);

  return (
    <div className="row-chart-wrap" ref={chartWrapRef}>
      <ResponsiveContainer width="100%" height={150}>
        <LineChart
          data={chartData}
          margin={{ top: 20, right: 0, left: 0, bottom: 8 }}
          onMouseLeave={() => setActivePoint(null)}
        >
          <CartesianGrid stroke="#edf0f4" vertical={false} />
          <XAxis dataKey="xIndex" type="number" domain={[0, reportData.length]} hide />
          <YAxis
            width={CHART_AXIS_WIDTH}
            domain={domain}
            tickLine={false}
            axisLine={false}
            tick={{ fill: '#707782', fontSize: 11 }}
            tickFormatter={(value) => formatAxisTick(value, metric.type)}
          />
          {upper !== null && (
            <ReferenceLine
              y={upper}
              stroke={thresholdLineColors.upper}
              strokeDasharray="6 6"
              label={{ value: getThresholdLineLabel(threshold, 'upper'), position: 'insideTopLeft', fill: '#218454', fontSize: 10, dx: 4, dy: -4 }}
            />
          )}
          {average !== null && (
            <ReferenceLine
              y={average}
              stroke={thresholdLineColors.average}
              strokeDasharray="6 6"
              label={{ value: getThresholdLineLabel(threshold, 'average'), position: 'insideTopLeft', fill: '#9a6b00', fontSize: 10, dx: 4, dy: -4 }}
            />
          )}
          {lower !== null && (
            <ReferenceLine
              y={lower}
              stroke={thresholdLineColors.lower}
              strokeDasharray="6 6"
              label={{ value: getThresholdLineLabel(threshold, 'lower'), position: 'insideTopLeft', fill: '#b42323', fontSize: 10, dx: 4, dy: -4 }}
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke="#2274ff"
            strokeWidth={2}
            dot={(props: ChartDotPayloadProps) => (
              <HoverChartDot
                {...props}
                stroke="#2274ff"
                radius={2.5}
                onActivate={setActivePoint}
                onDeactivate={() => setActivePoint(null)}
              />
            )}
            activeDot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      {activePoint && activeDataPoint && (
        <ChartPointTooltip
          point={activePoint}
          title={activeDataPoint.tooltipLabel}
          items={[
            {
              label: metric.label,
              value: formatMetricValue(activeDataPoint.value, metric.type),
              color: '#2274ff',
            },
          ]}
          thresholdItems={thresholdItems}
          containerRef={chartWrapRef}
          valueFormatter={(value) => formatMetricValue(value, metric.type)}
        />
      )}
    </div>
  );
}


