"use client";
import { useEffect, useRef } from "react";

export default function Confetti({ trigger }: { trigger: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!trigger) return;
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    let w = window.innerWidth, h = window.innerHeight, dpr = Math.min(devicePixelRatio || 1, 2);
    function resize() {
      w = window.innerWidth; h = window.innerHeight;
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const onR = () => resize();
    window.addEventListener("resize", onR);

    const colors = ["#22d3ee", "#60a5fa", "#a78bfa", "#34d399", "#f59e0b"]; 
    type C = { x:number;y:number;vx:number;vy:number;rot:number;vr:number;size:number;color:string;life:number };
    const parts: C[] = Array.from({ length: 120 }).map(() => ({
      x: w * 0.5 + (Math.random() * 80 - 40), y: h * 0.15 + (Math.random() * 20 - 10),
      vx: (Math.random() * 2 - 1) * 2.2, vy: (Math.random() * -2 - 2.5),
      rot: Math.random() * Math.PI, vr: (Math.random() * 2 - 1) * 0.2,
      size: 5 + Math.random() * 7, color: colors[Math.floor(Math.random() * colors.length)], life: 1
    }));

    let raf = 0; const g = 0.05, drag = 0.995;
    const start = performance.now();
    function step(t: number) {
      ctx.clearRect(0,0,w,h);
      for (const p of parts) {
        p.vx *= drag; p.vy = p.vy * drag + g; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life *= 0.994;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color; ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
        ctx.restore();
      }
      if (performance.now() - start < 2400) raf = requestAnimationFrame(step);
      else cleanup();
    }
    function cleanup(){ cancelAnimationFrame(raf); window.removeEventListener("resize", onR); if (canvas.parentElement) canvas.parentElement.removeChild(canvas); }
    raf = requestAnimationFrame(step);
    return cleanup;
  }, [trigger]);
  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-40" />;
}


