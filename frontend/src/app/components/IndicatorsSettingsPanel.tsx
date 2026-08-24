import { useMemo, useRef, useState } from 'react';
import { CalendarClock, X } from 'lucide-react';
import { weekDayOptions } from '../constants';
import type { MetricDirection } from '../config/metricDirections';
import type { Period } from '../../services/report/reportCatalog';
import type {
  ChartDraftSettings,
  ChartMetricMode,
  RecommendedThresholdValues,
  ReportFilters,
  ScheduleFilters,
  SelectOption,
  TableRowChartsMode,
  ThresholdValues,
} from '../types';
import { MultiSelect, ScheduleMenu, ThresholdEditor } from './reportControls';

const ProFeatureBadge = () => (
  <span className="indicators-pro-badge" title="Доступно в PRO">
    PRO
  </span>
);

export type IndicatorsSettingsDraft = {
  chart: ChartDraftSettings;
  tableSelectedSources: string[];
  tableRowChartsMode: TableRowChartsMode;
  hideZeroRows: boolean;
  highlightDeviations: boolean;
  useSumIndicators: boolean;
  customTitle: string;
  saveSetEnabled: boolean;
  saveSetName: string;
};

const formatScheduleSummary = (schedule: ScheduleFilters) => {
  const weekendIds = schedule.weekendDayIds.length > 0
    ? schedule.weekendDayIds
    : [5, 6];
  const weekendLabels = weekendIds
    .map((id) => weekDayOptions.find((day) => day.id === id)?.label)
    .filter(Boolean)
    .join(', ');
  const weekStartLabel =
    weekDayOptions.find((day) => day.id === schedule.calendarWeekStart)?.label ?? 'Пн';
  const workdayHint = weekendIds.length === 2 && weekendIds.includes(5) && weekendIds.includes(6)
    ? 'Пн–Пт'
    : 'Рабочие дни';
  const workdayTime = schedule.workdayStart || schedule.workdayEnd
    ? `${schedule.workdayStart || '00:00'}–${schedule.workdayEnd || '00:00'}`
    : 'весь день';

  return {
    title: `${workdayHint} · неделя с ${weekStartLabel.toLowerCase() === 'пн' ? 'понедельника' : weekStartLabel}`,
    weekends: `Выходные: ${weekendLabels || 'не заданы'} · ${workdayTime}`,
  };
};

const summarizeSelection = (count: number) => {
  if (count <= 0) {
    return 'Не выбрано';
  }
  return `Выбрано: ${count}`;
};

const easeOutCubic = (value: number) => 1 - ((1 - value) ** 3);

const animateScrollTop = (element: HTMLElement, targetTop: number, duration = 420) => {
  const startTop = element.scrollTop;
  const distance = targetTop - startTop;

  if (Math.abs(distance) < 1) {
    element.scrollTop = targetTop;
    return;
  }

  const startTime = window.performance.now();

  const step = (currentTime: number) => {
    const progress = Math.min(1, (currentTime - startTime) / duration);
    element.scrollTop = startTop + distance * easeOutCubic(progress);

    if (progress < 1) {
      window.requestAnimationFrame(step);
    }
  };

  window.requestAnimationFrame(step);
};

export default function IndicatorsSettingsPanel({
  open,
  isProUser,
  period,
  crmSourceOptions,
  mainThreshold,
  mainRecommendedThreshold,
  calculationPeriodLabel,
  mainDirection,
  draft,
  onDraftChange,
  onMainDirectionChange,
  onThresholdApply,
  onThresholdReset,
  onCancel,
  onShowSummary,
  onSaveSet,
  onExpandAllRowCharts,
  onCollapseAllRowCharts,
}: {
  open: boolean;
  isProUser: boolean;
  period: Period;
  crmSourceOptions: SelectOption<string>[];
  mainThreshold: ThresholdValues;
  mainRecommendedThreshold: RecommendedThresholdValues;
  calculationPeriodLabel?: string;
  mainDirection?: MetricDirection;
  draft: IndicatorsSettingsDraft;
  onDraftChange: (next: IndicatorsSettingsDraft) => void;
  onMainDirectionChange?: (direction: MetricDirection) => void;
  onThresholdApply: (value: ThresholdValues) => void;
  onThresholdReset: () => void;
  onCancel: () => void;
  onShowSummary: () => void;
  onSaveSet?: () => void;
  onExpandAllRowCharts?: () => void;
  onCollapseAllRowCharts?: () => void;
}) {
  const [scheduleError, setScheduleError] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const scheduleBlockRef = useRef<HTMLDivElement>(null);
  const menuGroup = 'indicators-settings-panel';
  const scheduleSummary = useMemo(
    () => formatScheduleSummary(draft.chart.schedule),
    [draft.chart.schedule],
  );

  if (!open) {
    return null;
  }

  const updateDraft = (patch: Partial<IndicatorsSettingsDraft>) => {
    onDraftChange({ ...draft, ...patch });
  };

  const updateChart = (patch: Partial<ChartDraftSettings>) => {
    updateDraft({
      chart: {
        ...draft.chart,
        ...patch,
        schedule: patch.schedule
          ? {
              ...patch.schedule,
              weekendDayIds: [...patch.schedule.weekendDayIds],
            }
          : {
              ...draft.chart.schedule,
              weekendDayIds: [...draft.chart.schedule.weekendDayIds],
            },
        selectedSources: patch.selectedSources
          ? [...patch.selectedSources]
          : [...draft.chart.selectedSources],
      },
    });
  };

  const scrollToSchedulePopover = () => {
    window.requestAnimationFrame(() => {
      const body = bodyRef.current;
      const scheduleBlock = scheduleBlockRef.current;

      if (!body || !scheduleBlock) {
        return;
      }

      const bodyRect = body.getBoundingClientRect();
      const blockRect = scheduleBlock.getBoundingClientRect();
      const topPadding = 12;
      const nextScrollTop = body.scrollTop + blockRect.top - bodyRect.top - topPadding;

      animateScrollTop(body, Math.max(0, nextScrollTop));
    });
  };

  const setMetricMode = (metricMode: ChartMetricMode) => {
    updateChart({ metricMode });
  };

  const handleMainSourcesChange = (selectedSources: string[]) => {
    const nextSources = (!isProUser || !draft.useSumIndicators)
      ? selectedSources.slice(-1)
      : [...selectedSources];
    updateChart({
      selectedSources: nextSources,
      chartDisplayMode: 'sum',
    });
  };

  const canUseSum = isProUser;
  const mainSelectionMode = canUseSum && draft.useSumIndicators ? 'multi' : 'single';

  return (
    <div className="indicators-settings-layer" role="presentation">
      <div
        className="indicators-settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="indicators-settings-title"
      >
        <div className="indicators-settings-head">
          <p id="indicators-settings-title">Настроить показатели</p>
          <button
            className="icon-button"
            type="button"
            aria-label="Закрыть настройки показателей"
            onClick={onCancel}
          >
            <X size={18} />
          </button>
        </div>

        <div className="indicators-settings-body" ref={bodyRef}>
          <section className="indicators-settings-section">
            <h3>1. Главный показатель</h3>

            <div className="indicators-settings-block">
              <p className="indicators-settings-label">Что считаем</p>
              <div className="indicators-metric-mode" role="radiogroup" aria-label="Что считаем">
                <button
                  type="button"
                  className={`indicators-metric-mode-option ${draft.chart.metricMode === 'count' ? 'is-active' : ''}`}
                  onClick={() => setMetricMode('count')}
                >
                  <strong>Количество</strong>
                  <span>Число сделок</span>
                </button>
                <button
                  type="button"
                  className={`indicators-metric-mode-option ${draft.chart.metricMode === 'money' ? 'is-active' : ''}`}
                  onClick={() => setMetricMode('money')}
                >
                  <strong>Деньги</strong>
                  <span>Сумма сделок</span>
                </button>
              </div>
            </div>

            <div className={`indicators-paid-row ${canUseSum ? '' : 'is-locked'}`}>
              <div className="indicators-paid-copy">
                <div>
                  <strong className="indicators-paid-title">
                    Использовать сумму показателей
                    <ProFeatureBadge />
                  </strong>
                  <span>
                    {canUseSum
                      ? 'Включите, чтобы выбрать несколько источников в один главный показатель'
                      : 'Доступно в про версии'}
                  </span>
                </div>
              </div>
              <label className="indicators-switch">
                <input
                  type="checkbox"
                  checked={canUseSum ? draft.useSumIndicators : false}
                  disabled={!canUseSum}
                  onChange={(event) => {
                    const useSumIndicators = event.target.checked;
                    const nextSources = useSumIndicators
                      ? [...draft.chart.selectedSources]
                      : draft.chart.selectedSources.slice(0, 1);
                    onDraftChange({
                      ...draft,
                      useSumIndicators,
                      chart: {
                        ...draft.chart,
                        selectedSources: nextSources,
                        chartDisplayMode: 'sum',
                        schedule: {
                          ...draft.chart.schedule,
                          weekendDayIds: [...draft.chart.schedule.weekendDayIds],
                        },
                      },
                    });
                  }}
                />
                <span />
              </label>
            </div>

            <div
              className={`indicators-settings-block indicators-picker-block${
                draft.chart.selectedSources.length === 0 ? ' is-empty' : ''
              }`}
            >
              <p className="indicators-settings-label">
                {mainSelectionMode === 'multi'
                  ? 'Источники главного показателя'
                  : 'Источник главного показателя'}
              </p>
              <MultiSelect
                values={draft.chart.selectedSources}
                options={crmSourceOptions}
                onChange={handleMainSourcesChange}
                selectionMode={mainSelectionMode}
                triggerLabel={summarizeSelection(draft.chart.selectedSources.length)}
                ariaLabel={
                  mainSelectionMode === 'multi'
                    ? 'Источники главного показателя'
                    : 'Источник главного показателя'
                }
                searchPlaceholder="Поиск по источникам"
                menuGroup={menuGroup}
                menuKey="main-sources"
                anchorMenu
                onSelectAll={
                  mainSelectionMode === 'multi'
                    ? () =>
                        handleMainSourcesChange(
                          crmSourceOptions
                            .filter((option) => !option.disabled)
                            .map((option) => option.value),
                        )
                    : undefined
                }
                onReset={() => handleMainSourcesChange([])}
                onApply={() => undefined}
                closeOnApply
              />
              <p className="indicators-settings-hint">
                {mainSelectionMode === 'multi'
                  ? 'Можно выбрать несколько — суммируются в один график. «Применить» закрывает список; в отчёт — через «Показать сводку».'
                  : canUseSum
                    ? 'Сейчас можно выбрать только 1. Чтобы несколько — включите сумму выше.'
                    : 'В бесплатной версии — только 1 источник. «Применить» закрывает список; в отчёт — через «Показать сводку».'}
              </p>
            </div>

            <div className={`indicators-paid-row ${isProUser ? '' : 'is-locked'}`}>
              <div className="indicators-paid-copy">
                <div>
                  <strong className="indicators-paid-title">
                    Название показателя
                    <ProFeatureBadge />
                  </strong>
                  <span>
                    {isProUser
                      ? 'Только отображаемое имя, формула не меняется'
                      : 'Редактирование названия — в про версии'}
                  </span>
                </div>
              </div>
              <input
                className="indicators-title-input"
                type="text"
                value={draft.customTitle}
                disabled={!isProUser}
                placeholder="Например, Продажи · Основной"
                onChange={(event) => updateDraft({ customTitle: event.target.value })}
              />
            </div>

            <div className="indicators-settings-block">
              <p className="indicators-settings-label">Коридор главного показателя</p>
              <ThresholdEditor
                embedded
                threshold={mainThreshold}
                recommended={mainRecommendedThreshold}
                calculationPeriodLabel={calculationPeriodLabel}
                valueType={draft.chart.metricMode}
                direction={mainDirection}
                onDirectionChange={onMainDirectionChange}
                onApply={onThresholdApply}
                onReset={onThresholdReset}
              />
            </div>

            <div className="indicators-settings-block" ref={scheduleBlockRef}>
              <p className="indicators-settings-label">Рабочий календарь</p>
              <div className="indicators-calendar-row">
                <div className="indicators-calendar-summary">
                  <CalendarClock size={18} aria-hidden="true" />
                  <div>
                    <strong>{scheduleSummary.title}</strong>
                    <span>{scheduleSummary.weekends}</span>
                  </div>
                </div>
                <ScheduleMenu
                  schedule={draft.chart.schedule}
                  period={period}
                  onChange={(schedule) => {
                    setScheduleError('');
                    updateChart({ schedule });
                  }}
                  menuGroup={menuGroup}
                  menuKey="schedule"
                  triggerLabel="Изменить"
                  triggerCompact
                  showWorkdayTimeFields
                  popoverHorizontalPlacement="right"
                  onOpen={scrollToSchedulePopover}
                />
              </div>
              {scheduleError ? (
                <em className="threshold-field-error schedule-apply-error">{scheduleError}</em>
              ) : null}
            </div>
          </section>

          <section className="indicators-settings-section">
            <h3>2. Остальные показатели (таблица)</h3>

            <div className="indicators-settings-block">
              <p className="indicators-settings-label">Отображение</p>
              <div className="table-settings-mode-options" role="radiogroup" aria-label="Отображение таблицы">
                <label className={`table-settings-mode-option ${draft.tableRowChartsMode === 'compact' ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="indicators-table-row-charts-mode"
                    checked={draft.tableRowChartsMode === 'compact'}
                    onChange={() => updateDraft({ tableRowChartsMode: 'compact' })}
                  />
                  <span>Компактный</span>
                </label>
                <label className={`table-settings-mode-option ${draft.tableRowChartsMode === 'with_charts' ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="indicators-table-row-charts-mode"
                    checked={draft.tableRowChartsMode === 'with_charts'}
                    onChange={() => updateDraft({ tableRowChartsMode: 'with_charts' })}
                  />
                  <span>С графиками</span>
                </label>
              </div>
              <div className="table-settings-chart-actions">
                <button
                  className="table-settings-chart-button"
                  type="button"
                  disabled={draft.tableRowChartsMode !== 'with_charts'}
                  onClick={() => onExpandAllRowCharts?.()}
                >
                  Развернуть все
                </button>
                <button
                  className="table-settings-chart-button"
                  type="button"
                  disabled={draft.tableRowChartsMode !== 'with_charts'}
                  onClick={() => onCollapseAllRowCharts?.()}
                >
                  Свернуть все
                </button>
              </div>
            </div>

            <div
              className={`indicators-settings-block indicators-picker-block${
                draft.tableSelectedSources.length === 0 ? ' is-empty' : ''
              }`}
            >
              <p className="indicators-settings-label">Выберите показатели</p>
              <MultiSelect
                values={draft.tableSelectedSources}
                options={crmSourceOptions}
                onChange={(tableSelectedSources) => updateDraft({ tableSelectedSources })}
                triggerLabel={summarizeSelection(draft.tableSelectedSources.length)}
                ariaLabel="Показатели таблицы"
                searchPlaceholder="Поиск по источникам и показателям"
                menuGroup={menuGroup}
                menuKey="table-sources"
                anchorMenu
                onSelectAll={() =>
                  updateDraft({
                    tableSelectedSources: crmSourceOptions
                      .filter((option) => !option.disabled)
                      .map((option) => option.value),
                  })
                }
                onReset={() => updateDraft({ tableSelectedSources: [] })}
                onApply={() => undefined}
                closeOnApply
              />
              <p className="indicators-settings-hint">
                Можно выбрать несколько. «Применить» закрывает список; в отчёт — через «Показать сводку».
              </p>
            </div>

            <label className={`table-settings-checkbox ${draft.highlightDeviations ? 'is-active' : ''}`}>
              <input
                type="checkbox"
                checked={draft.highlightDeviations}
                onChange={(event) => updateDraft({ highlightDeviations: event.target.checked })}
              />
              <span>
                <strong>Рассчитать коридоры и подсветить отклонения</strong>
              </span>
            </label>

            <label className={`table-settings-checkbox ${draft.hideZeroRows ? 'is-active' : ''}`}>
              <input
                type="checkbox"
                checked={draft.hideZeroRows}
                onChange={(event) => updateDraft({ hideZeroRows: event.target.checked })}
              />
              <span>
                <strong>Скрыть нулевые показатели</strong>
                <em>Прячет показатели и сотрудников, у которых за весь период только 0 или «—».</em>
              </span>
            </label>
          </section>

          <section className="indicators-settings-section">
            <div className={`indicators-paid-row ${isProUser ? '' : 'is-locked'}`}>
              <div className="indicators-paid-copy">
                <div>
                  <strong className="indicators-paid-title">
                    Сохранить набор
                    <ProFeatureBadge />
                  </strong>
                  <span>{isProUser ? 'Для быстрого повторного запуска' : 'Доступно в про версии'}</span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={isProUser ? draft.saveSetEnabled : false}
                disabled={!isProUser}
                onChange={(event) => updateDraft({ saveSetEnabled: event.target.checked })}
                aria-label="Сохранить набор"
              />
            </div>
            {isProUser && draft.saveSetEnabled ? (
              <label className="field-label indicators-save-name">
                <span>Название набора</span>
                <input
                  type="text"
                  value={draft.saveSetName}
                  placeholder="Продажи · Основной"
                  onChange={(event) => updateDraft({ saveSetName: event.target.value })}
                />
              </label>
            ) : null}
          </section>
        </div>

        <div className="indicators-settings-footer">
          <button className="secondary-button" type="button" onClick={onCancel}>
            Отмена
          </button>
          <div className="indicators-settings-footer-actions">
            {isProUser && draft.saveSetEnabled ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => onSaveSet?.()}
              >
                Сохранить набор
              </button>
            ) : null}
            <button className="primary-button" type="button" onClick={onShowSummary}>
              Показать сводку
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const createIndicatorsSettingsDraft = (input: {
  filters: ReportFilters;
  tableSelectedSources: string[];
  tableRowChartsMode: TableRowChartsMode;
  hideZeroRows: boolean;
  highlightDeviations: boolean;
  customTitle?: string;
}): IndicatorsSettingsDraft => ({
  chart: {
    selectedSources: [...input.filters.selectedSources],
    chartDisplayMode: 'sum',
    metricMode: input.filters.metricMode,
    schedule: {
      ...input.filters.schedule,
      weekendDayIds: [...input.filters.schedule.weekendDayIds],
    },
  },
  tableSelectedSources: [...input.tableSelectedSources],
  tableRowChartsMode: input.tableRowChartsMode,
  hideZeroRows: input.hideZeroRows,
  highlightDeviations: input.highlightDeviations,
  useSumIndicators: input.filters.selectedSources.length > 1,
  customTitle: input.customTitle ?? '',
  saveSetEnabled: false,
  saveSetName: '',
});
