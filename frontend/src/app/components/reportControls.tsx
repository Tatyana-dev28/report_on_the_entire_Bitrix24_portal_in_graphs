import {
  useCallback,
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
  Download,
  FileSpreadsheet,
  FileText,
  MoreVertical,
  Settings2,
  SlidersHorizontal,
  Users,
  Network,
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
  ReportEmployee,
  ReportFilters,
  SavedReportViewOption,
  ScheduleFilters,
  SelectOption,
  TableRowChartsMode,
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
import {
  formatAxisTick,
  getChartDomain,
  getWorkdayScheduleError,
} from '../utils/reportCalculations';
import {
  buildEmployeeDepartmentGroups,
  getEmployeeFullName,
  getEmployeeInitials,
  getEmployeeSecondaryLabel,
} from '../utils/employees';
import {
  METRIC_DIRECTION_OPTIONS,
  type MetricDirection,
} from '../config/metricDirections';
import {
  calculateRecommendedThresholds,
  formatCorridorFieldValue,
  getAppliedThresholdItems,
  getThresholdAverage,
  getThresholdLineLabel,
  formatChartCorridorTooltipNote,
  hasCorridorValidationErrors,
  isManualThreshold,
  parseThreshold,
  resolveDisplayedThresholdAverage,
  thresholdLineColors,
  validateCorridorFields,
  type CorridorFieldKey,
  type CorridorValidationErrors,
  type CorridorValueType,
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
                      title="Действия отображения"
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
              <span>Сохранить текущее отображение обзора</span>
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
  closeOnApply = false,
  commitOnApply = false,
  menuGroup,
  menuKey,
  variant = 'dropdown',
  selectionMode = 'multi',
  triggerLabel,
  ariaLabel = 'Выбор источников отчета',
  menuWidth = 280,
  matchAnchorWidth = false,
  anchorMenu = false,
  popoverContainer,
  popoverVerticalPlacement = 'auto',
  popoverAllowVerticalOverflow = false,
  onBeforeOpen,
}: {
  values: string[];
  options: SelectOption<string>[];
  onChange: (values: string[]) => void;
  searchPlaceholder?: string;
  noResultsLabel?: string;
  onSelectAll?: () => void;
  onReset?: () => void;
  onApply?: () => void;
  closeOnApply?: boolean;
  /** Keep checkbox changes local until «Применить»; discard on close without apply. */
  commitOnApply?: boolean;
  menuGroup?: string;
  menuKey?: string;
  variant?: 'dropdown' | 'inline';
  /** Free main indicator uses single-select; table/paid sum stay multi. */
  selectionMode?: 'multi' | 'single';
  /** Closed-field summary, e.g. «Выбрано: 18» (W08). */
  triggerLabel?: string;
  ariaLabel?: string;
  /** Dropdown menu width in px (ignored for inline variant / anchorMenu). */
  menuWidth?: number;
  /** Stretch menu to the trigger width. Default false keeps a compact list. */
  matchAnchorWidth?: boolean;
  /** Render menu under the trigger for settings panel (portal, full trigger width). */
  anchorMenu?: boolean;
  popoverContainer?: HTMLElement | null;
  popoverVerticalPlacement?: 'auto' | 'anchor-start' | 'below';
  popoverAllowVerticalOverflow?: boolean;
  onBeforeOpen?: (openMenu: () => void, popoverHeight: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [draftValues, setDraftValues] = useState<string[]>(values);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const closeMenu = () => {
    setOpen(false);
    setSearchQuery('');
    if (commitOnApply) {
      setDraftValues([...values]);
    }
  };
  // Settings panel scrolls while menus stay open; scroll must not dismiss them.
  const ref = useOutsideClose<HTMLDivElement>(open, closeMenu, [popoverRef], {
    closeOnScroll: !anchorMenu,
  });
  useEffect(() => {
    if (!menuGroup || !menuKey) {
      return undefined;
    }

    const handleMenuOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ group?: string; key?: string }>).detail;

      if (detail?.group === menuGroup && detail.key !== menuKey) {
        closeMenu();
      }
    };

    window.addEventListener('nested-menu-open', handleMenuOpen);

    return () => {
      window.removeEventListener('nested-menu-open', handleMenuOpen);
    };
  }, [commitOnApply, menuGroup, menuKey, values]);
  useEffect(() => {
    if (open && commitOnApply) {
      setDraftValues([...values]);
    }
  }, [open, commitOnApply, values]);
  const optionLabelByValue = useMemo(
    () => new Map(options.map((option) => [option.value, option.label])),
    [options],
  );
  const availableOptions = useMemo(
    () => options.filter((option) => !option.disabled),
    [options],
  );
  const activeValues = commitOnApply ? draftValues : values;
  const label = triggerLabel
    ?? (
      availableOptions.length > 0
      && availableOptions.every((option) => values.includes(option.value))
      && values.every((value) => availableOptions.some((option) => option.value === value))
        ? 'Все источники'
        : values.length
          ? values.map((value) => optionLabelByValue.get(value) ?? value).join(', ')
          : 'Не выбрано'
    );

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
  const showSelectAll = (Boolean(onSelectAll) || commitOnApply) && selectionMode !== 'single';
  const showReset = Boolean(onReset) || commitOnApply;
  const showApply = Boolean(onApply) || commitOnApply;
  const popoverExpectedWidth = anchorMenu ? 280 : menuWidth;
  const popoverExpectedHeight = anchorMenu ? 360 : 680;

  const clearSearch = () => {
    setSearchQuery('');
    searchInputRef.current?.focus();
  };

  const commitValues = (nextValues: string[]) => {
    if (commitOnApply) {
      setDraftValues(nextValues);
      return;
    }
    onChange(nextValues);
  };

  const toggleValue = (value: string) => {
    const option = options.find((item) => item.value === value);
    const isSelected = activeValues.includes(value);

    // Allow unchecking a previously selected unavailable source; block new selection.
    if (option?.disabled && !isSelected) {
      return;
    }

    if (selectionMode === 'single') {
      commitValues(isSelected ? [] : [value]);
      return;
    }

    if (isSelected) {
      commitValues(activeValues.filter((item) => item !== value));
      return;
    }

    commitValues([...activeValues, value]);
  };

  const handleSelectAll = () => {
    if (onSelectAll && !commitOnApply) {
      onSelectAll();
      return;
    }
    commitValues(availableOptions.map((option) => option.value));
  };

  const handleReset = () => {
    if (onReset && !commitOnApply) {
      onReset();
      return;
    }
    commitValues([]);
  };

  const applySelection = () => {
    if (commitOnApply) {
      onChange([...draftValues]);
    }
    onApply?.();

    if (closeOnApply || commitOnApply) {
      setOpen(false);
      setSearchQuery('');
    }
  };

  const toggleOpen = () => {
    if (open) {
      closeMenu();
      return;
    }

    if (menuGroup && menuKey) {
      window.dispatchEvent(new CustomEvent('nested-menu-open', {
        detail: { group: menuGroup, key: menuKey },
      }));
    }

    const commitOpen = () => setOpen(true);

    if (onBeforeOpen) {
      onBeforeOpen(commitOpen, popoverExpectedHeight);
      return;
    }

    commitOpen();
  };

  const renderOption = (option: SelectOption<string>) => (
    <label
      className={`multi-option ${option.disabled ? 'is-disabled' : ''}`}
      key={option.value}
    >
      <input
        type="checkbox"
        checked={activeValues.includes(option.value)}
        disabled={Boolean(option.disabled) && !activeValues.includes(option.value)}
        onChange={() => toggleValue(option.value)}
      />
      <span className="multi-option-main">
        <span>{option.label}</span>
        {option.disabled && (
          <span className="multi-option-hint">{option.hint || 'Недоступно'}</span>
        )}
      </span>
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
      {(showSelectAll || showReset || showApply) && (
        <div className="multi-actions">
          {showReset && (
            <button type="button" className="multi-action-button" onClick={handleReset}>
              Сбросить
            </button>
          )}
          {showSelectAll && (
            <button type="button" className="multi-action-button" onClick={handleSelectAll}>
              Выбрать все
            </button>
          )}
          {showApply && (
            <button type="button" className="multi-action-button multi-action-button--primary" onClick={applySelection}>
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
    <div className={`select-shell multi-select ${open ? 'is-open' : ''} ${anchorMenu ? 'has-anchor-menu' : ''}`} ref={ref}>
      <button
        className="select-trigger"
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <span>{label}</span>
        <ChevronDown size={16} />
      </button>
      {open ? (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className={`select-menu multi-menu${anchorMenu ? ' multi-menu--anchored' : ''}`}
          expectedWidth={popoverExpectedWidth}
          expectedHeight={popoverExpectedHeight}
          verticalPlacement={popoverVerticalPlacement}
          matchAnchorWidth={anchorMenu || matchAnchorWidth}
          constrainHeight
          allowVerticalOverflow={popoverAllowVerticalOverflow}
          portalContainer={popoverContainer}
        >
          {renderOptionsList()}
        </FloatingPopover>
      ) : null}
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
  tableRowChartsMode = 'compact',
  onTableRowChartsModeChange,
  hideZeroRows = false,
  onHideZeroRowsChange,
  onExpandAllRowCharts,
  onCollapseAllRowCharts,
  trigger = 'icon',
}: {
  selectedSources: string[];
  crmSourceOptions: SelectOption<string>[];
  onSourcesChange: (values: string[]) => void;
  onApply: () => void;
  tableRowChartsMode?: TableRowChartsMode;
  onTableRowChartsModeChange?: (mode: TableRowChartsMode) => void;
  hideZeroRows?: boolean;
  onHideZeroRowsChange?: (value: boolean) => void;
  onExpandAllRowCharts?: () => void;
  onCollapseAllRowCharts?: () => void;
  trigger?: 'icon' | 'text';
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  // Close only via the header X (or the trigger toggle) — scrolling the page
  // must not dismiss table settings while the user is browsing sources.
  const ref = useOutsideClose<HTMLDivElement>(false, () => setOpen(false), [popoverRef]);

  const handleApply = () => {
    onApply();
    setOpen(false);
  };

  return (
    <div className={`menu-button-shell ${open ? 'is-open' : ''}`} ref={ref}>
      {trigger === 'icon' ? (
        <TooltipButton
          label="Настройки таблицы"
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
          <span>Настройки таблицы</span>
        </button>
      )}
      {open && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="settings-popover table-settings-popover"
          expectedWidth={320}
          expectedHeight={860}
          updateOnScroll={false}
        >
          <div className="table-settings-head">
            <p>Настройки таблицы</p>
            <button
              className="row-menu-close"
              type="button"
              aria-label="Закрыть настройки таблицы"
              onClick={() => setOpen(false)}
            >
              <X size={14} />
            </button>
          </div>
          <div className="table-settings-display-block">
            <div className="table-settings-section">
              <p className="table-settings-group-title">Как показывать строки</p>
              <div className="table-settings-mode-options" role="radiogroup" aria-label="Как показывать строки">
                <label className={`table-settings-mode-option ${tableRowChartsMode === 'compact' ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="table-row-charts-mode"
                    checked={tableRowChartsMode === 'compact'}
                    onChange={() => onTableRowChartsModeChange?.('compact')}
                  />
                  <span>Компактный</span>
                </label>
                <label className={`table-settings-mode-option ${tableRowChartsMode === 'with_charts' ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="table-row-charts-mode"
                    checked={tableRowChartsMode === 'with_charts'}
                    onChange={() => onTableRowChartsModeChange?.('with_charts')}
                  />
                  <span>С графиками</span>
                </label>
              </div>
            </div>

            <div className="table-settings-section">
              <p className="table-settings-group-title">Графики в таблице</p>
              <p className="table-settings-group-hint">
                {tableRowChartsMode === 'with_charts'
                  ? 'Открыть или закрыть графики у всех строк.'
                  : 'Сначала включите режим «С графиками».'}
              </p>
              <div className="table-settings-chart-actions">
                <button
                  className="table-settings-chart-button"
                  type="button"
                  disabled={tableRowChartsMode !== 'with_charts'}
                  title={tableRowChartsMode !== 'with_charts' ? 'Сначала включите режим «С графиками»' : undefined}
                  onClick={() => {
                    onExpandAllRowCharts?.();
                  }}
                >
                  Развернуть все
                </button>
                <button
                  className="table-settings-chart-button"
                  type="button"
                  disabled={tableRowChartsMode !== 'with_charts'}
                  title={tableRowChartsMode !== 'with_charts' ? 'Сначала включите режим «С графиками»' : undefined}
                  onClick={() => {
                    onCollapseAllRowCharts?.();
                  }}
                >
                  Свернуть все
                </button>
              </div>
            </div>

            <div className="table-settings-section">
              <p className="table-settings-group-title">Пустые строки</p>
              <label className={`table-settings-checkbox ${hideZeroRows ? 'is-active' : ''}`}>
                <input
                  type="checkbox"
                  checked={hideZeroRows}
                  onChange={(event) => onHideZeroRowsChange?.(event.target.checked)}
                />
                <span>
                  <strong>Скрыть нулевые показатели</strong>
                  <em>Прячет показатели и сотрудников, у которых за весь период только 0 или «—».</em>
                </span>
              </label>
            </div>
          </div>
          <div className="table-settings-sources-block">
            <p className="table-settings-group-title">Выбрать показатели</p>
            <MultiSelect
              variant="inline"
              values={selectedSources}
              options={crmSourceOptions}
              onChange={onSourcesChange}
              onSelectAll={() =>
                onSourcesChange(
                  crmSourceOptions
                    .filter((option) => !option.disabled)
                    .map((option) => option.value),
                )
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
  calculationPeriodLabel,
  mainDirection,
  onMainDirectionChange,
  onApply,
  onDraftChange,
  onThresholdApply,
  onThresholdReset,
}: {
  filters: ReportFilters;
  crmSourceOptions: SelectOption<string>[];
  mainThreshold: ThresholdValues;
  mainRecommendedThreshold: RecommendedThresholdValues;
  calculationPeriodLabel?: string;
  mainDirection?: MetricDirection;
  onMainDirectionChange?: (direction: MetricDirection) => void;
  onApply: (settings: ChartDraftSettings) => void;
  onDraftChange: (settings: ChartDraftSettings) => void;
  onThresholdApply: (value: ThresholdValues) => void;
  onThresholdReset: () => void;
}) {
  const chartMenuGroup = 'configure-chart';
  const [open, setOpen] = useState(false);
  const [scheduleApplyError, setScheduleApplyError] = useState('');
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
    setScheduleApplyError('');
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

  const applySettings = ({ closeMenu = true }: { closeMenu?: boolean } = {}) => {
    const workdayError =
      filters.period === 'hours' ? getWorkdayScheduleError(draftSettings.schedule) : null;

    if (workdayError) {
      setScheduleApplyError(workdayError);
      return;
    }

    setScheduleApplyError('');
    onApply({
      selectedSources: [...draftSettings.selectedSources],
      chartDisplayMode: draftSettings.chartDisplayMode,
      metricMode: draftSettings.metricMode,
      schedule: {
        ...draftSettings.schedule,
        weekendDayIds: [...draftSettings.schedule.weekendDayIds],
      },
    });
    if (closeMenu) {
      setOpen(false);
    }
  };

  return (
    <div className={`menu-button-shell configure-chart-shell ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        className={`left-panel-action-button configure-chart-button ${open ? 'active-pin' : ''}`}
        type="button"
        aria-expanded={open}
        onClick={open ? () => setOpen(false) : openMenu}
      >
        <SlidersHorizontal size={16} />
        <span>Выбрать главный показатель</span>
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
            <p>Выбрать главный показатель</p>
            <button
              className="row-menu-close"
              type="button"
              aria-label="Закрыть выбор главного показателя"
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
                  chartDisplayMode: 'sum',
                }))
              }
              onSelectAll={() =>
                updateDraftSettings((current) => ({
                  ...current,
                  selectedSources: crmSourceOptions
                    .filter((option) => !option.disabled)
                    .map((option) => option.value),
                  chartDisplayMode: 'sum',
                }))
              }
              onReset={() =>
                updateDraftSettings((current) => ({
                  ...current,
                  selectedSources: [],
                }))
              }
              onApply={() => applySettings({ closeMenu: false })}
              closeOnApply
              menuGroup={chartMenuGroup}
              menuKey="sources"
            />
            {draftSettings.selectedSources.length > 1 ? (
              <p className="configure-chart-sum-hint">
                Несколько источников суммируются в один главный показатель.
              </p>
            ) : null}
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
              menuGroup={chartMenuGroup}
              menuKey="metric-mode"
            />
            <ThresholdMenu
              value={mainThreshold}
              recommended={mainRecommendedThreshold}
              calculationPeriodLabel={calculationPeriodLabel}
              valueType={draftSettings.metricMode}
              direction={mainDirection}
              onDirectionChange={onMainDirectionChange}
              onApply={onThresholdApply}
              onReset={onThresholdReset}
              menuGroup={chartMenuGroup}
              menuKey="thresholds"
            />
            <ScheduleMenu
              schedule={draftSettings.schedule}
              period={filters.period}
              onChange={(schedule) => {
                setScheduleApplyError('');
                updateDraftSettings((current) => ({
                  ...current,
                  schedule,
                }));
              }}
              menuGroup={chartMenuGroup}
              menuKey="schedule"
            />
          </div>
          {scheduleApplyError ? (
            <em className="threshold-field-error schedule-apply-error">{scheduleApplyError}</em>
          ) : null}
          <button className="configure-chart-apply blue-button" type="button" onClick={() => applySettings()}>
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
  calculationPeriodLabel,
  valueType,
  direction = 'none',
  onDirectionChange,
  onDirectionMenuOpen,
  onApply,
  onReset,
  onClose,
  embedded = false,
  directionMenuContainer,
  directionMenuAllowVerticalOverflow = false,
}: {
  threshold: ThresholdValues;
  recommended: RecommendedThresholdValues;
  /** Human-readable report period used for corridor calculation (same as display for now). */
  calculationPeriodLabel?: string;
  valueType?: CorridorValueType;
  direction?: MetricDirection;
  onDirectionChange?: (direction: MetricDirection) => void;
  onDirectionMenuOpen?: () => void;
  onApply: (value: ThresholdValues) => void;
  onReset: () => void;
  onClose?: () => void;
  /** WEB-SET-001: inline in settings panel without popover chrome. */
  embedded?: boolean;
  directionMenuContainer?: HTMLElement | null;
  directionMenuAllowVerticalOverflow?: boolean;
}) {
  const initialMode: 'manual' | 'recommended' = threshold.mode === 'manual' ? 'manual' : 'recommended';
  const [editorMode, setEditorMode] = useState<'manual' | 'recommended'>(initialMode);
  const [upper, setUpper] = useState(
    initialMode === 'manual' ? threshold.upper : (recommended.upper || threshold.upper),
  );
  const [average, setAverage] = useState(
    initialMode === 'manual'
      ? (threshold.average ?? '')
      : (recommended.average || threshold.average || ''),
  );
  const [lower, setLower] = useState(
    initialMode === 'manual' ? threshold.lower : (recommended.lower || threshold.lower),
  );
  const [errors, setErrors] = useState<CorridorValidationErrors>({});
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  const [isApplied, setIsApplied] = useState(false);

  const isAutoMode = editorMode === 'recommended';
  const displayUpper = isAutoMode ? formatCorridorFieldValue(recommended.upper) : upper;
  const displayAverage = isAutoMode ? formatCorridorFieldValue(recommended.average) : average;
  const displayLower = isAutoMode ? formatCorridorFieldValue(recommended.lower) : lower;

  const canSaveAuto =
    parseThreshold(recommended.upper) !== null && parseThreshold(recommended.lower) !== null;

  const markDirty = () => {
    setIsApplied(false);
  };

  const switchMode = (nextMode: 'manual' | 'recommended') => {
    setErrors({});
    setShowReplaceConfirm(false);
    setIsApplied(false);
    setEditorMode(nextMode);

    if (nextMode === 'manual') {
      if (threshold.mode === 'manual') {
        setUpper(threshold.upper);
        setAverage(threshold.average ?? '');
        setLower(threshold.lower);
      } else {
        setUpper(recommended.upper || threshold.upper || '');
        setAverage(recommended.average || threshold.average || '');
        setLower(recommended.lower || threshold.lower || '');
      }
      return;
    }

    setUpper(recommended.upper || '');
    setAverage(recommended.average || '');
    setLower(recommended.lower || '');
  };

  const applyManual = () => {
    const nextErrors = validateCorridorFields({ upper, average, lower }, valueType);
    setErrors(nextErrors);
    if (hasCorridorValidationErrors(nextErrors)) {
      return;
    }

    onApply({
      upper: upper.trim(),
      lower: lower.trim(),
      average: average.trim(),
      mode: 'manual',
    });
    setIsApplied(true);
  };

  const applyAutomatic = () => {
    if (!canSaveAuto) {
      return;
    }

    onApply({
      upper: recommended.upper,
      lower: recommended.lower,
      average: recommended.average,
      mode: 'recommended',
    });
    setShowReplaceConfirm(false);
    setIsApplied(true);
  };

  const handleSave = () => {
    if (isApplied) {
      return;
    }

    if (editorMode === 'manual') {
      applyManual();
      return;
    }

    if (isManualThreshold(threshold) && !showReplaceConfirm) {
      setShowReplaceConfirm(true);
      return;
    }

    applyAutomatic();
  };

  const resetValues = () => {
    setUpper('');
    setAverage('');
    setLower('');
    setErrors({});
    setShowReplaceConfirm(false);
    setEditorMode('recommended');
    onReset();
    setIsApplied(true);
  };

  const fieldError = (key: CorridorFieldKey) => errors[key];

  return (
    <div className={`threshold-editor${embedded ? ' is-embedded' : ''}`}>
      {!embedded ? (
        <div className="threshold-popover-head">
          <p>Коридор показателя</p>
          <button
            className="row-menu-close"
            type="button"
            aria-label="Закрыть настройки коридора"
            onClick={() => onClose?.()}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {onDirectionChange ? (
        <label className="threshold-field compact-threshold-field threshold-direction-field">
          <span>Как оценивать показатель?</span>
          <CustomSelect
            options={METRIC_DIRECTION_OPTIONS}
            value={direction}
            onChange={(nextDirection) => {
              markDirty();
              onDirectionChange(nextDirection);
            }}
            ariaLabel="Как оценивать показатель?"
            className="threshold-direction-select"
            menuClassName="select-menu threshold-direction-menu"
            expectedWidth={260}
            expectedHeight={180}
            verticalPlacement="below"
            closeOnScroll={false}
            popoverContainer={directionMenuContainer}
            popoverAllowVerticalOverflow={directionMenuAllowVerticalOverflow}
            onOpen={onDirectionMenuOpen}
          />
        </label>
      ) : null}

      <div className="threshold-mode-switch" role="tablist" aria-label="Режим коридора">
        <button
          type="button"
          role="tab"
          aria-selected={editorMode === 'recommended'}
          className={editorMode === 'recommended' ? 'is-active' : ''}
          onClick={() => switchMode('recommended')}
        >
          Настроен автоматически
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={editorMode === 'manual'}
          className={editorMode === 'manual' ? 'is-active' : ''}
          onClick={() => switchMode('manual')}
        >
          Задать вручную
        </button>
      </div>

      <div className={`threshold-embedded-body${embedded ? '' : ' is-stacked'}`}>
        {calculationPeriodLabel ? (
          <p className="threshold-period-hint">
            Период расчёта: {calculationPeriodLabel}
            <span className="threshold-period-hint-note"> (совпадает с периодом отчёта)</span>
          </p>
        ) : embedded ? (
          <span className="threshold-period-hint-spacer" aria-hidden="true" />
        ) : null}

        <div className="threshold-single-column">
          <label className={`threshold-field compact-threshold-field ${fieldError('upper') ? 'has-error' : ''}`}>
            <span>Верхняя граница</span>
            <input
              type={isAutoMode ? 'text' : 'number'}
              value={displayUpper}
              readOnly={isAutoMode}
              onChange={(event) => {
                markDirty();
                setUpper(event.target.value);
                setErrors((current) => {
                  const next = { ...current };
                  delete next.upper;
                  return next;
                });
              }}
              placeholder="90"
            />
            {fieldError('upper') ? <em className="threshold-field-error">{fieldError('upper')}</em> : null}
          </label>
          <label className={`threshold-field compact-threshold-field ${fieldError('average') ? 'has-error' : ''}`}>
            <span>Средний уровень</span>
            <input
              type={isAutoMode ? 'text' : 'number'}
              value={displayAverage}
              readOnly={isAutoMode}
              onChange={(event) => {
                markDirty();
                setAverage(event.target.value);
                setErrors((current) => {
                  const next = { ...current };
                  delete next.average;
                  return next;
                });
              }}
              placeholder="60"
            />
            {fieldError('average') ? <em className="threshold-field-error">{fieldError('average')}</em> : null}
          </label>
          <label className={`threshold-field compact-threshold-field ${fieldError('lower') ? 'has-error' : ''}`}>
            <span>Нижняя граница</span>
            <input
              type={isAutoMode ? 'text' : 'number'}
              value={displayLower}
              readOnly={isAutoMode}
              onChange={(event) => {
                markDirty();
                setLower(event.target.value);
                setErrors((current) => {
                  const next = { ...current };
                  delete next.lower;
                  return next;
                });
              }}
              placeholder="30"
            />
            {fieldError('lower') ? <em className="threshold-field-error">{fieldError('lower')}</em> : null}
          </label>
        </div>
      </div>

      {showReplaceConfirm ? (
        <div className="threshold-replace-warning" role="alert">
          <p>
            Сейчас сохранён ручной коридор. Автоматический расчёт заменит эти значения.
            Подтвердите замену или вернитесь к ручному режиму.
          </p>
          <div className="threshold-replace-actions">
            <button
              type="button"
              className="threshold-apply-button manual-apply-button"
              onClick={() => setShowReplaceConfirm(false)}
            >
              Отмена
            </button>
            <button
              type="button"
              className="threshold-apply-button recommended-apply-button"
              disabled={!canSaveAuto}
              onClick={applyAutomatic}
            >
              Заменить
            </button>
          </div>
        </div>
      ) : (
        <div className="threshold-editor-actions">
          <button
            className="popover-reset-button"
            type="button"
            onClick={resetValues}
          >
            Сбросить
          </button>
          <button
            className={`threshold-apply-button ${
              isApplied
                ? 'is-applied'
                : isAutoMode
                  ? 'recommended-apply-button'
                  : 'manual-apply-button'
            }`}
            type="button"
            disabled={isApplied || (isAutoMode && !canSaveAuto)}
            onClick={handleSave}
            aria-label={isApplied ? 'Применено' : 'Применить'}
          >
            {isApplied ? 'Применено' : 'Применить'}
          </button>
        </div>
      )}
    </div>
  );
}

export function ThresholdMenu({
  value,
  recommended,
  calculationPeriodLabel,
  valueType,
  direction,
  onDirectionChange,
  onApply,
  onReset,
  menuGroup,
  menuKey,
}: {
  value: ThresholdValues;
  recommended: RecommendedThresholdValues;
  calculationPeriodLabel?: string;
  valueType?: CorridorValueType;
  direction?: MetricDirection;
  onDirectionChange?: (direction: MetricDirection) => void;
  onApply: (value: ThresholdValues) => void;
  onReset: () => void;
  menuGroup?: string;
  menuKey?: string;
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  // Corridor panel closes only via the editor × — not outside click / Apply / Reset.
  const ref = useOutsideClose<HTMLDivElement>(false, () => setOpen(false), [popoverRef]);

  useEffect(() => {
    if (!menuGroup || !menuKey) {
      return undefined;
    }

    const handleMenuOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ group?: string; key?: string }>).detail;

      if (detail?.group === menuGroup && detail.key !== menuKey) {
        setOpen(false);
      }
    };

    window.addEventListener('nested-menu-open', handleMenuOpen);

    return () => {
      window.removeEventListener('nested-menu-open', handleMenuOpen);
    };
  }, [menuGroup, menuKey]);

  const openCorridor = () => {
    if (open) {
      return;
    }

    if (menuGroup && menuKey) {
      window.dispatchEvent(new CustomEvent('nested-menu-open', {
        detail: { group: menuGroup, key: menuKey },
      }));
    }

    setOpen(true);
  };

  return (
    <div className={`threshold-shell ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        className="threshold-trigger"
        type="button"
        aria-expanded={open}
        onClick={openCorridor}
      >
        <SlidersHorizontal size={17} />
        <span>Коридор показателя</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="settings-popover threshold-popover"
          expectedWidth={268}
          expectedHeight={480}
        >
          <ThresholdEditor
            threshold={value}
            recommended={recommended}
            calculationPeriodLabel={calculationPeriodLabel}
            valueType={valueType}
            direction={direction}
            onDirectionChange={onDirectionChange}
            onApply={onApply}
            onReset={onReset}
            onClose={() => setOpen(false)}
          />
        </FloatingPopover>
      )}
    </div>
  );
}

const cloneScheduleFilters = (value: ScheduleFilters): ScheduleFilters => ({
  ...value,
  weekendDayIds: [...value.weekendDayIds],
});

const scheduleTimeSelectOptions: SelectOption<string>[] = [
  { value: '', label: '00:00' },
  ...scheduleTimeOptions
    .filter((time) => time !== '00:00')
    .map((time) => ({ value: time, label: time })),
];

type PopoverAnchorRect = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'>;

export function ScheduleMenu({
  schedule,
  period,
  onChange,
  menuGroup,
  menuKey,
  triggerLabel = 'Рабочий календарь',
  triggerCompact = false,
  showWorkdayTimeFields = false,
  popoverHorizontalPlacement = 'left',
  popoverVerticalPlacement = 'auto',
  popoverAnchorRect,
  popoverContainer,
  popoverPortalToBody = false,
  onOpen,
  onBeforeOpen,
}: {
  schedule: ScheduleFilters;
  period: Period;
  onChange: (schedule: ScheduleFilters) => void;
  menuGroup?: string;
  menuKey?: string;
  triggerLabel?: string;
  /** Compact text button for embedded panels (W01 «Изменить»). */
  triggerCompact?: boolean;
  /** Show workday start/end controls outside the hourly grouping menu. */
  showWorkdayTimeFields?: boolean;
  popoverHorizontalPlacement?: 'left' | 'right';
  popoverVerticalPlacement?: 'auto' | 'anchor-start' | 'below';
  popoverAnchorRect?: PopoverAnchorRect | null;
  popoverContainer?: HTMLElement | null;
  popoverPortalToBody?: boolean;
  onOpen?: () => void;
  onBeforeOpen?: (openMenu: () => void, popoverHeight: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [scheduleApplied, setScheduleApplied] = useState(false);
  const [draftSchedule, setDraftSchedule] = useState<ScheduleFilters>(() => cloneScheduleFilters(schedule));
  const popoverRef = useRef<HTMLDivElement>(null);
  const ref = useOutsideClose<HTMLDivElement>(
    open,
    () => setOpen(false),
    [popoverRef],
    { closeOnPointerDown: false, closeOnScroll: false },
  );
  const scheduleNestedMenuGroup = menuGroup && menuKey
    ? `${menuGroup}-${menuKey}`
    : 'schedule-menu';
  const showWorkdayFields = showWorkdayTimeFields || period === 'hours';
  const showWeekendFields = period === 'days' || period === 'weeks';
  const showWeekStartFields = period === 'days' || period === 'weeks';
  const hasEditableFields = showWorkdayFields || showWeekendFields || showWeekStartFields;
  const workdayError = showWorkdayFields ? getWorkdayScheduleError(draftSchedule) : null;
  const expectedHeight =
    120
    + (showWorkdayFields ? 140 : 0)
    + (showWeekendFields ? 110 : 0)
    + (showWeekStartFields ? 110 : 0)
    + (workdayError ? 36 : 0)
    + (hasEditableFields ? 0 : 40);

  const openMenu = () => {
    setDraftSchedule(cloneScheduleFilters(schedule));
    setScheduleApplied(false);
    if (menuGroup && menuKey) {
      window.dispatchEvent(new CustomEvent('nested-menu-open', {
        detail: { group: menuGroup, key: menuKey },
      }));
    }

    const commitOpen = () => {
      setOpen(true);
      onOpen?.();
    };

    if (onBeforeOpen) {
      onBeforeOpen(commitOpen, expectedHeight);
      return;
    }

    commitOpen();
  };

  const updateDraftSchedule = (nextSchedule: ScheduleFilters) => {
    setScheduleApplied(false);
    setDraftSchedule(cloneScheduleFilters(nextSchedule));
  };

  const toggleWeekendDay = (dayId: number) => {
    const weekendDayIds = draftSchedule.weekendDayIds.includes(dayId)
      ? draftSchedule.weekendDayIds.filter((currentDayId) => currentDayId !== dayId)
      : [...draftSchedule.weekendDayIds, dayId];

    updateDraftSchedule({
      ...draftSchedule,
      weekendDayIds,
    });
  };

  const applySchedule = () => {
    if (workdayError) {
      return;
    }

    onChange(cloneScheduleFilters(draftSchedule));
    setScheduleApplied(true);
  };

  return (
    <div className={`threshold-shell schedule-shell ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        className={`threshold-trigger schedule-trigger${triggerCompact ? ' is-compact' : ''}`}
        type="button"
        aria-expanded={open}
        onClick={open ? undefined : openMenu}
      >
        {triggerCompact ? null : <CalendarClock size={17} />}
        <span>{triggerLabel}</span>
        {triggerCompact ? null : <ChevronDown size={16} />}
      </button>
      {open && (
        <FloatingPopover
          anchorRef={ref}
          anchorRect={popoverAnchorRect}
          popoverRef={popoverRef}
          open={open}
          className="settings-popover schedule-popover"
          expectedWidth={360}
          expectedHeight={expectedHeight}
          horizontalPlacement={popoverHorizontalPlacement}
          verticalPlacement={popoverVerticalPlacement}
          updateOnScroll
          constrainHeight={false}
          portalToBody={popoverPortalToBody}
          allowVerticalOverflow={popoverPortalToBody}
          portalContainer={popoverContainer}
        >
          <div className="schedule-popover-head">
            <p>Рабочий календарь</p>
            <button
              className="schedule-popover-close"
              type="button"
              aria-label="Закрыть рабочий календарь"
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </button>
          </div>
          <div className="schedule-form">
            {showWorkdayFields && (
              <>
                <div className="schedule-workday-time-row">
                  <div className={`schedule-field ${workdayError ? 'has-error' : ''}`}>
                    <span>Рабочий день с</span>
                    <CustomSelect
                      options={scheduleTimeSelectOptions}
                      value={draftSchedule.workdayStart}
                      onChange={(workdayStart) =>
                        updateDraftSchedule({
                          ...draftSchedule,
                          workdayStart,
                        })
                      }
                      ariaLabel="Время начала рабочего дня"
                      className="schedule-time-select"
                      menuClassName="select-menu schedule-time-menu"
                      expectedWidth={128}
                      expectedHeight={240}
                      verticalPlacement="below"
                      closeOnScroll={!popoverPortalToBody}
                      freezePopoverPositionOnOpen={popoverPortalToBody}
                      popoverPortalToBody={popoverPortalToBody}
                      popoverUpdateOnScroll={!popoverPortalToBody}
                      menuGroup={scheduleNestedMenuGroup}
                      menuKey="workday-start"
                    />
                  </div>
                  <div className={`schedule-field ${workdayError ? 'has-error' : ''}`}>
                    <span>Рабочий день до</span>
                    <CustomSelect
                      options={scheduleTimeSelectOptions}
                      value={draftSchedule.workdayEnd}
                      onChange={(workdayEnd) =>
                        updateDraftSchedule({
                          ...draftSchedule,
                          workdayEnd,
                        })
                      }
                      ariaLabel="Время окончания рабочего дня"
                      className="schedule-time-select"
                      menuClassName="select-menu schedule-time-menu"
                      expectedWidth={128}
                      expectedHeight={240}
                      verticalPlacement="below"
                      closeOnScroll={!popoverPortalToBody}
                      freezePopoverPositionOnOpen={popoverPortalToBody}
                      popoverPortalToBody={popoverPortalToBody}
                      popoverUpdateOnScroll={!popoverPortalToBody}
                      menuGroup={scheduleNestedMenuGroup}
                      menuKey="workday-end"
                    />
                  </div>
                </div>
                {workdayError ? <em className="threshold-field-error">{workdayError}</em> : null}
              </>
            )}
            {showWeekendFields && (
              <div className="schedule-field">
                <span>Выходные дни</span>
                <div className="schedule-day-grid">
                  {weekDayOptions.map((day) => {
                    const selected = draftSchedule.weekendDayIds.includes(day.id);

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
            )}
            {showWeekStartFields && (
              <div className="schedule-field">
                <span>Неделя начинается с</span>
                <div className="schedule-day-grid">
                  {weekDayOptions.map((day) => {
                    const selected = draftSchedule.calendarWeekStart === day.id;

                    return (
                      <button
                        className={`schedule-day-button ${selected ? 'is-selected' : ''}`}
                        type="button"
                        key={day.id}
                        onClick={() =>
                          updateDraftSchedule({
                            ...draftSchedule,
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
            )}
            {!hasEditableFields ? (
              <p className="schedule-period-hint">
                Для текущей группировки настройки календаря не применяются.
              </p>
            ) : null}
            <div className="schedule-form-actions">
              {hasEditableFields ? (
                <button
                  className={`threshold-apply-button manual-apply-button${scheduleApplied ? ' is-applied' : ''}`}
                  type="button"
                  disabled={Boolean(workdayError)}
                  onClick={applySchedule}
                >
                  Применить
                </button>
              ) : null}
              <button
                className="popover-reset-button"
                type="button"
                onClick={() => updateDraftSchedule(createDefaultSchedule())}
              >
                Вернуть настройки по умолчанию
              </button>
            </div>
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
        label="Коридор показателя"
        className={`row-action-button ${open ? 'active-pin' : ''}`}
        onClick={() => setOpen((current) => !current)}
      >
        <SlidersHorizontal size={14} />
      </TooltipButton>
      {open && (
        <div className="settings-popover row-threshold-popover">
          <p>Коридор показателя</p>
          <label className="threshold-field">
            <span>Верхняя граница</span>
            <input
              type="number"
              value={value.upper}
              onChange={(event) => onChange({
                upper: event.target.value,
                lower: value.lower,
                mode: 'manual',
              })}
              placeholder="Например, 80"
            />
          </label>
          <label className="threshold-field">
            <span>Нижняя граница</span>
            <input
              type="number"
              value={value.lower}
              onChange={(event) => onChange({
                upper: value.upper,
                lower: event.target.value,
                mode: 'manual',
              })}
              placeholder="Например, 30"
            />
          </label>
          <label className="threshold-field">
            <span>Средний уровень</span>
            <input value={average === null ? '' : average} readOnly />
          </label>
          <button
            className="popover-reset-button"
            type="button"
            onClick={() => onChange({ upper: '', lower: '', mode: null })}
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
  hasAppliedEmployees,
  chartOpen,
  threshold,
  recommendedThreshold,
  employeeThreshold,
  employeeRecommendedThreshold,
  onToggleEmployees,
  onOpenEmployeeSelector,
  employees = [],
  selectedEmployeeIds,
  onToggleEmployee,
  onSelectAllEmployees,
  onResetEmployees,
  onApplyEmployees,
  onDiscardEmployees,
  onExpandAllEmployeeCharts,
  onCollapseAllEmployeeCharts,
  employeeChartsExpanded,
  onToggleChart,
  onThresholdChange,
  onEmployeeThresholdChange,
  showEmployees = true,
  metricId,
  calculationPeriodLabel,
  valueType,
  direction,
  onDirectionChange,
}: {
  employeesOpen: boolean;
  hasAppliedEmployees?: boolean;
  chartOpen: boolean;
  threshold: ThresholdValues;
  recommendedThreshold: RecommendedThresholdValues;
  employeeThreshold: ThresholdValues;
  employeeRecommendedThreshold: RecommendedThresholdValues;
  onToggleEmployees: () => void;
  onOpenEmployeeSelector?: () => void;
  employees?: ReportEmployee[];
  selectedEmployeeIds?: Set<string>;
  onToggleEmployee?: (employeeId: string) => void;
  onSelectAllEmployees?: (employeeIds: string[]) => void;
  onResetEmployees?: () => void;
  onApplyEmployees?: () => void;
  onDiscardEmployees?: () => void;
  onExpandAllEmployeeCharts?: () => void;
  onCollapseAllEmployeeCharts?: () => void;
  employeeChartsExpanded?: boolean;
  onToggleChart: () => void;
  onThresholdChange: (value: ThresholdValues) => void;
  onEmployeeThresholdChange: (value: ThresholdValues) => void;
  /** Hide employees action when per-source employee breakdown is unavailable. */
  showEmployees?: boolean;
  /** Metric/action id used to find the first employee table row for popover alignment. */
  metricId?: string;
  calculationPeriodLabel?: string;
  valueType?: CorridorValueType;
  direction?: MetricDirection;
  onDirectionChange?: (direction: MetricDirection) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'actions' | 'thresholds' | 'employees'>('actions');
  const [employeeBrowseMode, setEmployeeBrowseMode] = useState<'employees' | 'departments'>('employees');
  const [activeDepartmentId, setActiveDepartmentId] = useState<string | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [showInactiveEmployees, setShowInactiveEmployees] = useState(false);
  const [employeeSelectorAnchorRect, setEmployeeSelectorAnchorRect] = useState<DOMRect | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const employeeSelectorListRef = useRef<HTMLDivElement>(null);
  const pendingEmployeeScrollTopRef = useRef<number | null>(null);
  const stickyPopoverMode = mode === 'employees' || mode === 'thresholds';
  const ref = useOutsideClose<HTMLDivElement>(
    open && !stickyPopoverMode,
    () => {
      setOpen(false);
    },
    [popoverRef],
  );

  const resolveEmployeeListAnchorRect = useCallback((): DOMRect | null => {
    const reportCard = ref.current?.closest('.report-card');
    if (!reportCard) {
      return null;
    }

    if (metricId) {
      // Attribute selector value: escape quotes/backslashes only (not CSS.escape — that breaks ids).
      const escapedMetricId = metricId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const firstEmployeeRow = reportCard.querySelector(
        `[data-row-id^="employee-${escapedMetricId}-"]`,
      ) as HTMLElement | null;

      if (firstEmployeeRow) {
        const rect = firstEmployeeRow.getBoundingClientRect();
        // Vertical align only — narrow width so FloatingPopover does not stretch to the row.
        return new DOMRect(rect.left, rect.top, 1, rect.height);
      }
    }

    // Employees not in DOM yet: align to the bottom of the metric row (where the list starts).
    const metricRow = ref.current?.closest('.report-table-row') as HTMLElement | null;
    if (metricRow) {
      const rect = metricRow.getBoundingClientRect();
      return new DOMRect(rect.left, rect.bottom, 1, 1);
    }

    return null;
  }, [metricId, ref]);
  const selectableEmployees = useMemo(
    () => (showInactiveEmployees ? employees : employees.filter((employee) => employee.isActive !== false)),
    [employees, showInactiveEmployees],
  );
  const departmentGroups = useMemo(
    () => buildEmployeeDepartmentGroups(selectableEmployees),
    [selectableEmployees],
  );
  const activeDepartment = useMemo(
    () => departmentGroups.find((group) => group.id === activeDepartmentId) ?? null,
    [activeDepartmentId, departmentGroups],
  );
  const departmentEmployees = useMemo(() => {
    if (!activeDepartment) {
      return [];
    }

    const ids = new Set(activeDepartment.employeeIds);
    return selectableEmployees.filter((employee) => ids.has(employee.id));
  }, [activeDepartment, selectableEmployees]);
  const filteredDepartments = useMemo(() => {
    const query = employeeSearch.trim().toLocaleLowerCase('ru-RU');

    if (!query) {
      return departmentGroups;
    }

    return departmentGroups.filter((group) =>
      group.label.toLocaleLowerCase('ru-RU').includes(query),
    );
  }, [departmentGroups, employeeSearch]);
  const employeesForList = useMemo(() => {
    if (employeeBrowseMode === 'departments' && activeDepartment) {
      return departmentEmployees;
    }

    return selectableEmployees;
  }, [activeDepartment, departmentEmployees, employeeBrowseMode, selectableEmployees]);
  const filteredEmployees = useMemo(() => {
    const query = employeeSearch.trim().toLocaleLowerCase('ru-RU');

    if (!query) {
      return employeesForList;
    }

    return employeesForList.filter((employee) =>
      [
        employee.firstName,
        employee.lastName,
        employee.name,
        employee.department,
        employee.workPosition,
        employee.id,
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('ru-RU')
        .includes(query),
    );
  }, [employeeSearch, employeesForList]);
  const showDepartmentList = employeeBrowseMode === 'departments' && !activeDepartment;
  const listEmployees = showDepartmentList ? [] : filteredEmployees;
  const duplicateNameKeys = useMemo(() => {
    const counts = new Map<string, number>();

    listEmployees.forEach((employee) => {
      const key = getEmployeeFullName(employee).toLocaleLowerCase('ru-RU');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });

    return new Set(
      Array.from(counts.entries())
        .filter(([, count]) => count > 1)
        .map(([key]) => key),
    );
  }, [listEmployees]);
  const selectedCount = selectedEmployeeIds?.size ?? 0;
  const hasInactiveEmployees = employees.some((employee) => employee.isActive === false);

  useEffect(() => {
    if (!open || mode !== 'employees') {
      return undefined;
    }

    let frame = 0;
    const syncAnchorToEmployeeList = () => {
      const listRect = resolveEmployeeListAnchorRect();
      if (listRect) {
        setEmployeeSelectorAnchorRect(listRect);
      }
    };

    frame = requestAnimationFrame(() => {
      syncAnchorToEmployeeList();
      frame = requestAnimationFrame(syncAnchorToEmployeeList);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [employeesOpen, mode, open, resolveEmployeeListAnchorRect]);

  useEffect(() => {
    if (pendingEmployeeScrollTopRef.current === null) {
      return;
    }

    const scrollTop = pendingEmployeeScrollTopRef.current;
    pendingEmployeeScrollTopRef.current = null;

    requestAnimationFrame(() => {
      if (employeeSelectorListRef.current) {
        employeeSelectorListRef.current.scrollTop = scrollTop;
      }
    });
  }, [selectedEmployeeIds]);

  useEffect(() => {
    const reportCard = ref.current?.closest('.report-card') as HTMLElement | null;

    if (!open || mode !== 'employees' || !reportCard) {
      return undefined;
    }

    const updateExtraSpace = () => {
      const reportCardRect = reportCard.getBoundingClientRect();
      const anchorTop = employeeSelectorAnchorRect?.top ?? ref.current?.getBoundingClientRect().top ?? reportCardRect.top;
      const popoverTop = Math.max(12, anchorTop - reportCardRect.top);
      const desiredBottom = popoverTop + 620 + 24;
      const missingSpace = Math.max(0, desiredBottom - reportCard.clientHeight);

      reportCard.style.setProperty('--employee-selector-extra-space', `${Math.ceil(missingSpace)}px`);
    };

    reportCard.classList.add('has-employee-selector-open');
    updateExtraSpace();
    window.addEventListener('resize', updateExtraSpace);

    return () => {
      reportCard.classList.remove('has-employee-selector-open');
      reportCard.style.removeProperty('--employee-selector-extra-space');
      window.removeEventListener('resize', updateExtraSpace);
    };
  }, [employeeSelectorAnchorRect, mode, open, ref]);

  useEffect(() => {
    if (!open || mode !== 'employees') {
      return undefined;
    }

    const interactiveSelector = [
      'button',
      'a[href]',
      'input',
      'select',
      'textarea',
      '[role="button"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      if (popoverRef.current?.contains(target) || ref.current?.contains(target)) {
        return;
      }

      if (target.closest(interactiveSelector)) {
        onDiscardEmployees?.();
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [mode, onDiscardEmployees, open, ref]);

  const resetEmployeeBrowseState = () => {
    setEmployeeBrowseMode('employees');
    setActiveDepartmentId(null);
    setEmployeeSearch('');
    setShowInactiveEmployees(false);
  };

  const closeEmployeeSelector = (options?: { discard?: boolean }) => {
    if (options?.discard !== false) {
      onDiscardEmployees?.();
    }
    setEmployeeSelectorAnchorRect(null);
    resetEmployeeBrowseState();
    setMode('actions');
    setOpen(false);
  };

  const openActions = () => {
    setMode('actions');
    setEmployeeSelectorAnchorRect(null);
    setOpen((current) => !current);
  };

  const openEmployees = (anchorElement?: HTMLElement) => {
    onOpenEmployeeSelector?.();
    resetEmployeeBrowseState();
    const listRect = resolveEmployeeListAnchorRect();
    setEmployeeSelectorAnchorRect(listRect ?? anchorElement?.getBoundingClientRect() ?? null);
    setMode('employees');
  };

  const toggleEmployeeVisibility = (anchorElement?: HTMLElement) => {
    if (!hasAppliedEmployees) {
      openEmployees(anchorElement);
      return;
    }

    onToggleEmployees();
    setOpen(false);
  };

  const returnToActions = () => {
    onDiscardEmployees?.();
    setEmployeeSelectorAnchorRect(null);
    resetEmployeeBrowseState();
    setMode('actions');
  };

  const setBrowseMode = (nextMode: 'employees' | 'departments') => {
    setEmployeeBrowseMode(nextMode);
    setActiveDepartmentId(null);
    setEmployeeSearch('');
  };

  const selectAllVisibleEmployees = () => {
    if (showDepartmentList) {
      onSelectAllEmployees?.(selectableEmployees.map((employee) => employee.id));
      return;
    }

    onSelectAllEmployees?.(listEmployees.map((employee) => employee.id));
  };

  const toggleEmployeeWithoutScrollJump = (employeeId: string) => {
    pendingEmployeeScrollTopRef.current = employeeSelectorListRef.current?.scrollTop ?? null;
    onToggleEmployee?.(employeeId);
  };

  const applyEmployees = () => {
    // Keep the combined employees + corridor panel open; close only via ×.
    onApplyEmployees?.();
  };

  return (
    <div className={`row-actions-shell ${open ? 'is-open' : ''}`} ref={ref}>
      <TooltipButton
        label="Действия показателя"
        className={`more-menu-button ${open ? 'is-open' : ''}`}
        onClick={openActions}
        ariaPressed={open}
      >
        <MoreVertical size={16} />
      </TooltipButton>
      {open && (
        <FloatingPopover
          anchorRef={ref}
          anchorRect={mode === 'employees' ? employeeSelectorAnchorRect : null}
          popoverRef={popoverRef}
          open={open}
          className={`settings-popover row-actions-popover ${mode === 'employees' ? 'is-employee-selector-popover' : ''}`}
          expectedWidth={mode === 'thresholds' ? 280 : mode === 'employees' ? 920 : 280}
          expectedHeight={mode === 'thresholds' ? 580 : mode === 'employees' ? 620 : 228}
          constrainHeight={mode === 'thresholds'}
          updateOnScroll={mode === 'actions'}
          verticalPlacement={mode === 'employees' ? 'anchor-start' : 'auto'}
          pinLeft={mode === 'employees' ? 290 : undefined}
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
                <div className={`row-action-menu-item row-action-menu-split ${employeesOpen ? 'is-active' : ''}`}>
                  <button
                    className="row-action-menu-main"
                    type="button"
                    onClick={(event) => toggleEmployeeVisibility(event.currentTarget)}
                  >
                    <span>{employeesOpen ? 'Скрыть сотрудников' : 'Показать сотрудников'}</span>
                    {employeesOpen && <Check size={14} />}
                  </button>
                  <button
                    className="row-action-menu-configure"
                    type="button"
                    aria-label="Настроить сотрудников и коридор"
                    title="Настроить сотрудников и коридор"
                    onClick={(event) => openEmployees(event.currentTarget)}
                  >
                    <Settings2 size={14} />
                  </button>
                </div>
              )}
              {showEmployees && hasAppliedEmployees && employeesOpen ? (
                <button
                  className="row-action-menu-item"
                  type="button"
                  onClick={() => {
                    if (employeeChartsExpanded) {
                      onCollapseAllEmployeeCharts?.();
                    } else {
                      onExpandAllEmployeeCharts?.();
                    }
                    setOpen(false);
                  }}
                >
                  <span>
                    {employeeChartsExpanded
                      ? 'Свернуть графики сотрудников'
                      : 'Развернуть графики сотрудников'}
                  </span>
                </button>
              ) : null}
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
                <span>Коридор показателя</span>
              </button>
            </div>
          ) : mode === 'employees' ? (
            <div className="row-employee-selector">
              <div className={`employee-selector-main ${activeDepartment ? 'has-department-title' : ''}`}>
                <div className="row-popover-head">
                  <button
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (employeeBrowseMode === 'departments' && activeDepartment) {
                        setActiveDepartmentId(null);
                        setEmployeeSearch('');
                        return;
                      }
                      returnToActions();
                    }}
                  >
                    Назад
                  </button>
                </div>
                {activeDepartment ? (
                  <div className="employee-selector-department-title" title={activeDepartment.label}>
                    {activeDepartment.label}
                  </div>
                ) : null}
                <input
                  className="employee-selector-search"
                  type="search"
                  placeholder={
                    showDepartmentList
                      ? 'Поиск по отделам'
                      : 'Поиск по сотрудникам'
                  }
                  value={employeeSearch}
                  onChange={(event) => setEmployeeSearch(event.currentTarget.value)}
                />
                <div className="employee-selector-actions">
                  <button
                    type="button"
                    onClick={selectAllVisibleEmployees}
                  >
                    Выбрать всех
                  </button>
                  <button type="button" onClick={onResetEmployees}>
                    Снять выбор
                  </button>
                  <button
                    className="employee-selector-apply"
                    type="button"
                    onClick={applyEmployees}
                  >
                    Применить
                  </button>
                </div>
                <div className="employee-selector-meta">
                  <span>Выбрано: {selectedCount}</span>
                  {hasInactiveEmployees ? (
                    <label className="employee-selector-inactive-toggle">
                      <input
                        type="checkbox"
                        checked={showInactiveEmployees}
                        onChange={(event) => setShowInactiveEmployees(event.currentTarget.checked)}
                      />
                      <span>Неактивные</span>
                    </label>
                  ) : null}
                </div>
                <div className="employee-selector-list" ref={employeeSelectorListRef}>
                  {showDepartmentList ? (
                    filteredDepartments.length > 0 ? (
                      filteredDepartments.map((group) => (
                        <button
                          className="employee-selector-department-option"
                          type="button"
                          key={group.id}
                          onClick={() => {
                            setActiveDepartmentId(group.id);
                            setEmployeeSearch('');
                          }}
                        >
                          <span className="employee-selector-department-option-text">
                            <span className="employee-selector-department-option-name">{group.label}</span>
                            <span className="employee-selector-option-meta">
                              {group.employeeIds.length} сотр.
                            </span>
                          </span>
                          <ChevronRight size={16} />
                        </button>
                      ))
                    ) : (
                      <div className="employee-selector-empty">
                        Отделы не найдены
                      </div>
                    )
                  ) : (
                    <>
                      {listEmployees.map((employee) => {
                        const fullName = getEmployeeFullName(employee);
                        const nameKey = fullName.toLocaleLowerCase('ru-RU');
                        const secondaryLabel = getEmployeeSecondaryLabel(employee, {
                          forceDisambiguation: duplicateNameKeys.has(nameKey),
                        });
                        const badgeLabel = employee.isRobot
                          ? 'Робот'
                          : employee.isTechnical
                            ? 'Техн.'
                            : null;

                        return (
                          <label
                            className={`employee-selector-option ${employee.isRobot || employee.isTechnical ? 'is-robot' : ''}`}
                            key={employee.id}
                            title={secondaryLabel ? `${fullName} · ${secondaryLabel}` : fullName}
                          >
                            <input
                              type="checkbox"
                              checked={selectedEmployeeIds?.has(employee.id) ?? false}
                              onChange={() => toggleEmployeeWithoutScrollJump(employee.id)}
                            />
                            <span className="employee-selector-avatar" aria-hidden="true">
                              {employee.avatarUrl ? (
                                <img src={employee.avatarUrl} alt="" />
                              ) : (
                                getEmployeeInitials(employee)
                              )}
                            </span>
                            <span className="employee-selector-option-text">
                              <span className="employee-selector-option-name">
                                <span>{fullName}</span>
                                {badgeLabel ? (
                                  <em className={`employee-selector-badge ${employee.isRobot ? 'is-robot' : 'is-technical'}`}>
                                    {badgeLabel}
                                  </em>
                                ) : null}
                                {employee.isActive === false ? (
                                  <em className="employee-selector-badge is-inactive">Неактивен</em>
                                ) : null}
                              </span>
                              {secondaryLabel ? (
                                <span className="employee-selector-option-meta">{secondaryLabel}</span>
                              ) : null}
                            </span>
                          </label>
                        );
                      })}
                      {listEmployees.length === 0 && (
                        <div className="employee-selector-empty">
                          Сотрудники не найдены
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="employee-selector-side-tabs" role="tablist" aria-label="Режим списка сотрудников">
                <button
                  className={`employee-selector-side-tab ${employeeBrowseMode === 'employees' ? 'is-active' : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={employeeBrowseMode === 'employees'}
                  title="Все сотрудники"
                  aria-label="Все сотрудники"
                  onClick={() => setBrowseMode('employees')}
                >
                  <Users size={16} />
                </button>
                <button
                  className={`employee-selector-side-tab ${employeeBrowseMode === 'departments' ? 'is-active' : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={employeeBrowseMode === 'departments'}
                  title="Отделы"
                  aria-label="Отделы"
                  onClick={() => setBrowseMode('departments')}
                >
                  <Network size={16} />
                </button>
              </div>
              <aside className="row-employee-corridor-panel" aria-label="Настройка коридоров показателей">
                <div className="row-employee-corridor-head">
                  <p className="row-employee-corridor-title">Настройка коридоров показателей</p>
                  <button
                    className="row-menu-close"
                    type="button"
                    aria-label="Закрыть меню"
                    onClick={() => closeEmployeeSelector()}
                  >
                    <X size={14} />
                  </button>
                </div>
                <ThresholdEditor
                  embedded
                  threshold={employeeThreshold}
                  recommended={employeeRecommendedThreshold}
                  calculationPeriodLabel={calculationPeriodLabel}
                  valueType={valueType}
                  direction={direction}
                  onDirectionChange={onDirectionChange}
                  onApply={onEmployeeThresholdChange}
                  onReset={() => onEmployeeThresholdChange({ upper: '', lower: '', mode: null })}
                />
              </aside>
            </div>
          ) : (
            <div className="row-threshold-fields">
              <ThresholdEditor
                threshold={threshold}
                recommended={recommendedThreshold}
                calculationPeriodLabel={calculationPeriodLabel}
                valueType={valueType}
                direction={direction}
                onDirectionChange={onDirectionChange}
                onApply={onThresholdChange}
                onReset={() => onThresholdChange({ upper: '', lower: '', mode: null })}
                onClose={() => setMode('actions')}
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
  direction = 'none',
}: {
  metric: MetricRow;
  reportData: ReportPoint[];
  threshold?: ThresholdValues;
  /** When set, chart reads these period values instead of point.values[metric.id]. */
  valuesByPeriod?: Record<string, number>;
  direction?: MetricDirection;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || isVisible) {
      return undefined;
    }

    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { root: null, rootMargin: '160px 0px', threshold: 0.01 },
    );

    observer.observe(host);
    return () => observer.disconnect();
  }, [isVisible]);

  return (
    <div className="row-chart-lazy-host" ref={hostRef}>
      {isVisible ? (
        <RowMetricChartContent
          metric={metric}
          reportData={reportData}
          threshold={threshold}
          valuesByPeriod={valuesByPeriod}
          direction={direction}
        />
      ) : (
        <div className="row-chart-lazy-placeholder" aria-hidden="true" />
      )}
    </div>
  );
}

function RowMetricChartContent({
  metric,
  reportData,
  threshold,
  valuesByPeriod,
  direction = 'none',
}: {
  metric: MetricRow;
  reportData: ReportPoint[];
  threshold?: ThresholdValues;
  valuesByPeriod?: Record<string, number>;
  direction?: MetricDirection;
}) {
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const [activePoint, setActivePoint] = useState<ActiveChartPoint | null>(null);
  const readChartPeriodValue = useCallback((periodKey: string) => {
    if (!valuesByPeriod) {
      return undefined;
    }

    const direct = valuesByPeriod[periodKey];
    if (typeof direct === 'number') {
      return direct;
    }

    const normalized = periodKey.slice(0, 10);
    const normalizedDirect = valuesByPeriod[normalized];
    if (typeof normalizedDirect === 'number') {
      return normalizedDirect;
    }

    const matched = Object.entries(valuesByPeriod).find(([key]) => key.slice(0, 10) === normalized);

    return matched?.[1];
  }, [valuesByPeriod]);
  const chartData = useMemo(
    () =>
      reportData.map((point, index) => {
        const raw = valuesByPeriod
          ? readChartPeriodValue(point.key)
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
    [metric.id, readChartPeriodValue, reportData, valuesByPeriod],
  );
  const thresholdValues = useMemo(
    () =>
      [
        parseThreshold(threshold?.upper ?? ''),
        parseThreshold(threshold?.lower ?? ''),
        threshold ? resolveDisplayedThresholdAverage(threshold) : null,
      ].filter((item): item is number => item !== null),
    [threshold],
  );
  const domain = useMemo(
    () => getChartDomain([...chartData.map((point) => point.value), ...thresholdValues]),
    [chartData, thresholdValues],
  );
  const upper = parseThreshold(threshold?.upper ?? '');
  const lower = parseThreshold(threshold?.lower ?? '');
  const average = threshold ? resolveDisplayedThresholdAverage(threshold) : null;
  const activeDataPoint = activePoint ? chartData[activePoint.index] : null;
  const thresholdItems = getAppliedThresholdItems(threshold);
  const tooltipSummary = activeDataPoint
    ? (() => {
        const formattedValue = formatMetricValue(activeDataPoint.value, metric.type);
        const metricLabel = metric.label.toLocaleLowerCase('ru-RU');
        const valuePart = `${formattedValue} ${metricLabel}`;
        const corridorNote = formatChartCorridorTooltipNote(
          activeDataPoint.value,
          threshold,
          direction,
          (bound) => formatMetricValue(bound, metric.type),
        );
        return corridorNote ? `${valuePart}; ${corridorNote}` : valuePart;
      })()
    : undefined;

  return (
    <div className="row-chart-wrap" ref={chartWrapRef}>
      <div className="row-chart-caption" aria-hidden="true">
        <span className="row-chart-caption-title">{metric.label}</span>
        <span className="row-chart-caption-unit">
          {metric.type === 'money' ? 'RUB' : metric.type === 'percent' ? '%' : 'шт.'}
        </span>
      </div>
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
          summary={tooltipSummary}
        />
      )}
    </div>
  );
}

export type ReportDownloadOption = 'excel' | 'pdf' | 'pdf_charts';

export function ReportDownloadMenu({
  disabled = false,
  pdfBusy = false,
  onSelect,
}: {
  disabled?: boolean;
  pdfBusy?: boolean;
  onSelect: (option: ReportDownloadOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false), [popoverRef]);
  const busy = disabled || pdfBusy;

  return (
    <div className={`report-download-shell ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        className="action-button green-button report-download-trigger"
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={busy}
        onClick={() => {
          if (busy) {
            return;
          }
          setOpen((current) => !current);
        }}
      >
        <Download size={17} />
        <span>{pdfBusy ? 'Формируем PDF…' : 'Скачать'}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="settings-popover report-download-popover"
          expectedWidth={280}
          expectedHeight={180}
        >
          <div className="report-download-menu" role="menu" aria-label="Скачать отчёт">
            <button
              type="button"
              role="menuitem"
              className="report-download-option"
              onClick={() => {
                setOpen(false);
                onSelect('excel');
              }}
            >
              <FileSpreadsheet size={16} />
              <span>Excel</span>
              <em>таблица без графиков</em>
            </button>
            <button
              type="button"
              role="menuitem"
              className="report-download-option"
              onClick={() => {
                setOpen(false);
                onSelect('pdf');
              }}
            >
              <FileText size={16} />
              <span>PDF без графиков</span>
              <em>цифры + главный график</em>
            </button>
            <button
              type="button"
              role="menuitem"
              className="report-download-option"
              onClick={() => {
                setOpen(false);
                onSelect('pdf_charts');
              }}
            >
              <FileText size={16} />
              <span>PDF с графиками</span>
              <em>главный + все строки таблицы</em>
            </button>
          </div>
        </FloatingPopover>
      )}
    </div>
  );
}


