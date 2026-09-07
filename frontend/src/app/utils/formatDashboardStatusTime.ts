const MOSCOW_TIME_ZONE = 'Europe/Moscow';

const moscowParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: MOSCOW_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
  };
};

const moscowDayKey = (date: Date) => {
  const parts = moscowParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const formatDashboardStatusTime = (value: string | null) => {
  if (!value) {
    return 'не задано';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'не задано';
  }

  const time = new Intl.DateTimeFormat('ru-RU', {
    timeZone: MOSCOW_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

  const todayKey = moscowDayKey(new Date());
  const valueKey = moscowDayKey(date);
  if (valueKey === todayKey) {
    return time;
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (valueKey === moscowDayKey(yesterday)) {
    return `вчера, ${time}`;
  }

  const dateLabel = new Intl.DateTimeFormat('ru-RU', {
    timeZone: MOSCOW_TIME_ZONE,
    day: 'numeric',
    month: 'short',
  }).format(date);

  return `${dateLabel}, ${time}`;
};
