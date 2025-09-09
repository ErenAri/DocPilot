"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function InsightsCard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/analytics/insights`);
      const j = await res.json();
      setData(j);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  return (
    <Card className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-xl">
      <CardHeader>
        <CardTitle className="text-xl font-bold tracking-tight">Insights</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white/5 rounded p-3">
            <div className="opacity-70">Hit Rate (7d)</div>
            <div className="text-lg font-semibold">{data?.hit_rate !== null && data?.hit_rate !== undefined ? `${Math.round(data.hit_rate * 100)}%` : '-'}</div>
          </div>
          <div className="bg-white/5 rounded p-3 col-span-2">
            <div className="opacity-70 mb-1">Top Intents</div>
            <div className="flex flex-wrap gap-2">
              {(data?.intents || []).slice(0,6).map((x:any) => (
                <span key={x.intent} className="px-2 py-1 rounded bg-white/10 border border-white/10">{x.intent}: {x.count}</span>
              ))}
            </div>
          </div>
        </div>
        <div>
          <div className="opacity-70 mb-1">Confidence (24h)</div>
          <MiniLine data={(data?.confidence_heatmap || []).map((r:any) => r.avg_conf || 0)} />
        </div>
        <Button onClick={refresh} disabled={loading} className="w-full bg-white/10 hover:bg-white/15">Refresh</Button>
      </CardContent>
    </Card>
  );
}

function MiniLine({ data }: { data: number[] }) {
  const w=260, h=46, p=4; const max = Math.max(1, ...data);
  const pts = data.map((v,i)=>{
    const x = p + i*(w-2*p)/Math.max(1,data.length-1);
    const y = h-p - (v/max)*(h-2*p);
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={w} height={h}>
      <polyline fill="none" stroke="url(#g2)" strokeWidth="2" points={pts} />
      <defs>
        <linearGradient id="g2" x1="0" x2="1"><stop offset="0%" stopColor="#6366f1"/><stop offset="100%" stopColor="#a855f7"/></linearGradient>
      </defs>
    </svg>
  );
}


