"use client";
import { useEffect, useRef } from "react";

type Props = {
  particles?: number;
  maxSpeed?: number;
  color?: string;
  connectDist?: number;
};

export default function BackgroundCanvas({ particles = 90, maxSpeed = 0.35, color = "#22d3ee", connectDist = 110 }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let width = 0, height = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    type P = { x: number; y: number; vx: number; vy: number; r: number };
    const pts: P[] = Array.from({ length: particles }).map(() => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() * 2 - 1) * maxSpeed,
      vy: (Math.random() * 2 - 1) * maxSpeed,
      r: 1 + Math.random() * 1.6,
    }));

    const stroke = color;
    const fill = color + "33"; // subtle alpha
    const lineBaseAlpha = 0.12;

    let lastTs = performance.now();
    function step(ts: number) {
      const dt = Math.min(32, ts - lastTs);
      lastTs = ts;
      // clear
      ctx.clearRect(0, 0, width, height);

      // update & draw points
      for (const p of pts) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.x < -20) p.x = width + 20;
        if (p.x > width + 20) p.x = -20;
        if (p.y < -20) p.y = height + 20;
        if (p.y > height + 20) p.y = -20;
        ctx.beginPath();
        ctx.fillStyle = fill;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // connect close points
      ctx.strokeStyle = stroke;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i], b = pts[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d < connectDist) {
            const alpha = lineBaseAlpha * (1 - d / connectDist);
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }
      }

      rafRef.current = requestAnimationFrame(step);
    }

    function handleVisibility() {
      if (document.hidden) {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      } else if (!rafRef.current) {
        lastTs = performance.now();
        rafRef.current = requestAnimationFrame(step);
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    rafRef.current = requestAnimationFrame(step);

    return () => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [particles, maxSpeed, color, connectDist]);

  return <canvas ref={ref} className="absolute inset-0" aria-hidden />;
}


