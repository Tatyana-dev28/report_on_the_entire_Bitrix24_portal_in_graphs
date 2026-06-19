import {
    addDays,
    eachDayOfInterval,
    eachHourOfInterval,
    eachMonthOfInterval,
    endOfDay,
    endOfMonth,
    format,
    isAfter,
    isSameDay,
    isSameMonth,
    startOfDay,
    startOfMonth,
} from 'date-fns';
import { ru } from 'date-fns/locale';

export type Period = 'hours' | 'days' | 'weeks' | 'months';

export type DateRange = {
    start: string;
    end: string;
};

export type MetricRow = {
    id: string;
    label: string;
    group?: string;
    type: 'number' | 'money' | 'percent';
    base: number;
};

export type MetricSection = {
    id: string;
    label: string;
    metricIds: string[];
};

export type ReportPoint = {
    key: string;
    label: string;
    tooltipLabel: string;
    indicator: number;
    values: Record<string, number>;
};

export type PeriodPoint = {
    date: Date;
    label: string;
    tooltipLabel: string;
};

export const defaultDateRange: DateRange = {
    start: '2026-05-01',
    end: '2026-05-31',
};

export const periodOptions: Array<{ value: Period; label: string }> = [
    { value: 'hours', label: 'По часам' },
    { value: 'days', label: 'По дням' },
    { value: 'weeks', label: 'По неделям' },
    { value: 'months', label: 'По месяцам' },
];

export const reportSources = [
    'Воронка лидов',
    'Воронка продажи',
    'Воронка производство',
    'Счета',
];

export const metrics: MetricRow[] = [
    { id: 'deals_created', label: 'Создано сделок', type: 'number', base: 35 },
    { id: 'deals_won', label: 'Успешных сделок', type: 'number', base: 18 },
    { id: 'deals_lost', label: 'Проигранных сделок', type: 'number', base: 7 },
    { id: 'deals_won_sum', label: 'Сумма успешных сделок', type: 'money', base: 920000 },
    { id: 'deals_lost_sum', label: 'Сумма проигранных сделок', type: 'money', base: 260000 },
    { id: 'deals_conversion', label: 'Конверсия сделок', type: 'percent', base: 42 },
    { id: 'leads_created', label: 'Создано лидов', type: 'number', base: 78 },
    { id: 'leads_quality', label: 'Качественных лидов', type: 'number', base: 45 },
    { id: 'leads_bad', label: 'Некачественных лидов', type: 'number', base: 14 },
    { id: 'leads_quality_sum', label: 'Сумма качественных лидов', type: 'money', base: 610000 },
    { id: 'leads_bad_sum', label: 'Сумма некачественных лидов', type: 'money', base: 130000 },
    { id: 'leads_conversion', label: 'Конверсия лидов', type: 'percent', base: 58 },
    { id: 'invoices_created', label: 'Создано счетов', type: 'number', base: 28 },
    { id: 'invoices_won', label: 'Успешных счетов', type: 'number', base: 20 },
    { id: 'invoices_lost', label: 'Проигранных счетов', type: 'number', base: 6 },
    { id: 'invoices_won_sum', label: 'Сумма успешных счетов', type: 'money', base: 740000 },
    { id: 'invoices_lost_sum', label: 'Сумма проигранных счетов', type: 'money', base: 190000 },
    { id: 'invoices_conversion', label: 'Конверсия счетов', type: 'percent', base: 63 },
    { id: 'quotes_created', label: 'Создано предложений', type: 'number', base: 24 },
    { id: 'quotes_accepted', label: 'Принятых предложений', type: 'number', base: 15 },
    { id: 'quotes_declined', label: 'Отклоненных предложений', type: 'number', base: 5 },
    { id: 'quotes_conversion', label: 'Конверсия предложений', type: 'percent', base: 61 },
    { id: 'companies_new', label: 'Новых компаний', type: 'number', base: 19 },
    { id: 'contacts_new', label: 'Новых контактов', type: 'number', base: 48 },
    { id: 'calls_in', label: 'Входящих звонков', type: 'number', base: 66 },
    { id: 'calls_out', label: 'Исходящих звонков', type: 'number', base: 52 },
    { id: 'calls_missed', label: 'Пропущенных звонков', type: 'number', base: 9 },
    { id: 'messages_new', label: 'Новых сообщений', type: 'number', base: 81 },
    { id: 'messages_total', label: 'Всего сообщений', type: 'number', base: 146 },
    { id: 'email_in', label: 'Входящих писем', type: 'number', base: 44 },
    { id: 'email_out', label: 'Отправленных писем', type: 'number', base: 39 },
    { id: 'crm_forms', label: 'Заполнено CRM форм', type: 'number', base: 17 },
    { id: 'tasks_created', label: 'Создано задач', type: 'number', base: 57 },
    { id: 'tasks_done', label: 'Завершено задач', type: 'number', base: 49 },
    { id: 'tasks_overdue', label: 'Просрочено задач', type: 'number', base: 8 },
    { id: 'activities_created', label: 'Создано дел', type: 'number', base: 63 },
    { id: 'activities_done', label: 'Выполненных дел', type: 'number', base: 55 },
    { id: 'activities_undone', label: 'Невыполненных дел', type: 'number', base: 11 },
    { id: 'lead_new', label: 'Новый', group: 'Воронка лидов', type: 'number', base: 28 },
    { id: 'lead_work', label: 'В работе', group: 'Воронка лидов', type: 'number', base: 21 },
    { id: 'lead_qualified', label: 'Квалифицирован', group: 'Воронка лидов', type: 'number', base: 17 },
    { id: 'lead_bad_stage', label: 'Некачественный', group: 'Воронка лидов', type: 'number', base: 8 },
    { id: 'sales_new', label: 'Новая сделка', group: 'Воронка продажи', type: 'number', base: 19 },
    { id: 'sales_talk', label: 'Переговоры', group: 'Воронка продажи', type: 'number', base: 14 },
    { id: 'sales_invoice', label: 'Счет выставлен', group: 'Воронка продажи', type: 'number', base: 12 },
    { id: 'sales_won', label: 'Успешно', group: 'Воронка продажи', type: 'number', base: 9 },
    { id: 'sales_lost', label: 'Проиграно', group: 'Воронка продажи', type: 'number', base: 4 },
    { id: 'production_accepted', label: 'Принято', group: 'Воронка производство', type: 'number', base: 16 },
    { id: 'production_work', label: 'В производстве', group: 'Воронка производство', type: 'number', base: 13 },
    { id: 'production_check', label: 'Проверка', group: 'Воронка производство', type: 'number', base: 8 },
    { id: 'production_ready', label: 'Готово', group: 'Воронка производство', type: 'number', base: 7 },
    { id: 'production_closed', label: 'Закрыто', group: 'Воронка производство', type: 'number', base: 6 },
];

export const metricSections: MetricSection[] = [
    {
        id: 'deals',
        label: 'Сделки',
        metricIds: [
            'deals_created',
            'deals_won',
            'deals_lost',
            'deals_won_sum',
            'deals_lost_sum',
            'deals_conversion',
        ],
    },
    {
        id: 'leads',
        label: 'Лиды',
        metricIds: [
            'leads_created',
            'leads_quality',
            'leads_bad',
            'leads_quality_sum',
            'leads_bad_sum',
            'leads_conversion',
        ],
    },
    {
        id: 'invoices',
        label: 'Счета',
        metricIds: [
            'invoices_created',
            'invoices_won',
            'invoices_lost',
            'invoices_won_sum',
            'invoices_lost_sum',
            'invoices_conversion',
        ],
    },
    {
        id: 'quotes',
        label: 'Предложения',
        metricIds: ['quotes_created', 'quotes_accepted', 'quotes_declined', 'quotes_conversion'],
    },
    {
        id: 'companies',
        label: 'Компании и контакты',
        metricIds: ['companies_new', 'contacts_new'],
    },
    {
        id: 'calls',
        label: 'Звонки',
        metricIds: ['calls_in', 'calls_out', 'calls_missed'],
    },
    {
        id: 'messages',
        label: 'Сообщения',
        metricIds: ['messages_new', 'messages_total'],
    },
    {
        id: 'email',
        label: 'Письма',
        metricIds: ['email_in', 'email_out'],
    },
    {
        id: 'crm_forms',
        label: 'CRM формы',
        metricIds: ['crm_forms'],
    },
    {
        id: 'tasks',
        label: 'Задачи',
        metricIds: ['tasks_created', 'tasks_done', 'tasks_overdue'],
    },
    {
        id: 'activities',
        label: 'Дела',
        metricIds: ['activities_created', 'activities_done', 'activities_undone'],
    },
    {
        id: 'lead_funnel',
        label: 'Воронка лидов',
        metricIds: ['lead_new', 'lead_work', 'lead_qualified', 'lead_bad_stage'],
    },
    {
        id: 'sales_funnel',
        label: 'Воронка продажи',
        metricIds: ['sales_new', 'sales_talk', 'sales_invoice', 'sales_won', 'sales_lost'],
    },
    {
        id: 'production_funnel',
        label: 'Воронка производство',
        metricIds: [
            'production_accepted',
            'production_work',
            'production_check',
            'production_ready',
            'production_closed',
        ],
    },
];

const capitalizeFirst = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const parseDateValue = (value: string, boundary: 'start' | 'end') => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);

    return boundary === 'start' ? startOfDay(date) : endOfDay(date);
};

const normalizeDateRange = (range: DateRange) => {
    const start = parseDateValue(range.start, 'start');
    const end = parseDateValue(range.end, 'end');

    if (!isAfter(start, end)) {
        return { start, end };
    }

    return {
        start: startOfDay(end),
        end: endOfDay(start),
    };
};

const formatShortDate = (date: Date) => format(date, 'd MMM yyyy', { locale: ru });

export const formatRangeLabel = (period: Period, range: DateRange) => {
    const { start, end } = normalizeDateRange(range);

    if (period === 'months') {
        const startLabel = capitalizeFirst(format(startOfMonth(start), 'LLLL yyyy', { locale: ru }));
        const endLabel = capitalizeFirst(format(startOfMonth(end), 'LLLL yyyy', { locale: ru }));

        return isSameMonth(start, end) ? startLabel : `${startLabel} - ${endLabel}`;
    }

    if (period === 'hours' && isSameDay(start, end)) {
        return formatShortDate(start);
    }

    return `${formatShortDate(start)} - ${formatShortDate(end)}`;
};

const buildWeekPeriods = (start: Date, end: Date) => {
    const periods: Array<{ start: Date; end: Date }> = [];
    let cursor = startOfDay(start);

    while (!isAfter(cursor, end)) {
        const weekEnd = addDays(cursor, 6);

        periods.push({
            start: cursor,
            end: isAfter(weekEnd, end) ? end : endOfDay(weekEnd),
        });

        cursor = addDays(cursor, 7);
    }

    return periods;
};

const formatWeekLabel = (start: Date, end: Date) => {
    if (isSameMonth(start, end)) {
        return `${format(start, 'd', { locale: ru })}-${format(end, 'd MMM', { locale: ru })}`;
    }

    return `${format(start, 'd MMM', { locale: ru })} - ${format(end, 'd MMM', { locale: ru })}`;
};

export const buildPeriodPoints = (period: Period, range: DateRange): PeriodPoint[] => {
    const { start, end } = normalizeDateRange(range);

    if (period === 'hours') {
        const dates = eachHourOfInterval({ start: startOfDay(start), end: endOfDay(end) });
        const oneDay = isSameDay(start, end);

        return dates.map((date) => ({
            date,
            label: format(date, oneDay ? 'HH:mm' : 'd MMM HH:mm', { locale: ru }),
            tooltipLabel: format(date, 'd MMMM yyyy, HH:mm', { locale: ru }),
        }));
    }

    if (period === 'weeks') {
        return buildWeekPeriods(start, end).map((week) => ({
            date: week.start,
            label: formatWeekLabel(week.start, week.end),
            tooltipLabel: `Неделя ${formatShortDate(week.start)} - ${formatShortDate(week.end)}`,
        }));
    }

    if (period === 'months') {
        return eachMonthOfInterval({ start: startOfMonth(start), end: startOfMonth(end) }).map((date) => ({
            date,
            label: capitalizeFirst(format(date, 'LLL yyyy', { locale: ru })),
            tooltipLabel: capitalizeFirst(format(date, 'LLLL yyyy', { locale: ru })),
        }));
    }

    return eachDayOfInterval({ start: startOfDay(start), end: endOfDay(end) }).map((date) => ({
        date,
        label: format(date, 'd MMM', { locale: ru }),
        tooltipLabel: format(date, 'd MMMM yyyy', { locale: ru }),
    }));
};

export const getMonthDateRange = (monthValue: string): DateRange => {
    const [year, month] = monthValue.split('-').map(Number);
    const date = new Date(year, month - 1, 1);

    return {
        start: format(startOfMonth(date), 'yyyy-MM-dd'),
        end: format(endOfMonth(date), 'yyyy-MM-dd'),
    };
};

export const formatMoney = (value: number) =>
    new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        maximumFractionDigits: 0,
    }).format(value);

export const formatMetricValue = (value: number, type: MetricRow['type']) => {
    if (type === 'money') {
        return formatMoney(value);
    }

    if (type === 'percent') {
        return `${value}%`;
    }

    return new Intl.NumberFormat('ru-RU').format(value);
};