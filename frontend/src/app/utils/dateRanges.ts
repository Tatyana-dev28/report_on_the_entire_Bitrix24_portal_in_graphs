import { getMonthDateRange, type DateRange, type Period } from '../../services/report/reportCatalog';

export const toDateInputValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const getYesterdayRange = (): DateRange => {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  const value = toDateInputValue(date);

  return {
    start: value,
    end: value,
  };
};

export const getPreviousWeekFromYesterdayRange = (): DateRange => {
  const end = new Date();
  end.setDate(end.getDate() - 1);

  const start = new Date(end);
  start.setDate(start.getDate() - 6);

  return {
    start: toDateInputValue(start),
    end: toDateInputValue(end),
  };
};

export const toMonthInputValue = (dateValue: string) => dateValue.slice(0, 7);

export const monthIndex = (monthValue: string) => {
  const [year, month] = monthValue.split('-').map(Number);
  return year * 12 + month - 1;
};

export const monthValueFromIndex = (index: number) => {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
};

export const getRangeFromMonthIndexes = (startIndex: number, endIndex: number): DateRange => {
  const startRange = getMonthDateRange(monthValueFromIndex(Math.min(startIndex, endIndex)));
  const endRange = getMonthDateRange(monthValueFromIndex(Math.max(startIndex, endIndex)));

  return {
    start: startRange.start,
    end: endRange.end,
  };
};

export const constrainRangeForPeriod = (period: Period, range: DateRange): DateRange => {
  if (period === 'hours') {
    return {
      start: range.start,
      end: range.start,
    };
  }

  if (period !== 'days') {
    return range;
  }

  let end = range.end;

  if (end < range.start) {
    end = range.start;
  }

  return {
    start: range.start,
    end,
  };
};

