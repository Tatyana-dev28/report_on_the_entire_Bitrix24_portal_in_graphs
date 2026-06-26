import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ChevronDown, Crown, X } from 'lucide-react';
import { formatMetricValue } from '../../services/report/reportCatalog';
import { DETAIL_COLUMN_STORAGE_KEY, detailColumnMinWidthSum, detailColumns } from '../constants';
import type { AppSettings, DetailColumnKey, DetailContext, DetailRow, DetailSort, ReportEmployee } from '../types';
import { TooltipButton, useOutsideClose } from './common';
import { bitrixEntityLabels, openBitrixEntity, openBitrixUser } from '../utils/bitrixNavigation';
import { normalizeDetailColumnWidths, resizeDetailColumnWidths, sumDetailColumnWidths } from '../utils/detailColumns';
import { compareDetailValues } from '../utils/detailRows';
import { loadDetailColumnWidths } from '../storage';
import type { BillingPlan } from '../../services/api/billingApiClient';

export function SaveViewModal({
  value,
  onValueChange,
  onClose,
  onSave,
  title = 'Сохранить отображение',
}: {
  value: string;
  onValueChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
  title?: string;
}) {
  const panelRef = useOutsideClose<HTMLDivElement>(true, onClose);

  return (
    <div className="modal-layer" role="presentation">
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-view-title"
        ref={panelRef}
      >
        <div className="modal-head">
          <p id="save-view-title">{title}</p>
          <button className="icon-button" type="button" aria-label="Закрыть окно" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label className="field-label">
          <span>Название</span>
          <input
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder="Например, отчет продаж"
            autoFocus
          />
        </label>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="primary-button" type="button" onClick={onSave}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmDeleteViewModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const panelRef = useOutsideClose<HTMLDivElement>(true, onCancel);

  return (
    <div className="modal-layer" role="presentation">
      <div className="modal-panel compact-modal-panel" role="dialog" aria-modal="true" ref={panelRef}>
        <div className="modal-head">
          <p>Удалить отображение</p>
          <button className="icon-button" type="button" aria-label="Закрыть окно" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <p className="modal-text">Точно удалить отображение отчета?</p>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            Отмена
          </button>
          <button className="danger-button" type="button" onClick={onConfirm}>
            Удалить
          </button>
        </div>
      </div>
    </div>
  );
}

export function FreeSaveLimitModal({
  onClose,
  onOpenPro,
}: {
  onClose: () => void;
  onOpenPro: () => void;
}) {
  const panelRef = useOutsideClose<HTMLDivElement>(true, onClose);

  return (
    <div className="modal-layer" role="presentation">
      <div className="modal-panel compact-modal-panel" role="dialog" aria-modal="true" ref={panelRef}>
        <div className="modal-head">
          <p>Ограничение бесплатной версии</p>
          <button className="icon-button" type="button" aria-label="Закрыть окно" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className="modal-text">В бесплатной версии возможно сохранить только одно отображение отчета.</p>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="primary-button" type="button" onClick={onOpenPro}>
            Активировать ПРО версию
          </button>
        </div>
      </div>
    </div>
  );
}

const formatPlanPrice = (plan: BillingPlan | null) => {
  if (!plan) {
    return 'ПРО на месяц';
  }

  const price = Number(plan.price);

  if (!Number.isFinite(price)) {
    return 'ПРО на месяц';
  }

  return `${new Intl.NumberFormat('ru-RU').format(price)} ${plan.currency} / месяц`;
};

export function ProVersionModal({
  onClose,
  onSubscribe,
  isLoading,
  plan,
  error,
}: {
  onClose: () => void;
  onSubscribe: () => void;
  isLoading: boolean;
  plan: BillingPlan | null;
  error: string;
}) {
  return (
    <div className="modal-layer pro-modal-layer" role="presentation">
      <div
        className="modal-panel pro-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pro-modal-title"
      >
        <div className="modal-head">
          <div>
            <p id="pro-modal-title">ПРО версия</p>
            <span>Месячная подписка для команд, которым нужно сохранять настройки и работать с доступами.</span>
          </div>
          <button className="icon-button" type="button" aria-label="Закрыть окно" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="pro-modal-body">
          <div className="pro-modal-intro">
            <span className="pro-badge">
              <Crown size={15} />
              Доступ для портала
            </span>
            <p>
              Сейчас приложение работает по простой логике: при установке портал получает бесплатный доступ,
              а расширенные возможности включаются через месячную ПРО подписку.
            </p>
          </div>

          <div className="pro-plan-grid">
            <section className="pro-plan-card">
              <div className="pro-plan-head">
                <span>Текущий стартовый доступ</span>
                <h3>Бесплатно</h3>
                <p>Подходит, чтобы построить отчет и проверить работу приложения на реальных данных.</p>
              </div>
              <ul>
                <li>Построение отчета по данным Bitrix24.</li>
                <li>Просмотр графиков, таблицы сотрудников и детализации.</li>
                <li>Экспорт отчета в Excel и PDF.</li>
                <li>Без сохранения нескольких отображений и расширенных настроек доступа.</li>
              </ul>
            </section>

            <section className="pro-plan-card is-featured">
              <div className="pro-plan-head">
                <span>Расширенный доступ</span>
                <h3>{formatPlanPrice(plan)}</h3>
                <p>Для регулярной работы команды с сохраненными настройками отчета.</p>
              </div>
              <ul>
                <li>Сохранение нескольких отображений отчета.</li>
                <li>Сохранение настроек и фильтров для сотрудников портала.</li>
                <li>Настройка прав: кто строит отчеты, видит деньги и сохраняет отображения.</li>
                <li>Месячный срок доступа с управлением через админку.</li>
              </ul>
            </section>
          </div>

          <div className="pro-admin-note">
            <p>Подписка подключается на весь портал.</p>
            <span>
              После подключения команда сможет пользоваться расширенными настройками без повторной настройки отчета.
            </span>
          </div>
          {error && (
            <p className="modal-error-text" role="alert">
              {error}
            </p>
          )}

          <div className="pro-modal-actions">
            <button className="secondary-button" type="button" onClick={onClose}>
              Не сейчас
            </button>
            <button className="primary-button" type="button" onClick={onSubscribe} disabled={isLoading}>
              {isLoading ? 'Создаем платеж...' : 'Подключить подписку'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function InstructionModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-layer instruction-modal-layer" role="presentation">
      <div className="modal-panel instruction-modal-panel" role="dialog" aria-modal="true">
        <div className="modal-head">
          <p>Инструкция</p>
          <button className="icon-button" type="button" aria-label="Закрыть окно" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="instruction-content">
          <nav className="instruction-nav" aria-label="Разделы инструкции">
            <a href="#instruction-about">Что делает приложение</a>
            <a href="#instruction-build">Как построить отчет</a>
            <a href="#instruction-crm">Почему у всех разные воронки</a>
            <a href="#instruction-chart">Как читать график</a>
            <a href="#instruction-thresholds">Пороговые значения</a>
            <a href="#instruction-table">Как пользоваться таблицей</a>
            <a href="#instruction-settings">Настройка таблицы</a>
            <a href="#instruction-views">Сохраненные отображения</a>
            <a href="#instruction-export">Excel Рё PDF</a>
            <a href="#instruction-pro">ПРО версия</a>
            <a href="#instruction-faq">Частые вопросы</a>
          </nav>

          <section className="instruction-section" id="instruction-about">
            <h2>Что делает приложение</h2>
            <p>
              Приложение помогает смотреть показатели Битрикс24 в графиках и таблицах. Вы выбираете период,
              CRM-разделы и нужный вид расчета, а приложение показывает динамику по датам.
            </p>
            <p>
              Отчет можно скачать в Excel или PDF. Также можно сохранить удобные варианты отображения отчета,
              чтобы быстро возвращаться к ним позже.
            </p>
            <div className="instruction-demo demo-toolbar">
              <span className="demo-select">Общий отчет</span>
              <span className="demo-button demo-blue">Построить отчет</span>
              <span className="demo-button demo-green">Скачать Excel</span>
              <span className="demo-button demo-purple">Скачать PDF</span>
            </div>
          </section>

          <section className="instruction-section" id="instruction-build">
            <h2>Как построить отчет</h2>
            <ol>
              <li>Выберите период в верхней панели.</li>
              <li>Нажмите кнопку <b>Настроить график</b>.</li>
              <li>Выберите нужные воронки, лиды, счета или смарт-процессы.</li>
              <li>Выберите, что считать: деньги или количество.</li>
              <li>Нажмите <b>Применить</b>.</li>
              <li>Нажмите <b>Построить отчет</b>.</li>
            </ol>
            <div className="instruction-demo demo-card">
              <span className="demo-button demo-soft">Настроить график</span>
              <span className="demo-select">Воронка продажи</span>
              <span className="demo-select">Кол-во денег</span>
              <span className="demo-button demo-blue">Применить</span>
            </div>
          </section>

          <section className="instruction-section" id="instruction-crm">
            <h2>Почему у всех разные воронки</h2>
            <p>
              Приложение берет разделы CRM из вашего портала Битрикс24. Поэтому названия могут отличаться от
              примеров в инструкции. У одного портала может быть воронка <b>Продажи</b>, у другого — <b>Производство</b>.
            </p>
            <p>
              Лиды и смарт-процессы тоже могут называться по-разному. Это нормально: выбирайте те разделы,
              которые нужны именно вашему отчету.
            </p>
          </section>

          <section className="instruction-section" id="instruction-chart">
            <h2>Как читать главный график</h2>
            <p>
              Точки на графике показывают значения по датам или периодам. Наведите курсор на точку, чтобы увидеть
              подсказку с датой и суммой. Линия тренда помогает понять, растут показатели или снижаются.
            </p>
            <div className="instruction-demo demo-chart">
              <span className="demo-chart-line" />
              <span className="demo-dot demo-dot-one" />
              <span className="demo-dot demo-dot-two" />
              <span className="demo-dot demo-dot-three" />
              <span className="demo-tooltip">15 мая · 840 000 ₽</span>
            </div>
          </section>

          <section className="instruction-section" id="instruction-thresholds">
            <h2>Пороговые значения</h2>
            <p>
              Верхнее значение показывает хороший результат. Нижнее значение помогает быстро увидеть слабые места.
              Среднее значение находится между ними. Значения можно ввести вручную или применить рекомендованные.
            </p>
            <p>
              Рекомендованные значения считаются автоматически по данным текущего графика или строки таблицы.
            </p>
            <div className="instruction-demo demo-thresholds">
              <div>
                <span>Ручные значения</span>
                <i>Верхнее значение</i>
                <i>Нижнее значение</i>
                <i>Среднее значение</i>
                <b>Применить</b>
              </div>
              <div>
                <span>Рекомендованные</span>
                <i>Рекомендованное верхнее</i>
                <i>Рекомендованное нижнее</i>
                <i>Рекомендованное среднее</i>
                <b className="demo-green-text">Применить</b>
              </div>
            </div>
          </section>

          <section className="instruction-section" id="instruction-table">
            <h2>Как пользоваться таблицей</h2>
            <p>
              Слева находится список показателей, справа — значения по датам. Через меню с тремя точками можно
              показать сотрудников, раскрыть график строки или настроить пороги.
            </p>
            <p>
              Нажмите на цифру, чтобы открыть детализацию. Если значение обрезано, наведите курсор — появится
              подсказка с полным значением.
            </p>
            <div className="instruction-demo demo-table-row">
              <span>Сумма успешных сделок</span>
              <b>812 000 ₽</b>
              <b>940 000 ₽</b>
              <button type="button" aria-label="Меню строки">⋮</button>
            </div>
          </section>

          <section className="instruction-section" id="instruction-settings">
            <h2>Настройка таблицы</h2>
            <p>
              В настройке таблицы можно скрыть лишние разделы. В настройке показателей раздела можно оставить
              только нужные строки. Скрытые показатели не попадут в Excel.
            </p>
            <p>
              Кнопка <b>Выбрать все</b> включает все пункты. Кнопка <b>Сбросить</b> очищает выбор.
            </p>
            <div className="instruction-demo demo-card">
              <span className="demo-button demo-soft">Настройка таблицы</span>
              <span className="demo-pill">Выбрать все</span>
              <span className="demo-pill">Сбросить</span>
              <span className="demo-check">✓ Сделки</span>
              <span className="demo-check">✓ Лиды</span>
            </div>
          </section>

          <section className="instruction-section" id="instruction-views">
            <h2>Сохраненные отображения</h2>
            <p>
              Если вы часто смотрите отчет в одном и том же виде, сохраните отображение. В бесплатной версии можно
              сохранить одно отображение. В ПРО версии можно сохранять много вариантов.
            </p>
            <p>
              Чтобы переименовать или удалить отображение, откройте поле <b>Общий отчет</b> и нажмите три точки
              рядом с сохраненным названием.
            </p>
            <div className="instruction-demo demo-card">
              <span className="demo-select">Общий отчет</span>
              <span className="demo-select">Продажи за месяц · ⋮</span>
              <span className="demo-menu-item">Редактировать</span>
              <span className="demo-menu-item">Удалить</span>
            </div>
          </section>

          <section className="instruction-section" id="instruction-export">
            <h2>Excel Рё PDF</h2>
            <p>
              Excel выгружает таблицу с видимыми разделами и показателями. Если вы скрыли раздел или показатель,
              он не попадет в файл.
            </p>
            <p>
              PDF выгружает визуальный отчет: верхнюю панель, главный график и таблицу. Если таблица большая,
              PDF должен включить ее полностью.
            </p>
          </section>

          <section className="instruction-section" id="instruction-pro">
            <h2>ПРО версия</h2>
            <p>
              ПРО версия позволит сохранять много вариантов отображений отчета. Позже здесь появятся права
              сотрудников на разные показатели и дополнительные настройки доступа.
            </p>
          </section>

          <section className="instruction-section" id="instruction-faq">
            <h2>Частые вопросы</h2>
            <h3>Почему я не вижу нужную воронку?</h3>
            <p>Проверьте, есть ли эта воронка в вашем Битрикс24 и доступна ли она вашему пользователю.</p>
            <h3>Почему названия отличаются от инструкции?</h3>
            <p>Инструкция показывает примеры. В вашем портале воронки, лиды и смарт-процессы могут называться иначе.</p>
            <h3>Почему отчет пустой?</h3>
            <p>Сначала выберите настройки и нажмите <b>Построить отчет</b>. Также проверьте выбранный период.</p>
            <h3>Как скачать отчет?</h3>
            <p>Нажмите <b>Скачать Excel</b> для таблицы или <b>Скачать PDF</b> для визуального отчета.</p>
            <h3>Как открыть детализацию?</h3>
            <p>Нажмите на любую цифру в таблице. Откроется окно со списком элементов.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

const employeeDisplayName = (employee: ReportEmployee) =>
  employee.name || `${employee.firstName} ${employee.lastName}`.trim() || `Сотрудник ${employee.id}`;

export function EmployeeMultiSelect({
  label,
  employees,
  selectedIds,
  onChange,
}: {
  label: string;
  employees: ReportEmployee[];
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false), [], { closeOnScroll: false });
  const selectedEmployees = employees.filter((employee) => selectedIds.includes(employee.id));
  const selectedUnknownIds = selectedIds.filter(
    (employeeId) => !employees.some((employee) => employee.id === employeeId),
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filteredEmployees = employees.filter((employee) => {
    const name = employeeDisplayName(employee).toLowerCase();

    if (!normalizedQuery) {
      return true;
    }

    return name.startsWith(normalizedQuery) || employee.id.toLowerCase().startsWith(normalizedQuery);
  });

  const toggleEmployee = (employeeId: string) => {
    onChange(
      selectedIds.includes(employeeId)
        ? selectedIds.filter((id) => id !== employeeId)
        : [...selectedIds, employeeId],
    );
  };

  return (
    <div className={`employee-multi-field ${open ? 'is-open' : ''}`} ref={ref}>
      <span>{label}</span>
      <button
        className="employee-multi-trigger"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="employee-chip-list">
          {selectedEmployees.length || selectedUnknownIds.length ? (
            <>
              {selectedEmployees.map((employee) => (
                <span className="employee-chip" key={employee.id}>
                  {employeeDisplayName(employee)}
                </span>
              ))}
              {selectedUnknownIds.map((employeeId) => (
                <span className="employee-chip" key={employeeId}>
                  Сотрудник {employeeId}
                </span>
              ))}
            </>
          ) : (
            <span className="employee-placeholder">Не выбрано</span>
          )}
        </span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="employee-multi-popover">
          <div className="employee-multi-head">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск сотрудника"
            />
            <button className="row-menu-close" type="button" aria-label="Закрыть список" onClick={() => setOpen(false)}>
              <X size={14} />
            </button>
          </div>
          <div className="employee-multi-list">
            {filteredEmployees.length ? (
              filteredEmployees.map((employee) => (
                <label className="employee-multi-option" key={employee.id}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(employee.id)}
                    onChange={() => toggleEmployee(employee.id)}
                  />
                  <span>{employeeDisplayName(employee)}</span>
                </label>
              ))
            ) : (
              <div className="employee-multi-empty">
                Сотрудники появятся после построения отчета по данным Bitrix24.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
export function AppSettingsModal({
  settings,
  employees,
  onSave,
  onClose,
  onOpenPro,
}: {
  settings: AppSettings;
  employees: ReportEmployee[];
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
  onOpenPro: () => void;
}) {
  const [draftSettings, setDraftSettings] = useState<AppSettings>(() => ({
    reportBuilderUserIds: [...settings.reportBuilderUserIds],
    moneyViewerUserIds: [...settings.moneyViewerUserIds],
    viewSaverUserIds: [...settings.viewSaverUserIds],
  }));

  const updateField = (field: keyof AppSettings, values: string[]) => {
    setDraftSettings((current) => ({
      ...current,
      [field]: values,
    }));
  };

  return (
    <div className="modal-layer app-settings-modal-layer" role="presentation">
      <div className="modal-panel app-settings-modal-panel" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <p>Настройки приложения</p>
            <span>Настраивать приложение может только администратор портала.</span>
          </div>
          <button className="icon-button" type="button" aria-label="Закрыть окно" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className="modal-text">
          Настройки возможны при активной подписке{' '}
          <button className="pro-inline-link" type="button" onClick={onOpenPro}>
            ПРО версии
          </button>.
        </p>
        <div className="app-settings-fields">
          <EmployeeMultiSelect
            label="Сотрудники, которым разрешено строить отчеты:"
            employees={employees}
            selectedIds={draftSettings.reportBuilderUserIds}
            onChange={(values) => updateField('reportBuilderUserIds', values)}
          />
          <EmployeeMultiSelect
            label="Сотрудники, которым разрешено видеть показатели с деньгами:"
            employees={employees}
            selectedIds={draftSettings.moneyViewerUserIds}
            onChange={(values) => updateField('moneyViewerUserIds', values)}
          />
          <EmployeeMultiSelect
            label="Сотрудники, которым разрешено сохранять отображения отчета:"
            employees={employees}
            selectedIds={draftSettings.viewSaverUserIds}
            onChange={(values) => updateField('viewSaverUserIds', values)}
          />
        </div>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="primary-button" type="button" onClick={() => onSave(draftSettings)}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

export function DetailModal({
  context,
  rows: backendRows,
  onClose,
}: {
  context: DetailContext;
  rows?: DetailRow[];
  onClose: () => void;
}) {
  const [sort, setSort] = useState<DetailSort>({ key: 'rowNumber', direction: 'asc' });
  const [columnWidths, setColumnWidths] = useState<Record<DetailColumnKey, number>>(
    () => loadDetailColumnWidths(),
  );
  const resizeStateRef = useRef<{
    key: DetailColumnKey;
    startX: number;
    startWidths: Record<DetailColumnKey, number>;
    containerWidth: number;
  } | null>(null);
  const detailTableWrapRef = useRef<HTMLDivElement>(null);
  const [detailTableViewportWidth, setDetailTableViewportWidth] = useState(0);
  const rows = useMemo(() => backendRows ?? [], [backendRows]);
  const hasRows = rows.length > 0;
  const sortedRows = useMemo(() => {
    const nextRows = [...rows].sort((a, b) => compareDetailValues(a, b, sort.key));

    return sort.direction === 'asc' ? nextRows : nextRows.reverse();
  }, [rows, sort]);
  const detailColumnWidthSum = useMemo(
    () => detailColumns.reduce((sum, column) => sum + columnWidths[column.key], 0),
    [columnWidths],
  );
  const detailTableWidth =
    detailTableViewportWidth > 0
      ? Math.max(detailColumnMinWidthSum, detailTableViewportWidth)
      : detailColumnWidthSum;
  const detailFillerWidth = Math.max(0, detailTableWidth - detailColumnWidthSum);
  const detailTableStyle = useMemo<CSSProperties>(
    () => ({
      gridTemplateColumns: [
        ...detailColumns.map((column) => `${columnWidths[column.key]}px`),
        `${detailFillerWidth}px`,
      ].join(' '),
      width: `${detailTableWidth}px`,
      minWidth: '100%',
    }),
    [columnWidths, detailFillerWidth, detailTableWidth],
  );

  useEffect(() => {
    if (!hasRows) {
      return undefined;
    }

    const node = detailTableWrapRef.current;

    if (!node) {
      return undefined;
    }

    const update = () => {
      setDetailTableViewportWidth(Math.floor(node.clientWidth));
    };

    update();
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;

    resizeObserver?.observe(node);
    window.addEventListener('resize', update);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [hasRows]);

  useEffect(() => {
    if (detailTableViewportWidth <= 0) {
      return;
    }

    setColumnWidths((current) => {
      const normalized = normalizeDetailColumnWidths(current, detailTableViewportWidth);
      return sumDetailColumnWidths(normalized) === sumDetailColumnWidths(current) &&
        detailColumns.every((column) => normalized[column.key] === current[column.key])
        ? current
        : normalized;
    });
  }, [detailTableViewportWidth]);

  useEffect(() => {
    if (detailTableViewportWidth <= 0 || typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(DETAIL_COLUMN_STORAGE_KEY, JSON.stringify(columnWidths));
    } catch {
      // localStorage может быть недоступен в приватном режиме, resize при этом должен работать.
    }
  }, [columnWidths, detailTableViewportWidth]);

  useEffect(
    () => () => {
      document.body.classList.remove('is-detail-resizing');
    },
    [],
  );

  const toggleSort = (key: DetailColumnKey) => {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const startColumnResize = (
    column: { key: DetailColumnKey; minWidth: number },
    event: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    resizeStateRef.current = {
      key: column.key,
      startX: event.clientX,
      startWidths: normalizeDetailColumnWidths(columnWidths, detailTableViewportWidth),
      containerWidth: detailTableViewportWidth,
    };
    document.body.classList.add('is-detail-resizing');

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const state = resizeStateRef.current;

      if (!state) {
        return;
      }

      const nextWidths = resizeDetailColumnWidths(
        state.startWidths,
        state.key,
        moveEvent.clientX - state.startX,
        state.containerWidth,
      );

      setColumnWidths(nextWidths);
    };

    const handlePointerUp = () => {
      resizeStateRef.current = null;
      document.body.classList.remove('is-detail-resizing');
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  return (
    <div
      className="detail-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <div className="detail-head">
          <div>
            <p id="detail-title">Детализация: {context.metric.label}</p>
            <span>
              {context.point.label} · {formatMetricValue(context.value, context.metric.type)} · {bitrixEntityLabels[context.entityType]}
              {context.employee ? ` · ${context.employee.firstName} ${context.employee.lastName}` : ''}
            </span>
          </div>
          <button className="icon-button" type="button" aria-label="Закрыть детализацию" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {hasRows ? (
          <div className="details-table-scroll detail-table-wrap" ref={detailTableWrapRef}>
            <div className="detail-table" role="table" style={detailTableStyle}>
            {detailColumns.map((column) => (
              <button
                className="detail-header-cell"
                type="button"
                role="columnheader"
                key={column.key}
                onClick={() => toggleSort(column.key)}
              >
                <span>{column.label}</span>
                {sort.key === column.key && (
                  <span className="sort-indicator">{sort.direction === 'asc' ? '↑' : '↓'}</span>
                )}
                <span
                  className="column-resizer"
                  role="separator"
                  aria-label={`Изменить ширину: ${column.label}`}
                  onPointerDown={(event) => startColumnResize(column, event)}
                />
              </button>
            ))}
            <div className="detail-filler-cell detail-header-filler" aria-hidden="true" />

            {sortedRows.map((row) => (
              <div className="detail-row-contents" role="row" key={row.entityId}>
                <div className="detail-cell">{row.rowNumber}</div>
                <button
                  className="detail-cell detail-action-cell"
                  type="button"
                  onClick={() => openBitrixEntity(row.entityType, row.entityId)}
                >
                  {row.entityId}
                </button>
                <button
                  className="detail-cell detail-action-cell detail-title-cell"
                  type="button"
                  onClick={() => openBitrixEntity(row.entityType, row.entityId)}
                >
                  {row.title}
                </button>
                <button
                  className="detail-cell detail-action-cell"
                  type="button"
                  onClick={() => openBitrixUser(row.responsibleId)}
                >
                  {row.responsibleName}
                </button>
                <div className="detail-cell">{row.createdAt}</div>
                <div className="detail-filler-cell" aria-hidden="true" />
              </div>
            ))}
            </div>
          </div>
        ) : (
          <div className="detail-empty-state">
            <p>По этому значению нет строк для просмотра</p>
            <span>Сейчас здесь нечего раскрывать: за выбранный период и показатель нет отдельных CRM-элементов. Если значение больше нуля, нажмите на него в таблице отчета.</span>
          </div>
        )}
      </section>
    </div>
  );
}

