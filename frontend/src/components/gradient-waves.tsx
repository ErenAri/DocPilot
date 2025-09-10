"use client";
import { useEffect, useRef } from "react";

type Props = {
  bands?: number;
  speed?: number; // radians per second
  colors?: string[]; // CSS colors per band (will fallback to cyan/sky/indigo)
  amplitude?: number; // px vertical amplitude baseline
};

// Animated gradient waves using Canvas. Optimized for dark backgrounds.
export default function GradientWaves({ bands = 3, speed = 0.6, colors, amplitude = 28 }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true }); if (!ctx) return;

    let w = 0, h = 0; const dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
      w = window.innerWidth; h = window.innerHeight;
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    const cols = colors && colors.length ? colors : ["#22d3ee", "#60a5fa", "#818cf8"]; // cyan, sky, indigo
    const bandCount = Math.max(1, bands);
    const phases = Array.from({ length: bandCount }).map((_, i) => Math.random() * Math.PI * 2);
    const amps = Array.from({ length: bandCount }).map((_, i) => amplitude * (1 - i * 0.15));
    const yBases = Array.from({ length: bandCount }).map((_, i) => h * (0.35 + i * 0.15));

    let last = performance.now();
    function draw(ts: number) {
      const dt = (ts - last) / 1000;
      last = ts;
      for (let i = 0; i < bandCount; i++) phases[i] += speed * dt * (0.7 + i * 0.2);

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter"; // soft add
      for (let i = 0; i < bandCount; i++) {
        const color = cols[i % cols.length];
        const amp = amps[i];
        const base = yBases[i];
        const phase = phases[i];

        // Build path across width
        ctx.beginPath();
        ctx.moveTo(0, base);
        const steps = 24;
        for (let s = 1; s <= steps; s++) {
          const x = (s / steps) * w;
          const y = base + Math.sin(phase + s * 0.6) * amp * (1 - s / (steps + 2));
          ctx.lineTo(x, y);
        }
        // close to bottom for fill
        ctx.lineTo(w, h + 20);
        ctx.lineTo(0, h + 20);
        ctx.closePath();

        const grad = ctx.createLinearGradient(0, base - amp, 0, base + amp * 2);
        grad.addColorStop(0, color + "22");
        grad.addColorStop(0.5, color + "33");
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      rafRef.current = requestAnimationFrame(draw);
    }
    rafRef.current = requestAnimationFrame(draw);

    function cleanup() { if (rafRef.current) cancelAnimationFrame(rafRef.current); window.removeEventListener("resize", resize); }
    return cleanup;
  }, [bands, speed, colors, amplitude]);

  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-0" aria-hidden />;
}


