import { getMonthDateRange, type DateRange, type Period } from '../../mockData';

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

export const addMonthsToDateValue = (value: string, monthsToAdd: number) => {
  const [year, month, day] = value.split('-').map(Number);
  const targetMonthIndex = month - 1 + monthsToAdd;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const date = new Date(targetYear, targetMonth, Math.min(day, lastDayOfTargetMonth));

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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

  const maxEnd = addMonthsToDateValue(range.start, 3);
  let end = range.end;

  if (end < range.start) {
    end = range.start;
  }

  if (end > maxEnd) {
    end = maxEnd;
  }

  return {
    start: range.start,
    end,
  };
};
