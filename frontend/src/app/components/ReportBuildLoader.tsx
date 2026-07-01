import { useEffect, useRef, useState } from 'react';
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
    x: 56,
    y: 492,
    at: 0,
    key: 'start',
    title: 'Портал',
    description: 'Подключение',
    labelX: 18,
    labelY: -58,
    align: 'start',
  },
  {
    x: 164,
    y: 454,
    at: 0.12,
    key: 'filters',
    title: 'Фильтры',
    description: 'Каталог отчета',
    labelX: -8,
    labelY: -64,
    align: 'start',
  },
  {
    x: 276,
    y: 476,
    at: 0.25,
    key: 'crm',
    title: 'CRM',
    description: 'Данные портала',
    labelX: -10,
    labelY: 34,
    align: 'start',
  },
  {
    x: 394,
    y: 354,
    at: 0.39,
    key: 'activity',
    title: 'Активность',
    description: 'Звонки и задачи',
    labelX: -24,
    labelY: -58,
    align: 'start',
  },
  {
    x: 508,
    y: 384,
    at: 0.53,
    key: 'deals',
    title: 'Сделки',
    description: 'Счета и план-факт',
    labelX: -20,
    labelY: 36,
    align: 'start',
  },
  {
    x: 628,
    y: 252,
    at: 0.68,
    key: 'metrics',
    title: 'Метрики',
    description: 'Агрегация',
    labelX: -16,
    labelY: -56,
    align: 'start',
  },
  {
    x: 748,
    y: 186,
    at: 0.82,
    key: 'charts',
    title: 'Графики',
    description: 'Построение',
    labelX: -22,
    labelY: 36,
    align: 'start',
  },
  {
    x: 862,
    y: 104,
    at: 0.92,
    key: 'render',
    title: 'Рендер',
    description: 'Подготовка',
    labelX: -96,
    labelY: -50,
    align: 'end',
  },
  {
    x: 948,
    y: 58,
    at: 0.98,
    key: 'ready',
    title: 'Отчет',
    description: 'Почти готов',
    labelX: -128,
    labelY: 28,
    align: 'end',
  },
];

const LOOP_MS = 12800;
const LOOP_HOLD_MS = 1200;
const LOOK_AHEAD_LENGTH = 16;
const ROUTE_PATH =
  'M56 492 L164 454 L276 476 L394 354 L508 384 L628 252 L748 186 L862 104 L948 58';

type ReportBuildLoaderProps = {
  className?: string;
};

export default function ReportBuildLoader({ className = '' }: ReportBuildLoaderProps) {
  const routeRef = useRef<SVGPathElement | null>(null);
  const traceRef = useRef<SVGPathElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const carRef = useRef<HTMLImageElement | null>(null);
  const carGlowRef = useRef<HTMLSpanElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [cycleProgress, setCycleProgress] = useState(0);

  useEffect(() => {
    const route = routeRef.current;
    const trace = traceRef.current;
    const scene = sceneRef.current;
    const car = carRef.current;
    const glow = carGlowRef.current;

    if (!route || !scene || !car || !glow) {
      return undefined;
    }

    const length = route.getTotalLength();
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let startTime: number | null = null;
    let lastCheckpointProgress = -1;

    route.style.strokeDasharray = `${length}`;
    route.style.strokeDashoffset = `${length}`;

    if (trace) {
      trace.style.strokeDasharray = `${length}`;
      trace.style.strokeDashoffset = `${length}`;
    }

    const placeCar = (progress: number) => {
      const currentLength = progress * length;
      const point = route.getPointAtLength(currentLength);
      const aheadPoint = route.getPointAtLength(Math.min(length, currentLength + LOOK_AHEAD_LENGTH));
      const sceneRect = scene.getBoundingClientRect();
      const screenMatrix = route.getScreenCTM();

      if (!screenMatrix) {
        return;
      }

      const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(screenMatrix);
      const screenAheadPoint = new DOMPoint(aheadPoint.x, aheadPoint.y).matrixTransform(screenMatrix);
      const angle =
        Math.atan2(screenAheadPoint.y - screenPoint.y, screenAheadPoint.x - screenPoint.x) * (180 / Math.PI);
      const x = screenPoint.x - sceneRect.left;
      const y = screenPoint.y - sceneRect.top;

      car.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${angle + 90}deg)`;
      glow.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      route.style.strokeDashoffset = `${length * (1 - progress)}`;

      if (trace) {
        trace.style.strokeDashoffset = `${length * (1 - progress)}`;
      }
    };

    if (prefersReducedMotion) {
      placeCar(0.82);
      setCycleProgress(1);
      return undefined;
    }

    const animate = (timestamp: number) => {
      if (startTime === null) {
        startTime = timestamp;
      }

      const elapsed = timestamp - startTime;
      const cycle = elapsed % (LOOP_MS + LOOP_HOLD_MS);
      const rawProgress = Math.min(cycle / LOOP_MS, 1);
      const progress =
        rawProgress < 0.5
          ? 2 * rawProgress * rawProgress
          : 1 - Math.pow(-2 * rawProgress + 2, 2) / 2;

      placeCar(progress);

      if (rawProgress < lastCheckpointProgress || Math.abs(rawProgress - lastCheckpointProgress) > 0.018) {
        lastCheckpointProgress = rawProgress;
        setCycleProgress(rawProgress);
      }

      animationFrameRef.current = window.requestAnimationFrame(animate);
    };

    animationFrameRef.current = window.requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const rootClassName = ['report-loader', className].filter(Boolean).join(' ');
  const activatedCheckpointCount = Math.max(
    1,
    CHECKPOINTS.filter((point) => cycleProgress >= point.at - 0.018).length,
  );

  return (
    <div className={rootClassName} role="status" aria-live="polite" aria-label="Строим отчет">
      <div className="report-loader__card">
        <span className="report-loader__sr-status" aria-live="polite">
          Строим отчет
        </span>
        <div className="report-loader__stage" aria-hidden="true">
          <div className="report-loader__scene" ref={sceneRef}>
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
              <line className="report-loader__axis" x1="48" y1="520" x2="956" y2="520" />
              <line className="report-loader__axis" x1="48" y1="48" x2="48" y2="520" />
              <path className="report-loader__ghost-chart" d={ROUTE_PATH} />
              <path className="report-loader__route-shadow" d={ROUTE_PATH} />
              <path className="report-loader__route-base" d={ROUTE_PATH} />
              <path ref={routeRef} className="report-loader__route-progress" d={ROUTE_PATH} />
              <path className="report-loader__chart-area" d={`${ROUTE_PATH} L948 520 L56 520 Z`} />
              <path ref={traceRef} className="report-loader__chart-line" d={ROUTE_PATH} />

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
                      <span className="report-loader__checkpoint-label-title">{point.title}</span>
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
            <span className="report-loader__car-glow" ref={carGlowRef} />
            <img ref={carRef} className="report-loader__car" src={carImage} alt="" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}
