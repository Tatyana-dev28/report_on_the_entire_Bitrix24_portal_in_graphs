import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { ActiveChartPoint, ChartTooltipItem, HoverChartDotProps } from '../types';
import { clamp } from './common';
import { getAppliedThresholdItems } from '../utils/thresholds';

const TOOLTIP_MARGIN = 12;

const getChartTooltipStyle = (
  point: ActiveChartPoint,
  container: HTMLElement | null,
  size: { width: number; height: number },
): CSSProperties => {
  if (typeof window === 'undefined') {
    return {};
  }

  const containerRect = container?.getBoundingClientRect();
  const pointX = (containerRect?.left ?? 0) + point.x;
  const pointY = (containerRect?.top ?? 0) + point.y;
  // F-19: keep tooltip inside the browser window (and report card when tighter).
  const appRect = container?.closest('.report-card')?.getBoundingClientRect();
  const boundary = {
    top: Math.max(0, appRect?.top ?? 0),
    left: Math.max(0, appRect?.left ?? 0),
    right: Math.min(window.innerWidth, appRect?.right ?? window.innerWidth),
    bottom: Math.min(window.innerHeight, appRect?.bottom ?? window.innerHeight),
  };

  const width = Math.min(
    size.width || 280,
    Math.max(160, boundary.right - boundary.left - TOOLTIP_MARGIN * 2),
  );
  const height = Math.max(size.height || 116, 48);
  const hasTopSpace = pointY - boundary.top > height + TOOLTIP_MARGIN + 8;
  const preferredTop = hasTopSpace ? pointY - 10 : pointY + 14;
  const minTop = boundary.top + TOOLTIP_MARGIN + (hasTopSpace ? height : 0);
  const maxTop = boundary.bottom - TOOLTIP_MARGIN - (hasTopSpace ? 0 : height);
  const top = clamp(preferredTop, Math.min(minTop, maxTop), Math.max(minTop, maxTop));
  const minLeft = boundary.left + width / 2 + TOOLTIP_MARGIN;
  const maxLeft = Math.max(minLeft, boundary.right - width / 2 - TOOLTIP_MARGIN);

  return {
    width,
    left: clamp(pointX, minLeft, maxLeft),
    top,
    transform: hasTopSpace ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
  };
};

export function ChartPointTooltip({
  point,
  title,
  items,
  thresholdItems,
  containerRef,
  valueFormatter,
  summary,
}: {
  point: ActiveChartPoint;
  title: string;
  items: ChartTooltipItem[];
  thresholdItems: ReturnType<typeof getAppliedThresholdItems>;
  containerRef: RefObject<HTMLDivElement | null>;
  valueFormatter: (value: number) => string;
  /** F-19 prose line: value + corridor position + evaluation. */
  summary?: string;
}) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 260, height: 116 });

  useLayoutEffect(() => {
    const node = tooltipRef.current;
    if (!node) {
      return;
    }

    const rect = node.getBoundingClientRect();
    const next = {
      width: Math.ceil(rect.width) || 260,
      height: Math.ceil(rect.height) || 116,
    };

    setSize((current) => (
      current.width === next.width && current.height === next.height ? current : next
    ));
  }, [point.index, point.x, point.y, title, summary, items, thresholdItems]);

  if (typeof document === 'undefined') {
    return null;
  }

  return (
    createPortal(
      <div
        className="chart-point-tooltip chart-tooltip"
        ref={tooltipRef}
        style={getChartTooltipStyle(point, containerRef.current, size)}
      >
        <p>{title}</p>
        {summary ? <p className="chart-tooltip-summary">{summary}</p> : null}
        <div className="chart-tooltip-list">
          {items.map((item) => (
            <span className="chart-tooltip-row" key={item.label}>
              <i style={{ background: item.color }} />
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </span>
          ))}
          {thresholdItems.map((item) => (
            <span
              className="chart-tooltip-row threshold-tooltip-row"
              style={{ color: item.color }}
              key={item.label}
            >
              <i style={{ borderColor: item.color, background: item.color }} />
              <span>{item.label}</span>
              <strong style={{ color: item.color }}>{valueFormatter(item.value)}</strong>
            </span>
          ))}
        </div>
      </div>,
      document.body,
    )
  );
}

export function HoverChartDot({
  cx,
  cy,
  stroke = '#2274ff',
  index = 0,
  radius = 3,
  onActivate,
  onDeactivate,
}: HoverChartDotProps) {
  const x = Number(cx);
  const y = Number(cy);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return (
    <g
      className="chart-hover-dot"
      onMouseEnter={() => onActivate({ index, x, y })}
      onMouseLeave={onDeactivate}
      onFocus={() => onActivate({ index, x, y })}
      onBlur={onDeactivate}
      tabIndex={0}
    >
      <circle cx={x} cy={y} r={Math.max(radius + 6, 9)} fill="transparent" pointerEvents="all" />
      <circle cx={x} cy={y} r={radius} fill="#ffffff" stroke={stroke} strokeWidth={2} />
    </g>
  );
}
