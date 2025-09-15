"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";

export function AnalyticsCard() {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [series, setSeries] = useState<Array<{ bucket: string; total: number; avg_latency: number }>>([]);

  async function refresh() {
    setLoading(true);
    try {
      const res = await apiFetch(`/analytics/summary`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSummary(data.summary || data);
      const ts = await apiFetch(`/analytics/timeseries`);
      if (ts.ok) {
        const j = await ts.json();
        setSeries(j.rows || []);
      }
    } catch (e: any) {
      toast.error(`Analytics fetch failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <Card className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-xl">
      <CardHeader>
        <CardTitle className="text-xl font-bold tracking-tight">Analytics</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/5 rounded-lg p-3">
            <div className="opacity-70">Total</div>
            <div className="text-lg font-semibold">{summary?.total ?? "-"}</div>
          </div>
          <div className="bg-white/5 rounded-lg p-3">
            <div className="opacity-70">Avg Latency</div>
            <div className="text-lg font-semibold">{summary?.avg_latency ? `${Math.round(summary.avg_latency)} ms` : "-"}</div>
          </div>
          <div className="bg-white/5 rounded-lg p-3">
            <div className="opacity-70">Query</div>
            <div className="text-lg font-semibold">{summary?.query_count ?? "-"}</div>
          </div>
          <div className="bg-white/5 rounded-lg p-3">
            <div className="opacity-70">Answer</div>
            <div className="text-lg font-semibold">{summary?.answer_count ?? "-"}</div>
          </div>
        </div>
        <Button onClick={refresh} disabled={loading} className="mt-1 w-full bg-white/10 hover:bg-white/15">
          Refresh
        </Button>
        {!!series.length && (
          <div className="mt-2">
            <div className="opacity-70 mb-1">Last 24h Latency</div>
            <Sparkline data={series.map((r) => r.avg_latency || 0)} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Sparkline({ data }: { data: number[] }) {
  const w = 240; const h = 40;
  const pad = 4;
  const max = Math.max(1, ...data);
  const pts = data.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / Math.max(1, data.length - 1);
    const y = h - pad - (v / max) * (h - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} className="block">
      <polyline fill="none" stroke="url(#g)" strokeWidth="2" points={pts} />
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
    </svg>
  );
}


