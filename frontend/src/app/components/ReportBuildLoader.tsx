import { useEffect, useState } from 'react';
import carImage from '../../assets/report-loader-car.png';
import './ReportBuildLoader.css';

const CHECKPOINTS = [
  { x: 72, y: 430, at: 0, label: 'start' },
  { x: 172, y: 398, at: 0.12, label: 'filters' },
  { x: 278, y: 418, at: 0.25, label: 'crm' },
  { x: 382, y: 334, at: 0.39, label: 'activity' },
  { x: 500, y: 352, at: 0.53, label: 'deals' },
  { x: 620, y: 266, at: 0.68, label: 'metrics' },
  { x: 750, y: 210, at: 0.82, label: 'charts' },
  { x: 870, y: 154, at: 0.92, label: 'render' },
  { x: 960, y: 118, at: 0.98, label: 'ready' },
];

const LOOP_MS = 12800;
const ROUTE_PATH = 'M72 430 L172 398 L278 418 L382 334 L500 352 L620 266 L750 210 L870 154 L960 118';

type ReportBuildLoaderProps = {
  className?: string;
};

export default function ReportBuildLoader({ className = '' }: ReportBuildLoaderProps) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startTime = Date.now();
    setElapsedMs(0);

    const intervalId = window.setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const cycleProgress = (elapsedMs % LOOP_MS) / LOOP_MS;
  const rootClassName = ['report-loader', className].filter(Boolean).join(' ');
  const activatedCheckpointCount = Math.max(
    1,
    CHECKPOINTS.filter((point) => cycleProgress >= point.at).length,
  );
  const animationStyle = { animationDuration: `${LOOP_MS}ms` };

  return (
    <div
      className={rootClassName}
      role="status"
      aria-live="polite"
      aria-label="Строим отчет"
    >
      <div className="report-loader__card">
        <div className="report-loader__stage" aria-hidden="true">
          <svg className="report-loader__map" viewBox="0 0 1000 560" preserveAspectRatio="none">
            <defs>
              <linearGradient id="report-loader-route-gradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#2274ff" />
                <stop offset="54%" stopColor="#56b8ff" />
                <stop offset="100%" stopColor="#4fd8d0" />
              </linearGradient>
              <linearGradient id="report-loader-area-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#78c7ff" stopOpacity=".3" />
                <stop offset="100%" stopColor="#78c7ff" stopOpacity="0" />
              </linearGradient>
            </defs>
            <line className="report-loader__axis" x1="72" y1="456" x2="960" y2="456" />
            <line className="report-loader__axis" x1="72" y1="118" x2="72" y2="456" />
            <path className="report-loader__ghost-chart" d={ROUTE_PATH} />
            <path className="report-loader__route-shadow" d={ROUTE_PATH} />
            <path className="report-loader__route-base" d={ROUTE_PATH} />
            <path className="report-loader__route-progress" d={ROUTE_PATH} pathLength={1} />
            <path className="report-loader__chart-area" d={`${ROUTE_PATH} L960 456 L72 456 Z`} />
            <path className="report-loader__chart-line" d={ROUTE_PATH} />

            {CHECKPOINTS.map((point, index) => (
              <g
                className={`report-loader__checkpoint ${index < activatedCheckpointCount ? 'is-active' : ''}`}
                key={point.label}
                transform={`translate(${point.x} ${point.y})`}
              >
                <circle className="report-loader__checkpoint-halo" r="15" />
                <circle className="report-loader__checkpoint-ring" r="18" />
                <circle className="report-loader__checkpoint-core" r="5.6" />
                <path className="report-loader__checkpoint-tick" d="M-4 0 L-1 3 L5 -4" />
              </g>
            ))}
          </svg>

          <span className="report-loader__trail report-loader__trail-a" />
          <span className="report-loader__trail report-loader__trail-b" />
          <span className="report-loader__trail report-loader__trail-c" />
          <span className="report-loader__car-glow" style={animationStyle} />
          <img
            className="report-loader__car"
            src={carImage}
            alt=""
            aria-hidden="true"
            style={animationStyle}
          />
        </div>

        <div className="report-loader__bottom">
          <span className="report-loader__pulse" />
          <span className="report-loader__status">Идет построение отчета</span>
        </div>
      </div>
    </div>
  );
}
