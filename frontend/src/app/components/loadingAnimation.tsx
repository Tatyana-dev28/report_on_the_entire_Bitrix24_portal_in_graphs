import { useEffect, useRef } from 'react';

const STICKMAN_W = 30;
const STICKMAN_H = 50;
const BOX_W = 20;
const BOX_H = 16;
const COLUMNS = 7;
const COLUMN_GAP = 24;
const TOTAL_COLS_W = COLUMNS * COLUMN_GAP;
const CANVAS_W = Math.max(TOTAL_COLS_W + 80, 400);
const CANVAS_H = 200;
const GROUND_Y = CANVAS_H - 30;
const BOX_Y = GROUND_Y - BOX_H;
const COL_BASE_Y = GROUND_Y;

// Progress from 0..1
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

interface LoadingAnimationProps {
  isLoading: boolean;
  targetProgress: number; // 0..1 how many columns "delivered" so far
  onComplete?: () => void;
}

export default function LoadingAnimation({ isLoading, targetProgress, onComplete }: LoadingAnimationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);
  const timeRef = useRef(0);
  const animationPhaseRef = useRef(0); // 0 = walk right with box, 1 = place, 2 = walk left empty
  const animProgressRef = useRef(0); // progress within current phase 0..1
  const completedRef = useRef(false);

  useEffect(() => {
    if (!isLoading) {
      completedRef.current = false;
      animationPhaseRef.current = 0;
      animProgressRef.current = 0;
      timeRef.current = 0;
      return;
    }
  }, [isLoading]);

  useEffect(() => {
    if (!isLoading) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Number of boxes delivered based on targetProgress
    const boxesDelivered = Math.floor(targetProgress * COLUMNS);
    const currentBoxIndex = Math.min(boxesDelivered, COLUMNS - 1);

    let speed = 0.015;

    const draw = () => {
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

      // Background
      ctx.fillStyle = '#f8faff';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // Ground line
      ctx.strokeStyle = '#d0d5e0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(10, GROUND_Y);
      ctx.lineTo(CANVAS_W - 10, GROUND_Y);
      ctx.stroke();

      // Draw delivered columns
      for (let i = 0; i <= currentBoxIndex && i < COLUMNS; i++) {
        const cx = 50 + i * COLUMN_GAP + COLUMN_GAP / 2;
        const colHeight = 40 + ((i % 5) + 1) * 6;

        ctx.fillStyle = '#2274ff';
        ctx.fillRect(cx - 8, COL_BASE_Y - colHeight, 16, colHeight);
        ctx.strokeStyle = '#1860d0';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - 8, COL_BASE_Y - colHeight, 16, colHeight);
      }

      // Determine stickman position and state
      const walkSpeed = speed * 1.8;
      animProgressRef.current = (animProgressRef.current + walkSpeed) % 1;
      const ap = animProgressRef.current;

      // We'll define phases based on ap and targetProgress
      // Simpler approach: stickman runs left, picks up box, runs right, places it
      // For a smooth loop, each "delivery" takes 1 full cycle of ap

      // Determine which "cycle" we're on
      const cyclesPerformed = currentBoxIndex;
      const cycleProgress = targetProgress * COLUMNS - cyclesPerformed; // 0..1 within current delivery

      // Stickman X: oscillates
      // For each box, stickman runs from right side (near column) to left (get box), then back
      const startX = 50 + currentBoxIndex * COLUMN_GAP + COLUMN_GAP / 2;
      const boxPickupX = 30;
      const boxPlaceX = startX;

      let stickmanX: number;
      let carryBox = false;
      let placingBox = false;
      let boxX = 0;
      let boxY = 0;

      if (cycleProgress < 0.45) {
        // Walk left to pickup
        const t = cycleProgress / 0.45;
        stickmanX = lerp(boxPlaceX, boxPickupX, easeInOut(t));
        carryBox = false;
      } else if (cycleProgress < 0.55) {
        // Pickup
        stickmanX = boxPickupX;
        carryBox = true;
        placingBox = true;
        const t = (cycleProgress - 0.45) / 0.1;
        boxX = boxPickupX;
        boxY = lerp(GROUND_Y - BOX_H, GROUND_Y - STICKMAN_H - 8 - BOX_H, t);
      } else if (cycleProgress < 0.9) {
        // Walk right with box
        const t = (cycleProgress - 0.55) / 0.35;
        stickmanX = lerp(boxPickupX, boxPlaceX, easeInOut(t));
        carryBox = true;
        boxX = stickmanX;
        boxY = GROUND_Y - STICKMAN_H - 8 - BOX_H;
      } else {
        // Place box
        stickmanX = boxPlaceX;
        carryBox = true;
        placingBox = true;
        const t = (cycleProgress - 0.9) / 0.1;
        boxX = boxPlaceX;
        boxY = lerp(GROUND_Y - STICKMAN_H - 8 - BOX_H, GROUND_Y - BOX_H, t);
      }

      // Draw box if carrying
      if (carryBox) {
        ctx.fillStyle = '#f5a623';
        ctx.fillRect(boxX - BOX_W / 2, boxY, BOX_W, BOX_H);
        ctx.strokeStyle = '#c47e12';
        ctx.lineWidth = 1;
        ctx.strokeRect(boxX - BOX_W / 2, boxY, BOX_W, BOX_H);
        // Label
        ctx.fillStyle = '#1a1a2e';
        ctx.font = '7px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('B24', boxX, boxY + BOX_H / 2 + 2);
      }

      // Draw stickman
      drawStickman(ctx, stickmanX, GROUND_Y, ap);

      // Check if all delivered and show completion
      if (targetProgress >= 1 && cycleProgress > 0.95 && !completedRef.current) {
        completedRef.current = true;
        // Draw checkmark
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = '#22c55e';
        ctx.font = '48px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✅', CANVAS_W / 2 - 28, CANVAS_H / 2 - 10);
        ctx.fillStyle = '#1a1a2e';
        ctx.font = '14px sans-serif';
        ctx.fillText('✔ Миссия выполнена!', CANVAS_W / 2, CANVAS_H / 2 + 30);
        // Money bag
        ctx.font = '36px sans-serif';
        ctx.fillText('💰', CANVAS_W / 2 + 36, CANVAS_H / 2 - 12);
      }

      const animFrame = requestAnimationFrame(draw);
      frameRef.current = animFrame;
    };

    draw();

    return () => {
      cancelAnimationFrame(frameRef.current);
    };
  }, [isLoading, targetProgress]);

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

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function drawStickman(ctx: CanvasRenderingContext2D, x: number, groundY: number, walkPhase: number) {
  const headR = 7;
  const headY = groundY - STICKMAN_H + headR;
  const neckY = headY + headR + 2;
  const bodyEndY = neckY + 18;
  const legLen = 16;
  const armLen = 14;

  // Walk cycle
  const legSwing = Math.sin(walkPhase * Math.PI * 2) * 10;
  const armSwing = Math.sin(walkPhase * Math.PI * 2 + Math.PI) * 8;
  const bounce = Math.abs(Math.sin(walkPhase * Math.PI * 2)) * 2;

  // Body
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = 2.5;

  // Legs
  ctx.beginPath();
  ctx.moveTo(x, bodyEndY);
  ctx.lineTo(x + legSwing, groundY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x, bodyEndY);
  ctx.lineTo(x - legSwing * 0.7, groundY);
  ctx.stroke();

  // Body
  ctx.beginPath();
  ctx.moveTo(x, neckY + 2);
  ctx.lineTo(x, bodyEndY);
  ctx.stroke();

  // Arms
  ctx.beginPath();
  ctx.moveTo(x, neckY + 6);
  ctx.lineTo(x + armSwing + 6, neckY + 6 + armLen);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x, neckY + 6);
  ctx.lineTo(x - armSwing - 6, neckY + 6 + armLen);
  ctx.stroke();

  // Head
  ctx.fillStyle = '#ffdaa7';
  ctx.beginPath();
  ctx.arc(x, headY + bounce, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Cap (GTA style - backwards cap)
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.ellipse(x + 2, headY + bounce - 4, 8, 3, 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Cap visor
  ctx.beginPath();
  ctx.ellipse(x + 7, headY + bounce - 3, 5, 2, 0.1, 0, Math.PI);
  ctx.fill();

  // Backpack
  ctx.fillStyle = '#4a5568';
  ctx.beginPath();
  ctx.roundRect(x - 6, neckY + 1, 5, 12, 2);
  ctx.fill();

  // Eyes
  ctx.fillStyle = '#1a1a2e';
  ctx.beginPath();
  ctx.arc(x - 2, headY + bounce - 1, 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 3, headY + bounce - 1, 1.2, 0, Math.PI * 2);
  ctx.fill();
}