import { useEffect, useRef } from 'react';

const CANVAS_W = 400;
const CANVAS_H = 200;
const GROUND_Y = CANVAS_H - 30;

// Corporate colors for the chart line
const CHART_COLORS = ['#2274ff', '#28a766', '#7c5cff', '#f5a623', '#ec4899'];

// Pre-generate chart data points (y values going up and down like a real chart)
const NUM_POINTS = 100;
function generateChartData(): number[] {
  const data: number[] = [];
  for (let i = 0; i < NUM_POINTS; i++) {
    const x = (i / NUM_POINTS) * Math.PI * 5;
    const y =
      55 +
      Math.sin(x) * 22 +
      Math.sin(x * 2.7 + 0.5) * 12 +
      Math.sin(x * 0.6 + 1.8) * 10 +
      (i > NUM_POINTS * 0.7 ? Math.sin((i / NUM_POINTS) * Math.PI * 8) * 6 : 0);
    data.push(Math.max(10, Math.min(100, y)));
  }
  return data;
}

const CHART_DATA = generateChartData();

interface LoadingAnimationProps {
  isLoading: boolean;
  targetProgress: number; // 0..1
  onComplete?: () => void;
}

export default function LoadingAnimation({
  isLoading,
  targetProgress,
  onComplete,
}: LoadingAnimationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);
  const timeRef = useRef(0);
  const completedRef = useRef(false);

  useEffect(() => {
    if (!isLoading) {
      completedRef.current = false;
      timeRef.current = 0;
    }
  }, [isLoading]);

  useEffect(() => {
    if (!isLoading) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const chartStartX = 40;
    const chartEndX = CANVAS_W - 40;
    const chartRangeX = chartEndX - chartStartX;

    const draw = (timestamp: number) => {
      if (!timeRef.current) timeRef.current = timestamp;
      timeRef.current = timestamp;

      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

      // Background
      ctx.fillStyle = '#f8faff';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // Subtle horizontal grid lines
      ctx.strokeStyle = '#e8ecf3';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      for (let y = 30; y < GROUND_Y; y += 28) {
        ctx.beginPath();
        ctx.moveTo(20, y);
        ctx.lineTo(CANVAS_W - 20, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Ground line
      ctx.strokeStyle = '#d0d5e0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(20, GROUND_Y);
      ctx.lineTo(CANVAS_W - 20, GROUND_Y);
      ctx.stroke();

      // Calculate stickman X position (walks left to right)
      const stickmanX = 35 + (CANVAS_W - 70) * targetProgress;

      // Calculate visible chart points based on progress
      const visibleCount = Math.floor(NUM_POINTS * targetProgress);

      // --- Draw chart line behind the stickman ---
      if (visibleCount > 1) {
        // Gradient line using corporate colors
        const gradient = ctx.createLinearGradient(0, 0, CANVAS_W, 0);
        CHART_COLORS.forEach((c, i) => {
          gradient.addColorStop(i / (CHART_COLORS.length - 1), c);
        });

        // Filled area under the chart (very subtle)
        ctx.fillStyle = 'rgba(34, 116, 255, 0.05)';
        ctx.beginPath();
        ctx.moveTo(chartStartX, GROUND_Y);
        for (let i = 0; i <= visibleCount && i < NUM_POINTS; i++) {
          const px = chartStartX + (i / NUM_POINTS) * chartRangeX;
          const py = GROUND_Y - CHART_DATA[i];
          ctx.lineTo(px, py);
        }
        ctx.lineTo(chartStartX + (visibleCount / NUM_POINTS) * chartRangeX, GROUND_Y);
        ctx.closePath();
        ctx.fill();

        // Main chart line
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 3.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.shadowColor = 'rgba(34, 116, 255, 0.15)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        for (let i = 0; i <= visibleCount && i < NUM_POINTS; i++) {
          const px = chartStartX + (i / NUM_POINTS) * chartRangeX;
          const py = GROUND_Y - CHART_DATA[i];
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Data point dots
        const dotStep = Math.max(1, Math.floor(NUM_POINTS / 20));
        for (let i = 0; i <= visibleCount; i += dotStep) {
          const px = chartStartX + (i / NUM_POINTS) * chartRangeX;
          const py = GROUND_Y - CHART_DATA[i];
          const colorIdx = Math.floor((i / NUM_POINTS) * CHART_COLORS.length);
          const dotColor = CHART_COLORS[Math.min(colorIdx, CHART_COLORS.length - 1)];

          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = dotColor;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // --- Draw stickman from behind (walks left to right) ---
      const walkPhase = (timestamp / 500) % 1;
      drawStickmanBack(ctx, stickmanX, GROUND_Y, walkPhase);

      // Completion check
      if (targetProgress >= 1 && !completedRef.current) {
        completedRef.current = true;
        // Subtle completion pulse
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = '#22c55e';
        ctx.font = '32px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✓', CANVAS_W / 2 - 16, CANVAS_H / 2 - 2);
        ctx.fillStyle = '#166534';
        ctx.font = '13px sans-serif';
        ctx.fillText('График построен', CANVAS_W / 2 + 20, CANVAS_H / 2 + 2);
        onComplete?.();
      }

      const animFrame = requestAnimationFrame(draw);
      frameRef.current = animFrame;
    };

    frameRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frameRef.current);
      timeRef.current = 0;
    };
  }, [isLoading, targetProgress, onComplete]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      style={{
        width: '100%',
        height: `${CANVAS_H}px`,
        display: isLoading ? 'block' : 'none',
        borderRadius: '8px',
        background: '#f8faff',
      }}
    />
  );
}

/**
 * Draw a stickman from behind (back view).
 * Gray silhouette, seen from behind, walking in place.
 */
function drawStickmanBack(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  walkPhase: number,
) {
  const headR = 8;
  const bodyW = 14;
  const bodyH = 24;
  const legLen = 16;
  const armLen = 14;

  // Walk cycle
  const legSwing = Math.sin(walkPhase * Math.PI * 2) * 4;
  const armSwing = Math.sin(walkPhase * Math.PI * 2 + Math.PI) * 3;
  const bounce = Math.abs(Math.sin(walkPhase * Math.PI * 2)) * 1.5;

  // Y positions
  const footBaseY = groundY;
  const bodyBottomY = footBaseY - legLen + bounce;
  const bodyTopY = bodyBottomY - bodyH;
  const neckY = bodyTopY;
  const headCenterY = neckY - headR;

  // ---- Legs ----
  ctx.strokeStyle = '#7a8496';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(x - 4, bodyBottomY);
  ctx.lineTo(x - 4 + legSwing, footBaseY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x + 4, bodyBottomY);
  ctx.lineTo(x + 4 - legSwing * 0.8, footBaseY);
  ctx.stroke();

  // ---- Feet (small horizontal lines) ----
  ctx.strokeStyle = '#6b7484';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x - 4 + legSwing - 4, footBaseY);
  ctx.lineTo(x - 4 + legSwing + 4, footBaseY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x + 4 - legSwing * 0.8 - 4, footBaseY);
  ctx.lineTo(x + 4 - legSwing * 0.8 + 4, footBaseY);
  ctx.stroke();

  // ---- Body (torso from behind - filled rectangle with rounded top) ----
  ctx.fillStyle = '#7a8496';
  ctx.beginPath();
  ctx.roundRect(x - bodyW / 2, bodyTopY, bodyW, bodyH, 3);
  ctx.fill();

  // Subtle spine line
  ctx.strokeStyle = '#6b7484';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, bodyTopY + 4);
  ctx.lineTo(x, bodyBottomY - 4);
  ctx.stroke();

  // ---- Arms (from behind, hanging at sides, slight swing) ----
  ctx.strokeStyle = '#7a8496';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';

  const shoulderY = bodyTopY + 4;

  // Left arm
  ctx.beginPath();
  ctx.moveTo(x - bodyW / 2, shoulderY);
  ctx.lineTo(x - bodyW / 2 - 2 - armSwing, shoulderY + armLen);
  ctx.stroke();

  // Right arm
  ctx.beginPath();
  ctx.moveTo(x + bodyW / 2, shoulderY);
  ctx.lineTo(x + bodyW / 2 + 2 + armSwing, shoulderY + armLen);
  ctx.stroke();

  // ---- Head (from behind - circle with hair on top) ----
  // Neck
  ctx.fillStyle = '#7a8496';
  ctx.beginPath();
  ctx.roundRect(x - 4, neckY - 2, 8, 5, 2);
  ctx.fill();

  // Head circle (back of head)
  ctx.fillStyle = '#8a94a5';
  ctx.beginPath();
  ctx.arc(x, headCenterY + bounce, headR, 0, Math.PI * 2);
  ctx.fill();

  // Hair (on top/back of head)
  ctx.fillStyle = '#5a6575';
  ctx.beginPath();
  ctx.ellipse(x, headCenterY + bounce - 3, headR - 1, 4.5, 0, Math.PI, Math.PI * 2);
  ctx.fill();

  // Head outline
  ctx.strokeStyle = '#7a8496';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, headCenterY + bounce, headR, 0, Math.PI * 2);
  ctx.stroke();
}