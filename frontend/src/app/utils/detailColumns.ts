import {
  defaultDetailColumnWidths,
  detailColumnMinWidthSum,
  detailColumnMinWidths,
  detailColumns,
} from '../constants';
import type { DetailColumnKey } from '../types';

export const sumDetailColumnWidths = (widths: Record<DetailColumnKey, number>) =>
  detailColumns.reduce((sum, column) => sum + widths[column.key], 0);

export const sanitizeDetailColumnWidths = (
  widths: Partial<Record<DetailColumnKey, number>>,
): Record<DetailColumnKey, number> =>
  detailColumns.reduce<Record<DetailColumnKey, number>>((acc, column) => {
    const value = Number(widths[column.key]);
    acc[column.key] = Number.isFinite(value)
      ? Math.max(column.minWidth, Math.round(value))
      : defaultDetailColumnWidths[column.key];
    return acc;
  }, {} as Record<DetailColumnKey, number>);

const shrinkDetailColumns = (
  widths: Record<DetailColumnKey, number>,
  excludedKey: DetailColumnKey | null,
  amount: number,
) => {
  let remaining = Math.max(0, amount);
  const nextWidths = { ...widths };

  for (const column of detailColumns) {
    if (remaining <= 0 || column.key === excludedKey) {
      continue;
    }

    const available = Math.max(0, nextWidths[column.key] - column.minWidth);
    const shrink = Math.min(available, remaining);
    nextWidths[column.key] -= shrink;
    remaining -= shrink;
  }

  return {
    widths: nextWidths,
    applied: amount - remaining,
  };
};

export const normalizeDetailColumnWidths = (
  widths: Record<DetailColumnKey, number>,
  containerWidth: number,
) => {
  const safeWidths = sanitizeDetailColumnWidths(widths);
  const targetWidth = Math.max(detailColumnMinWidthSum, Math.floor(containerWidth || 0));
  const currentSum = sumDetailColumnWidths(safeWidths);

  if (currentSum === targetWidth) {
    return safeWidths;
  }

  if (currentSum < targetWidth) {
    return {
      ...safeWidths,
      title: safeWidths.title + targetWidth - currentSum,
    };
  }

  const { widths: reducedWidths } = shrinkDetailColumns(safeWidths, null, currentSum - targetWidth);
  return reducedWidths;
};

export const resizeDetailColumnWidths = (
  startWidths: Record<DetailColumnKey, number>,
  activeKey: DetailColumnKey,
  delta: number,
  containerWidth: number,
) => {
  const baseWidths = normalizeDetailColumnWidths(startWidths, containerWidth);
  const direction = Math.sign(delta);

  if (direction === 0) {
    return baseWidths;
  }

  if (direction > 0) {
    const { widths: reducedWidths, applied } = shrinkDetailColumns(baseWidths, activeKey, Math.round(delta));

    return {
      ...reducedWidths,
      [activeKey]: reducedWidths[activeKey] + applied,
    };
  }

  const activeAvailable = Math.max(0, baseWidths[activeKey] - detailColumnMinWidths[activeKey]);
  const applied = Math.min(activeAvailable, Math.abs(Math.round(delta)));
  const activeIndex = detailColumns.findIndex((column) => column.key === activeKey);
  const receiver =
    detailColumns[(activeIndex + 1) % detailColumns.length]?.key === activeKey
      ? 'title'
      : detailColumns[(activeIndex + 1) % detailColumns.length]?.key ?? 'title';

  return {
    ...baseWidths,
    [activeKey]: baseWidths[activeKey] - applied,
    [receiver]: baseWidths[receiver] + applied,
  };
};

