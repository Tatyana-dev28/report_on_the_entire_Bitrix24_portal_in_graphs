import { useEffect, useMemo, useState } from 'react';
import carImage from '../../assets/report-loader-car.png';
import './ReportBuildLoader.css';

const STAGES = [
  'Подключаем данные отчета',
  'Загружаем фильтры',
  'Получаем CRM-данные',
  'Сверяем активность',
  'Считаем метрики',
  'Собираем график',
  'Готовим отчет',
];

const CHECKPOINTS = [
  { x: 122, y: 430, at: 0, label: 'start' },
  { x: 194, y: 398, at: 0.12, label: 'filters' },
  { x: 286, y: 418, at: 0.25, label: 'crm' },
  { x: 372, y: 334, at: 0.39, label: 'activity' },
  { x: 466, y: 352, at: 0.53, label: 'deals' },
  { x: 556, y: 266, at: 0.68, label: 'metrics' },
  { x: 646, y: 232, at: 0.83, label: 'charts' },
  { x: 854, y: 136, at: 0.92, label: 'render' },
  { x: 916, y: 118, at: 0.98, label: 'ready' },
];

const LOOP_MS = 12800;

type ReportBuildLoaderProps = {
  className?: string;
};

const formatElapsed = (elapsedMs: number) => {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const padded = (value: number) => String(value).padStart(2, '0');

  return `${padded(hours)}:${padded(minutes)}:${padded(seconds)}`;
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
  const stageIndex = Math.min(STAGES.length - 1, Math.floor(cycleProgress * STAGES.length));
  const progress = Math.min(99, Math.round(cycleProgress * 100));
  const currentStage = STAGES[stageIndex];
  const rootClassName = ['report-loader', className].filter(Boolean).join(' ');
  const activatedCheckpointCount = Math.max(
    1,
    CHECKPOINTS.filter((point) => cycleProgress >= point.at).length,
  );
  const carStyle = useMemo(
    () => ({ animationDuration: `${LOOP_MS}ms` }),
    [],
  );

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
            <line className="report-loader__axis" x1="104" y1="456" x2="916" y2="456" />
            <line className="report-loader__axis" x1="104" y1="118" x2="104" y2="456" />
            <path className="report-loader__ghost-chart" d="M122 430 L194 398 L286 418 L372 334 L466 352 L556 266 L646 232 L742 176 L854 136 L916 118" />
            <path className="report-loader__route-shadow" d="M122 430 L194 398 L286 418 L372 334 L466 352 L556 266 L646 232 L742 176 L854 136 L916 118" />
            <path className="report-loader__route-base" d="M122 430 L194 398 L286 418 L372 334 L466 352 L556 266 L646 232 L742 176 L854 136 L916 118" />
            <path className="report-loader__route-progress" d="M122 430 L194 398 L286 418 L372 334 L466 352 L556 266 L646 232 L742 176 L854 136 L916 118" />
            <path className="report-loader__chart-area" d="M122 430 L194 398 L286 418 L372 334 L466 352 L556 266 L646 232 L742 176 L854 136 L916 118 L916 456 L122 456 Z" />
            <path className="report-loader__chart-line" d="M122 430 L194 398 L286 418 L372 334 L466 352 L556 266 L646 232 L742 176 L854 136 L916 118" />

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
          <span className="report-loader__car-glow" style={carStyle} />
          <img
            className="report-loader__car"
            src={carImage}
            alt=""
            aria-hidden="true"
            style={carStyle}
          />
        </div>

        <div className="report-loader__bottom">
          <span className="report-loader__pulse" />
          <span className="report-loader__status">{currentStage}</span>
          <span className="report-loader__meter">
            <span style={{ width: `${progress}%` }} />
          </span>
          <span className="report-loader__divider" />
          <span className="report-loader__time">{formatElapsed(elapsedMs)}</span>
        </div>
      </div>
    </div>
  );
}
