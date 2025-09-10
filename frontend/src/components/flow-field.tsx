"use client";
import { useEffect, useRef } from "react";

type Props = {
  particles?: number;
  fade?: number; // 0..1: trail fade per frame (higher = faster clear)
  scale?: number; // field scale (cell size influence)
  speed?: number; // base particle speed
  color?: string; // stroke color
};

// Flow-field background with lightweight pseudo-noise (no deps)
export default function FlowField({ particles = 900, fade = 0.06, scale = 0.0026, speed = 0.9, color = "#22d3ee" }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;

    let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
      w = window.innerWidth; h = window.innerHeight;
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "rgba(0,0,0,0)";
    }
    resize();
    const onR = () => resize();
    window.addEventListener("resize", onR);

    // Pseudo noise: smoothly varying angle via sin/cos blend
    function angleAt(x: number, y: number, t: number) {
      const nx = x * scale, ny = y * scale;
      const a = Math.sin(nx + t * 0.15) + Math.cos(ny * 1.3 - t * 0.12);
      const b = Math.sin((nx + ny) * 0.7 - t * 0.08);
      return (a + b) * Math.PI; // [-2pi, 2pi]
    }

    type P = { x: number; y: number; vx: number; vy: number };
    const pts: P[] = Array.from({ length: particles }).map(() => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: 0,
      vy: 0,
    }));

    ctx.lineWidth = 1;
    ctx.strokeStyle = color;
    let last = performance.now();
    function step(ts: number) {
      const dt = Math.min(40, ts - last) / 16.6667; // ~frames
      last = ts;
      // Fade trails
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `rgba(0,0,0,${fade})`;
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = color;
      for (const p of pts) {
        const ang = angleAt(p.x, p.y, ts * 0.001);
        const ax = Math.cos(ang), ay = Math.sin(ang);
        p.vx = p.vx * 0.9 + ax * speed;
        p.vy = p.vy * 0.9 + ay * speed;
        const nx = p.x + p.vx * dt;
        const ny = p.y + p.vy * dt;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        p.x = nx; p.y = ny;
        if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10; if (p.y > h + 10) p.y = -10;
      }
      rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);

    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); window.removeEventListener("resize", onR); };
  }, [particles, fade, scale, speed, color]);

  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-0" aria-hidden />;
}


