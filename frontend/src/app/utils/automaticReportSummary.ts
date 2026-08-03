export type AutomaticReportSummaryInput = {
  foundMetrics: number;
  mainIndicatorLabel: string;
  corridorsCalculated: number | null;
  skippedUnavailableLabels: string[];
  missingDataNote?: string | null;
};

const formatList = (items: string[]) => {
  if (items.length <= 1) {
    return items[0] ?? '';
  }

  if (items.length === 2) {
    return `${items[0]} и ${items[1]}`;
  }

  return `${items.slice(0, -1).join(', ')} и ${items[items.length - 1]}`;
};

export const buildAutomaticReportSummaryMessage = (
  input: AutomaticReportSummaryInput,
): string => {
  const mainLabel = input.mainIndicatorLabel.trim() || 'не выбран';
  const parts = [
    `Найдено ${input.foundMetrics} показателей.`,
    `Главный показатель: ${mainLabel}.`,
  ];

  if (input.corridorsCalculated !== null) {
    parts.push(`Коридоры рассчитаны для ${input.corridorsCalculated} показателей.`);
  }

  if (input.skippedUnavailableLabels.length > 0) {
    const visible = input.skippedUnavailableLabels.slice(0, 5);
    const rest = input.skippedUnavailableLabels.length - visible.length;
    const list = formatList(visible);
    parts.push(
      rest > 0
        ? `Пропущены недоступные: ${list} и ещё ${rest}.`
        : `Пропущены недоступные: ${list}.`,
    );
  }

  if (input.missingDataNote) {
    parts.push(input.missingDataNote);
  }

  return parts.join(' ');
};

export const hasFilledCorridor = (upper: string, lower: string) =>
  Boolean(upper.trim() && lower.trim());
