import { useEffect, useMemo, useRef, useState } from 'react';
import carImage from '../../assets/report-loader-car.png';
import './ReportBuildLoader.css';

type CheckpointLabelAlign = 'start' | 'end';

type Checkpoint = {
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
    at: 0,
    key: 'start',
    title: 'Портал',
    description: 'Подключение',
    labelX: 18,
    labelY: -58,
    align: 'start',
  },
  {
    at: 0.12,
    key: 'filters',
    title: 'Фильтры',
    description: 'Каталог отчета',
    labelX: -8,
    labelY: -64,
    align: 'start',
  },
  {
    at: 0.25,
    key: 'crm',
    title: 'CRM',
    description: 'Данные портала',
    labelX: -10,
    labelY: 34,
    align: 'start',
  },
  {
    at: 0.39,
    key: 'activity',
    title: 'Активность',
    description: 'Звонки и задачи',
    labelX: -24,
    labelY: -58,
    align: 'start',
  },
  {
    at: 0.53,
    key: 'deals',
    title: 'Сделки',
    description: 'Счета и план-факт',
    labelX: -20,
    labelY: 36,
    align: 'start',
  },
  {
    at: 0.68,
    key: 'metrics',
    title: 'Метрики',
    description: 'Агрегация',
    labelX: -16,
    labelY: -56,
    align: 'start',
  },
  {
    at: 0.82,
    key: 'charts',
    title: 'Графики',
    description: 'Построение',
    labelX: -22,
    labelY: 36,
    align: 'start',
  },
  {
    at: 0.92,
    key: 'render',
    title: 'Рендер',
    description: 'Подготовка',
    labelX: -96,
    labelY: -50,
    align: 'end',
  },
  {
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
const GRID_SIZE = 42;
const MIN_SCENE_WIDTH = 320;
const MIN_SCENE_HEIGHT = 220;
const FALLBACK_SCENE_SIZE = { width: 1000, height: 560 };
const ROUTE_COLUMN_RATIOS = [0, 0.1, 0.19, 0.32, 0.42, 0.54, 0.68, 0.84, 0.98];
const ROUTE_ROWS_FROM_BOTTOM = [1, 1, 1, 3, 2, 4, 5, 6, 7];

type SceneSize = {
  width: number;
  height: number;
};

type RoutePoint = {
  x: number;
  y: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildRoutePoints({ width, height }: SceneSize): RoutePoint[] {
  const usableWidth = Math.max(MIN_SCENE_WIDTH, width);
  const usableHeight = Math.max(MIN_SCENE_HEIGHT, height);
  const maxColumn = Math.max(5, Math.floor(usableWidth / GRID_SIZE));
  const bottomRow = Math.max(4, Math.floor(usableHeight / GRID_SIZE));
  let previousColumn = -1;

  return ROUTE_COLUMN_RATIOS.map((ratio, index) => {
    const rawColumn = index === 0 ? 0 : Math.round(maxColumn * ratio);
    const column = index === 0 ? 0 : clamp(rawColumn, previousColumn + 1, maxColumn);
    const rowsFromBottom = clamp(ROUTE_ROWS_FROM_BOTTOM[index], 1, bottomRow - 1);

    previousColumn = column;

    return {
      x: column * GRID_SIZE,
      y: (bottomRow - rowsFromBottom) * GRID_SIZE,
    };
  });
}

function buildRoutePath(points: RoutePoint[]) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
}

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
  const [sceneSize, setSceneSize] = useState<SceneSize>(FALLBACK_SCENE_SIZE);
  const routePoints = useMemo(() => buildRoutePoints(sceneSize), [sceneSize]);
  const routePath = useMemo(() => buildRoutePath(routePoints), [routePoints]);
  const baselineY = Math.floor(Math.max(MIN_SCENE_HEIGHT, sceneSize.height) / GRID_SIZE) * GRID_SIZE;
  const axisEndX = Math.floor(Math.max(MIN_SCENE_WIDTH, sceneSize.width) / GRID_SIZE) * GRID_SIZE;

  useEffect(() => {
    const scene = sceneRef.current;

    if (!scene) {
      return undefined;
    }

    const updateSceneSize = () => {
      const rect = scene.getBoundingClientRect();

      setSceneSize((current) => {
        const nextWidth = Math.round(rect.width);
        const nextHeight = Math.round(rect.height);

        if (current.width === nextWidth && current.height === nextHeight) {
          return current;
        }

        return {
          width: nextWidth,
          height: nextHeight,
        };
      });
    };

    updateSceneSize();

    const resizeObserver = new ResizeObserver(updateSceneSize);
    resizeObserver.observe(scene);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    const route = routeRef.current;
    const trace = traceRef.current;
    const scene = sceneRef.current;
    const car = carRef.current;
    const glow = carGlowRef.current;

    if (!route || !scene || !car || !glow) {
      return undefined;
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let length = route.getTotalLength();
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
      length = route.getTotalLength();
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
  }, [routePath]);

  const rootClassName = ['report-loader', className].filter(Boolean).join(' ');
  const activatedCheckpointCount = Math.max(
    1,
    CHECKPOINTS.filter((point) => cycleProgress >= point.at - 0.018).length,
  );
  const svgWidth = Math.max(MIN_SCENE_WIDTH, sceneSize.width);
  const svgHeight = Math.max(MIN_SCENE_HEIGHT, sceneSize.height);
  const firstRoutePoint = routePoints[0];
  const lastRoutePoint = routePoints[routePoints.length - 1];
  const chartAreaPath = `${routePath} L${lastRoutePoint.x} ${baselineY} L${firstRoutePoint.x} ${baselineY} Z`;

  return (
    <div className={rootClassName} role="status" aria-live="polite" aria-label="Строим отчет">
      <div className="report-loader__card">
        <span className="report-loader__sr-status" aria-live="polite">
          Строим отчет
        </span>
        <div className="report-loader__stage" aria-hidden="true">
          <div className="report-loader__scene" ref={sceneRef}>
            <svg className="report-loader__map" viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
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
              <line className="report-loader__axis" x1="0" y1={baselineY} x2={axisEndX} y2={baselineY} />
              <line className="report-loader__axis" x1="0" y1={GRID_SIZE} x2="0" y2={baselineY} />
              <path className="report-loader__ghost-chart" d={routePath} />
              <path className="report-loader__route-shadow" d={routePath} />
              <path className="report-loader__route-base" d={routePath} />
              <path ref={routeRef} className="report-loader__route-progress" d={routePath} />
              <path className="report-loader__chart-area" d={chartAreaPath} />
              <path ref={traceRef} className="report-loader__chart-line" d={routePath} />

              {CHECKPOINTS.map((point, index) => (
                <g
                  className={`report-loader__checkpoint ${index < activatedCheckpointCount ? 'is-active' : ''}`}
                  key={point.key}
                  transform={`translate(${routePoints[index].x} ${routePoints[index].y})`}
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
