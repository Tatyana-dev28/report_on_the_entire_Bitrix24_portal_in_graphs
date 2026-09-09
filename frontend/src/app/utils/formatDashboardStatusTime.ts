const MOSCOW_TIME_ZONE = 'Europe/Moscow';

export const formatDashboardStatusTime = (value: string | null) => {
  if (!value) {
    return 'не задано';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'не задано';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: MOSCOW_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
};
