import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { CheckCircle2, ChevronDown, Download, FileText, X } from 'lucide-react';
import ExcelJS from 'exceljs';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { formatMetricValue } from '../../services/report/reportCatalog';
import { defaultDetailColumnWidths, detailColumnMinWidthSum, detailColumns } from '../constants';
import type { AppSettings, DetailColumnKey, DetailContext, DetailRow, DetailSort, ReportEmployee } from '../types';
import { TooltipButton, useOutsideClose } from './common';
import { getBitrixDetailRowPath, openBitrixDetailRow, openBitrixUser } from '../utils/bitrixNavigation';
import { normalizeDetailColumnWidths, resizeDetailColumnWidths, sumDetailColumnWidths } from '../utils/detailColumns';
import { compareDetailValues, formatDetailContextSummary } from '../utils/detailRows';
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
  const price = Number(plan?.price);
  const normalizedPrice = Number.isFinite(price) ? price : 0;
  const currency = plan?.currency || 'RUB';
  const [integerPart, fractionPart] = normalizedPrice.toFixed(2).split('.');
  const formattedIntegerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  return `${formattedIntegerPart}.${fractionPart} ${currency} / месяц`;
};

const formatAccessUntil = (validUntil: string | null, isLifetime: boolean) => {
  if (isLifetime) {
    return 'Доступ подключен бессрочно.';
  }

  if (!validUntil) {
    return 'Доступ активен для этого портала.';
  }

  const date = new Date(validUntil);

  if (Number.isNaN(date.getTime())) {
    return 'Доступ активен для этого портала.';
  }

  return `Доступ действует до ${new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date)}.`;
};

const getPlanUsersLabel = (plan: BillingPlan) => {
  const users = plan.limits?.users;

  if (typeof users !== 'number' || users <= 0) {
    return '';
  }

  return `${new Intl.NumberFormat('ru-RU').format(users)} пользователей`;
};

const getPlanMetaLabel = (plan: BillingPlan) => {
  const bitrixVersion = typeof plan.limits?.bitrix_version === 'string' ? plan.limits.bitrix_version : '';
  const usersLabel = getPlanUsersLabel(plan);
  const parts = [];

  if (bitrixVersion === 'cloud') {
    parts.push('Облачная версия Битрикс24');
  } else if (bitrixVersion === 'box') {
    parts.push('Коробочная версия Битрикс24');
  }

  if (usersLabel) {
    parts.push(usersLabel);
  }

  return parts.join(' · ');
};

export function ProVersionModal({
  onClose,
  onSubscribe,
  isLoading,
  isBillingLoading,
  hasBillingLoadFailed,
  plans,
  hasPro,
  validUntil,
  isLifetime,
  error,
  customerEmail,
  onCustomerEmailChange,
}: {
  onClose: () => void;
  onSubscribe: () => void;
  isLoading: boolean;
  isBillingLoading: boolean;
  hasBillingLoadFailed: boolean;
  plans: BillingPlan[];
  hasPro: boolean;
  validUntil: string | null;
  isLifetime: boolean;
  error: string;
  customerEmail: string;
  onCustomerEmailChange: (value: string) => void;
}) {
  const accessUntilText = formatAccessUntil(validUntil, isLifetime);
  const paidPlans = useMemo(
    () => plans.filter((item) => item.billingPeriod !== 'free' && item.code !== 'free'),
    [plans],
  );
  const paidPlan = paidPlans[0] ?? null;
  const canShowPlans = !isBillingLoading && !hasBillingLoadFailed;
  const fallbackMessage = error || 'Не удалось загрузить платные тарифы. Попробуйте открыть приложение заново или напишите нам.';
  const shouldShowFallbackCard = isBillingLoading || hasBillingLoadFailed || (canShowPlans && !paidPlan);

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
            {hasPro && (
              <div className="pro-active-status" role="status">
                <CheckCircle2 size={18} />
                <div>
                  <p>Оплата получена, PRO-доступ включен.</p>
                  <span>{accessUntilText}</span>
                </div>
              </div>
            )}
          </div>

          <section className="pro-tariff-section">
            <div className="pro-tariff-section-head">
              <h3>Доступные тарифы</h3>
            </div>
            <div className="pro-plan-grid">
              <section className="pro-plan-card pro-plan-card-free">
                <div className="pro-plan-content">
                  <div className="pro-plan-head">
                    <h3>Бесплатный тариф</h3>
                  </div>
                  <p className="pro-plan-description">
                    В бесплатном тарифе не сохраняются выставленные настройки и фильтры. При выходе из приложения параметры будут сбрасываться.
                  </p>
                </div>
                <div className="pro-plan-footer">
                  <strong>0.00 RUB / месяц</strong>
                  <button className="pro-plan-action pro-plan-action-free" type="button" onClick={onClose}>
                    {hasPro ? 'Текущий тариф' : 'Остаться бесплатно'}
                  </button>
                </div>
              </section>

              {paidPlan && canShowPlans && (
                <section className="pro-plan-card pro-plan-card-paid">
                  <div className="pro-plan-content">
                    <div className="pro-plan-head">
                      <h3>{paidPlan.name}</h3>
                      {getPlanMetaLabel(paidPlan) && <span>{getPlanMetaLabel(paidPlan)}</span>}
                    </div>
                    <p className="pro-plan-description">
                      Этот тариф позволяет сохранять настройки и фильтры после выхода из приложения.
                    </p>
                  </div>
                  <div className="pro-plan-footer">
                    <strong>{formatPlanPrice(paidPlan)}</strong>
                    {!hasPro && (
                      <label className="pro-email-field">
                        <span>Email для чека</span>
                        <input
                          type="email"
                          value={customerEmail}
                          onChange={(event) => onCustomerEmailChange(event.target.value)}
                          placeholder="billing@example.com"
                          autoComplete="email"
                          required
                        />
                      </label>
                    )}
                    <button
                      className="pro-plan-action pro-plan-action-paid"
                      type="button"
                      onClick={onSubscribe}
                      disabled={isLoading || hasPro}
                    >
                      {hasPro ? 'Подключено' : 'Купить'}
                    </button>
                  </div>
                </section>
              )}

              {shouldShowFallbackCard && (
                <section className="pro-plan-card pro-plan-card-fallback" role={hasBillingLoadFailed ? 'alert' : 'status'}>
                  <div className="pro-plan-content">
                    <div className="pro-plan-head">
                      <h3>{isBillingLoading ? 'Загрузка тарифа' : 'Тариф не определён'}</h3>
                    </div>
                    <p className="pro-plan-description">
                      {isBillingLoading ? 'Подбираем подходящий платный тариф для вашего портала.' : 'Платный тариф временно недоступен.'}
                    </p>
                  </div>
                  {!isBillingLoading && (
                    <div className="pro-plan-footer">
                      <strong>{fallbackMessage}</strong>
                    </div>
                  )}
                </section>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export function InstructionModal({
  onClose,
  onStartTips,
}: {
  onClose: () => void;
  onStartTips?: () => void;
}) {
  return (
    <div className="modal-layer instruction-modal-layer" role="presentation">
      <div className="modal-panel instruction-modal-panel" role="dialog" aria-modal="true" aria-label="Как читать отчёт">
        <div className="modal-head">
          <p>Как читать отчёт</p>
          <button className="icon-button" type="button" aria-label="Закрыть окно" title="Закрыть" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="instruction-content">
          <nav className="instruction-nav" aria-label="Разделы инструкции">
            <a href="#instruction-tips">Короткие подсказки</a>
            <a href="#instruction-about">Что делает приложение</a>
            <a href="#instruction-build">Как построить отчет</a>
            <a href="#instruction-crm">Почему у всех разные воронки</a>
            <a href="#instruction-chart">Как читать график</a>
            <a href="#instruction-thresholds">Коридор показателя</a>
            <a href="#instruction-table">Как пользоваться таблицей</a>
            <a href="#instruction-settings">Выбрать показатели</a>
            <a href="#instruction-views">Сохраненные отображения</a>
            <a href="#instruction-export">Excel и PDF</a>
            <a href="#instruction-pro">ПРО версия</a>
            <a href="#instruction-faq">Частые вопросы</a>
          </nav>

          <section className="instruction-section" id="instruction-tips">
            <h2>Короткие подсказки</h2>
            <p>
              Три шага помогают быстро понять отчёт: главный показатель, коридор с цветами и клик по числу
              для детализации. Подсказки показываются один раз после первого построения и не перекрывают данные.
            </p>
            <ol>
              <li><b>Главный показатель</b> — ключевая линия графика за выбранный период.</li>
              <li><b>Коридор и цвета</b> — границы нормы и подсветка отклонений по направлению показателя.</li>
              <li>
                <b>Клик по числу</b> — откроет звонки, лиды или сделки, из которых сформировано значение.
              </li>
            </ol>
            {onStartTips && (
              <div className="instruction-demo demo-card">
                <button
                  className="demo-button demo-blue"
                  type="button"
                  onClick={() => {
                    onClose();
                    onStartTips();
                  }}
                >
                  Показать короткие подсказки
                </button>
              </div>
            )}
          </section>

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
              <span className="demo-select">Обзор бизнеса</span>
              <span className="demo-button demo-blue">Построить отчёт</span>
              <span className="demo-button demo-green">Скачать Excel</span>
              <span className="demo-button demo-purple">Скачать PDF</span>
            </div>
          </section>

          <section className="instruction-section" id="instruction-build">
            <h2>Как построить отчёт</h2>
            <ol>
              <li>Выберите период в верхней панели.</li>
              <li>Нажмите кнопку <b>Выбрать главный показатель</b>.</li>
              <li>Выберите нужные воронки, лиды, счета или смарт-процессы.</li>
              <li>Выберите, что считать: деньги или количество.</li>
              <li>Нажмите <b>Применить</b>.</li>
              <li>
                При необходимости включите переключатели:
                <b> Подобрать показатели автоматически</b> и/или
                <b> Рассчитать коридоры и подсветить отклонения</b>.
              </li>
              <li>Нажмите <b>Построить отчёт</b>.</li>
            </ol>
            <p>
              Переключатели независимы: автоподбор меняет только состав показателей,
              расчёт коридоров — только границы и подсветку отклонений.
            </p>
            <p>
              Если включён автоподбор, система сама выбирает доступный главный показатель
              и штатные строки, строит отчёт и показывает короткое сообщение: сколько показателей
              найдено, какой выбран главным и для скольких рассчитаны коридоры.
              Результат можно сразу изменить вручную.
            </p>
            <div className="instruction-demo demo-card">
              <span className="demo-button demo-soft">Выбрать главный показатель</span>
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
              подсказку с датой и суммой. Светлая линия <b>Тренд</b> показывает общее направление изменения
              за выбранный период — это не прогноз.
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
            <h2>Коридор показателя</h2>
            <p>
              Верхняя граница показывает хороший результат. Нижняя граница помогает быстро увидеть слабые места.
              Средний уровень — среднее арифметическое фактических значений за период расчёта.
              Коридор можно рассчитать автоматически или задать вручную.
            </p>
            <p>
              В окне коридора выберите режим, при необходимости введите границы и нажмите
              <b> Сохранить коридор</b>. Ручные значения сохраняются, пока вы явно не выберете
              автоматический режим; при замене система попросит подтверждение.
              Также укажите <b>Как оценивать показатель?</b> — это влияет только на цвет подсветки
              (например, для пропущенных звонков «Меньше — лучше»).
              Цвет появляется при выходе за границу; на самой границе отклонения нет.
              В подсказке к ячейке указано «выше верхней границы» или «ниже нижней границы».
              Если данных нет, вместо чисел показывается «—».
            </p>
            <div className="instruction-demo demo-thresholds">
              <div>
                <span>Задать вручную</span>
                <i>Верхняя граница</i>
                <i>Средний уровень</i>
                <i>Нижняя граница</i>
                <b>Сохранить коридор</b>
              </div>
              <div>
                <span>Рассчитать автоматически</span>
                <i>Верхняя граница</i>
                <i>Средний уровень</i>
                <i>Нижняя граница</i>
                <b className="demo-green-text">Сохранить коридор</b>
              </div>
            </div>
          </section>

          <section className="instruction-section" id="instruction-table">
            <h2>Как пользоваться таблицей</h2>
            <p>
              Слева находится список показателей, справа — значения по датам. Через меню с тремя точками можно
              показать сотрудников, раскрыть график строки или настроить коридор показателя.
            </p>
            <p>
              Нажмите на цифру, чтобы открыть детализацию: звонки, лиды или сделки, из которых она
              сформирована. Если значение обрезано, наведите курсор — появится подсказка с полным значением.
            </p>
            <div className="instruction-demo demo-table-row">
              <span>Сумма успешных сделок</span>
              <b>812 000 ₽</b>
              <b>940 000 ₽</b>
              <button type="button" aria-label="Меню строки">⋮</button>
            </div>
          </section>

          <section className="instruction-section" id="instruction-settings">
            <h2>Выбрать показатели</h2>
            <p>
              В настройке таблицы можно скрыть лишние разделы. В настройке показателей раздела можно оставить
              только нужные строки. Скрытые показатели не попадут в Excel.
            </p>
            <p>
              Кнопка <b>Выбрать все</b> включает все пункты. Кнопка <b>Сбросить</b> очищает выбор.
            </p>
            <div className="instruction-demo demo-card">
              <span className="demo-button demo-soft">Выбрать показатели</span>
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
              Чтобы переименовать или удалить отображение, откройте поле <b>Обзор бизнеса</b> и нажмите три точки
              рядом с сохраненным названием.
            </p>
            <div className="instruction-demo demo-card">
              <span className="demo-select">Обзор бизнеса</span>
              <span className="demo-select">Продажи за месяц · ⋮</span>
              <span className="demo-menu-item">Редактировать</span>
              <span className="demo-menu-item">Удалить</span>
            </div>
          </section>

          <section className="instruction-section" id="instruction-export">
            <h2>Excel и PDF</h2>
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
            <p>Сначала выберите настройки и нажмите <b>Построить отчёт</b>. Также проверьте выбранный период.</p>
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
    () => ({ ...defaultDetailColumnWidths }),
  );
  const [rowAvailability, setRowAvailability] = useState<
    Record<string, 'ok' | 'unavailable' | 'access_denied'>
  >({});
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

  useEffect(
    () => () => {
      document.body.classList.remove('is-detail-resizing');
    },
    [],
  );

  useEffect(() => {
    setRowAvailability({});
  }, [context.metric.id, context.point.key, context.employee?.id, context.sourceId]);

  const toggleSort = (key: DetailColumnKey) => {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const detailExportTitle = `Детализация: ${context.metric.label}`;
  const detailExportSummary = formatDetailContextSummary(context);
  const detailExportFilenameBase = `detail-${context.metric.id}-${context.point.key}`
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 120);
  const detailExportRows = sortedRows.map((row) => ({
    rowNumber: row.rowNumber,
    entityId: row.entityRawId || row.entityId || '',
    title: row.title,
    responsibleName: row.responsibleName || '',
    createdAt: row.createdAt,
  }));

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportDetailExcel = async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SAPP';
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet('Детализация', {
      views: [{ state: 'frozen', ySplit: 3 }],
    });
    const headers = detailColumns.map((column) => column.label);

    worksheet.addRow([detailExportTitle]);
    worksheet.mergeCells(1, 1, 1, headers.length);
    worksheet.addRow([detailExportSummary]);
    worksheet.mergeCells(2, 1, 2, headers.length);
    worksheet.addRow(headers);

    detailExportRows.forEach((row) => {
      worksheet.addRow([
        row.rowNumber,
        row.entityId,
        row.title,
        row.responsibleName,
        row.createdAt,
      ]);
    });

    worksheet.columns = [
      { width: 8 },
      { width: 16 },
      { width: 42 },
      { width: 28 },
      { width: 22 },
    ];

    worksheet.getRow(1).font = { bold: true, size: 14 };
    worksheet.getRow(2).font = { color: { argb: 'FF69707D' } };
    worksheet.getRow(3).font = { bold: true };
    worksheet.getRow(3).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEAF4FF' },
    };

    worksheet.eachRow((row) => {
      row.alignment = { vertical: 'middle', wrapText: true };
    });

    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(
      new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      `${detailExportFilenameBase}.xlsx`,
    );
  };

  const exportDetailPdf = async () => {
    const exportRoot = document.createElement('div');
    exportRoot.className = 'detail-pdf-export';
    exportRoot.innerHTML = `
      <div class="detail-pdf-export-title"></div>
      <div class="detail-pdf-export-summary"></div>
      <table>
        <thead>
          <tr>${detailColumns.map((column) => `<th>${column.label}</th>`).join('')}</tr>
        </thead>
        <tbody></tbody>
      </table>
    `;

    exportRoot.querySelector('.detail-pdf-export-title')!.textContent = detailExportTitle;
    exportRoot.querySelector('.detail-pdf-export-summary')!.textContent = detailExportSummary;
    const exportBody = exportRoot.querySelector('tbody')!;
    detailExportRows.forEach((row) => {
      const rowElement = document.createElement('tr');
      [
        String(row.rowNumber),
        String(row.entityId),
        row.title,
        row.responsibleName,
        row.createdAt,
      ].forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        rowElement.appendChild(cell);
      });
      exportBody.appendChild(rowElement);
    });
    document.body.appendChild(exportRoot);

    try {
      const canvas = await html2canvas(exportRoot, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
      });
      const pdf = new jsPDF('l', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const imageWidth = pageWidth - margin * 2;
      const imageHeight = (canvas.height * imageWidth) / canvas.width;
      const pageImageHeight = pageHeight - margin * 2;
      let renderedHeight = 0;

      while (renderedHeight < imageHeight) {
        if (renderedHeight > 0) {
          pdf.addPage();
        }

        pdf.addImage(
          canvas.toDataURL('image/png'),
          'PNG',
          margin,
          margin - renderedHeight,
          imageWidth,
          imageHeight,
        );
        renderedHeight += pageImageHeight;
      }

      pdf.save(`${detailExportFilenameBase}.pdf`);
    } finally {
      exportRoot.remove();
    }
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
          <div className="detail-head-title">
            <button className="detail-close-button" type="button" onClick={onClose}>
              <X size={18} />
              <span>Закрыть детализацию</span>
            </button>
            <p id="detail-title">Детализация: {context.metric.label}</p>
            <span>{formatDetailContextSummary(context)}</span>
          </div>
          <div className="detail-head-actions">
            {hasRows && (
              <>
                <button className="detail-export-button detail-export-excel" type="button" onClick={exportDetailExcel}>
                  <Download size={15} />
                  <span>Скачать Excel</span>
                </button>
                <button className="detail-export-button detail-export-pdf" type="button" onClick={exportDetailPdf}>
                  <FileText size={15} />
                  <span>Скачать PDF</span>
                </button>
              </>
            )}
          </div>
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

            {sortedRows.map((row) => {
              const rowKey = `${row.entityType}-${row.sourceId ?? 'source'}-${row.entityId}-${row.rowNumber}`;
              const entityPath = getBitrixDetailRowPath(row);
              const availability: 'ok' | 'unavailable' | 'access_denied' =
                rowAvailability[rowKey]
                ?? row.availability
                ?? (entityPath ? 'ok' : 'unavailable');
              const canOpenEntity = availability === 'ok' && Boolean(entityPath);
              const canOpenResponsible = Number.isFinite(row.responsibleId) && row.responsibleId > 0;
              const entityLabel = row.entityRawId || row.entityId || '-';
              const availabilityLabel =
                availability === 'access_denied'
                  ? 'Нет доступа'
                  : availability === 'unavailable'
                    ? 'Объект недоступен'
                    : null;

              const handleOpenEntity = () => {
                openBitrixDetailRow(row, (result) => {
                  if (result === 'opened') {
                    return;
                  }

                  setRowAvailability((current) => ({
                    ...current,
                    [rowKey]: result,
                  }));
                });
              };

              return (
                <div className="detail-row-contents" role="row" key={rowKey}>
                  <div className="detail-cell">{row.rowNumber}</div>
                  {canOpenEntity ? (
                    <button
                      className="detail-cell detail-action-cell"
                      type="button"
                      onClick={handleOpenEntity}
                    >
                      {entityLabel}
                    </button>
                  ) : (
                    <div className="detail-cell detail-unavailable-cell" title={availabilityLabel ?? undefined}>
                      {entityLabel}
                      {availabilityLabel ? <em>{availabilityLabel}</em> : null}
                    </div>
                  )}
                  {canOpenEntity ? (
                    <button
                      className="detail-cell detail-action-cell detail-title-cell"
                      type="button"
                      onClick={handleOpenEntity}
                    >
                      {row.title}
                    </button>
                  ) : (
                    <div className="detail-cell detail-title-cell detail-unavailable-cell" title={availabilityLabel ?? undefined}>
                      {row.title}
                      {availabilityLabel ? <em>{availabilityLabel}</em> : null}
                    </div>
                  )}
                  {canOpenResponsible ? (
                    <button
                      className="detail-cell detail-action-cell"
                      type="button"
                      onClick={() => openBitrixUser(row.responsibleId)}
                    >
                      {row.responsibleName || `ID ${row.responsibleId}`}
                    </button>
                  ) : (
                    <div className="detail-cell">{row.responsibleName || '-'}</div>
                  )}
                  <div className="detail-cell">{row.createdAt}</div>
                  <div className="detail-filler-cell" aria-hidden="true" />
                </div>
              );
            })}
            </div>
          </div>
        ) : (
          <div className="detail-empty-state">
            <p>По этому значению нет строк для просмотра</p>
            <span>
              {context.value > 0
                ? 'Число в отчёте сохраняется до явного перестроения. Сущности могли быть удалены или недоступны по правам («Нет доступа»).'
                : 'За выбранный период и показатель нет отдельных CRM-элементов.'}
            </span>
          </div>
        )}
      </section>
    </div>
  );
}

