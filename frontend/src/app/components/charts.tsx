import type { CSSProperties, RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { ActiveChartPoint, ChartTooltipItem, HoverChartDotProps } from '../types';
import { clamp } from './common';
import { getAppliedThresholdItems } from '../utils/thresholds';

const getChartTooltipStyle = (
  point: ActiveChartPoint,
  container: HTMLElement | null,
): CSSProperties => {
  if (typeof window === 'undefined') {
    return {};
  }

  const containerRect = container?.getBoundingClientRect();
  const pointX = (containerRect?.left ?? 0) + point.x;
  const pointY = (containerRect?.top ?? 0) + point.y;
  const appRect = container?.closest('.report-card')?.getBoundingClientRect();
  const boundary = appRect ?? {
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
    left: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  };
  const width = Math.min(280, Math.max(180, (container?.clientWidth ?? 280) - 24));
  const estimatedHeight = 116;
  const minLeft = boundary.left + width / 2 + 12;
  const maxLeft = Math.max(minLeft, boundary.right - width / 2 - 12);
  const hasTopSpace = pointY - boundary.top > estimatedHeight + 14;
  const preferredTop = hasTopSpace ? pointY - 10 : pointY + 10;
  const top = hasTopSpace
    ? Math.max(preferredTop, boundary.top + estimatedHeight + 12)
    : Math.min(Math.max(preferredTop, boundary.top + 12), boundary.bottom - estimatedHeight - 12);

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
}: {
  point: ActiveChartPoint;
  title: string;
  items: ChartTooltipItem[];
  thresholdItems: ReturnType<typeof getAppliedThresholdItems>;
  containerRef: RefObject<HTMLDivElement | null>;
  valueFormatter: (value: number) => string;
}) {
  if (typeof document === 'undefined') {
    return null;
  }

  return (
    createPortal(<div className="chart-point-tooltip chart-tooltip" style={getChartTooltipStyle(point, containerRef.current)}>
      <p>{title}</p>
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
    </div>, document.body)
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



