import { useEffect, useState } from 'react';
import carImage from '../../assets/report-loader-car.png';
import './ReportBuildLoader.css';

type CheckpointLabelAlign = 'start' | 'end';

type Checkpoint = {
  x: number;
  y: number;
  at: number;
  key: string;
  title: string;
  description: string;
  labelX: number;
  labelY: number;
  align: CheckpointLabelAlign;
};

const CHECKPOINTS: Checkpoint[] = [
  {
    x: 150,
    y: 420,
    at: 0,
    key: 'start',
    title: 'Портал',
    description: 'Подключение',
    labelX: 14,
    labelY: -42,
    align: 'start',
  },
  {
    x: 240,
    y: 388,
    at: 0.12,
    key: 'filters',
    title: 'Фильтры',
    description: 'Каталог отчета',
    labelX: -18,
    labelY: -56,
    align: 'start',
  },
  {
    x: 330,
    y: 408,
    at: 0.25,
    key: 'crm',
    title: 'CRM',
    description: 'Данные портала',
    labelX: -10,
    labelY: 34,
    align: 'start',
  },
  {
    x: 430,
    y: 326,
    at: 0.39,
    key: 'activity',
    title: 'Активность',
    description: 'Звонки и задачи',
    labelX: -24,
    labelY: -58,
    align: 'start',
  },
  {
    x: 520,
    y: 344,
    at: 0.53,
    key: 'deals',
    title: 'Сделки',
    description: 'Счета и план-факт',
    labelX: -20,
    labelY: 36,
    align: 'start',
  },
  {
    x: 610,
    y: 266,
    at: 0.68,
    key: 'metrics',
    title: 'Метрики',
    description: 'Агрегация',
    labelX: -16,
    labelY: -56,
    align: 'start',
  },
  {
    x: 700,
    y: 220,
    at: 0.82,
    key: 'charts',
    title: 'Графики',
    description: 'Построение',
    labelX: -22,
    labelY: 36,
    align: 'start',
  },
  {
    x: 790,
    y: 170,
    at: 0.92,
    key: 'render',
    title: 'Рендер',
    description: 'Подготовка',
    labelX: -96,
    labelY: -50,
    align: 'end',
  },
  {
    x: 870,
    y: 138,
    at: 0.98,
    key: 'ready',
    title: 'Отчет',
    description: 'Почти готов',
    labelX: -102,
    labelY: 26,
    align: 'end',
  },
];

const STAGES = [
  { at: 0, text: 'Подключаем портал Bitrix24' },
  { at: 0.12, text: 'Загружаем каталог и фильтры' },
  { at: 0.25, text: 'Получаем данные CRM' },
  { at: 0.39, text: 'Подтягиваем звонки и задачи' },
  { at: 0.53, text: 'Сверяем счета и сделки' },
  { at: 0.68, text: 'Агрегируем метрики' },
  { at: 0.82, text: 'Строим графики' },
  { at: 0.92, text: 'Готовим отчет к показу' },
];

const LOOP_MS = 12800;
const ROUTE_PATH = 'M150 420 L240 388 L330 408 L430 326 L520 344 L610 266 L700 220 L790 170 L870 138';

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

  const currentStage =
    STAGES.reduce((current, stage) => {
      return cycleProgress >= stage.at ? stage : current;
    }, STAGES[0]);

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
          <div className="report-loader__scene">
            <svg className="report-loader__map" viewBox="0 0 1000 560" preserveAspectRatio="xMidYMid meet">
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
              <line className="report-loader__axis" x1="140" y1="456" x2="880" y2="456" />
              <line className="report-loader__axis" x1="140" y1="118" x2="140" y2="456" />
              <path className="report-loader__ghost-chart" d={ROUTE_PATH} />
              <path className="report-loader__route-shadow" d={ROUTE_PATH} />
              <path className="report-loader__route-base" d={ROUTE_PATH} />
              <path className="report-loader__route-progress" d={ROUTE_PATH} pathLength={1} />
              <path className="report-loader__chart-area" d={`${ROUTE_PATH} L870 456 L150 456 Z`} />
              <path className="report-loader__chart-line" d={ROUTE_PATH} />

              {CHECKPOINTS.map((point, index) => (
                <g
                  className={`report-loader__checkpoint ${index < activatedCheckpointCount ? 'is-active' : ''}`}
                  key={point.key}
                  transform={`translate(${point.x} ${point.y})`}
                >
                  <circle className="report-loader__checkpoint-halo" r="15" />
                  <circle className="report-loader__checkpoint-ring" r="18" />
                  <circle className="report-loader__checkpoint-core" r="5.6" />
                  <path className="report-loader__checkpoint-tick" d="M-4 0 L-1 3 L5 -4" />
                  <foreignObject
                    className="report-loader__checkpoint-label-wrap"
                    x={point.labelX}
                    y={point.labelY}
                    width="132"
                    height="54"
                  >
                    <div
                      className={`report-loader__checkpoint-label report-loader__checkpoint-label--${point.align}`}
                    >
                      <span className="report-loader__checkpoint-label-title">
                        {point.title}
                      </span>
                      <span className="report-loader__checkpoint-label-description">
                        {point.description}
                      </span>
                    </div>
                  </foreignObject>
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
        </div>

        <div className="report-loader__bottom">
          <span className="report-loader__pulse" />
          <span className="report-loader__status">{currentStage.text}</span>
        </div>
      </div>
    </div>
  );
}