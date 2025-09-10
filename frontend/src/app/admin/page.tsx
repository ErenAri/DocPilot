"use client";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import BackgroundCanvas from "@/components/background-canvas";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";

type LiveRow = { ts: string; query: string; latency_ms: number | null };
type QpmRow = { minute: string; count: number };
type MetricsResponse = { live_feed: LiveRow[]; qpm: QpmRow[]; avg_rating: number | null };
type Summary = { total?: number; avg_latency?: number | null };
type GoldRow = { ts: string; match_score?: number | null; passed?: boolean; query?: string; keyword_recall?: number | null; ndcg?: number | null };
type GoldLatest = { status?: string; rows?: GoldRow[] };
type Insights = { status?: string; confidence_heatmap?: { bucket: string; avg_conf: number | null }[] };

function formatTwoDecimals(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return Number(value).toFixed(2);
}

function buildLast10MinutesSeries(source: QpmRow[]): { minute: string; count: number }[] {
  const now = new Date();
  const buckets: { minute: string; count: number }[] = [];
  const srcMap = new Map(source.map((r) => [r.minute, r.count]));
  for (let i = 9; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 60_000);
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    buckets.push({ minute: label, count: srcMap.get(label) ?? 0 });
  }
  return buckets;
}

export default function AdminPage() {
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [gold, setGold] = useState<GoldLatest | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      const [r1, r2, r3, r4] = await Promise.all([
        apiFetch(`/api/v1/analytics/dashboard-metrics`, { timeoutMs: 8000 }),
        apiFetch(`/analytics/summary`, { timeoutMs: 8000 }),
        apiFetch(`/analytics/gold/latest`, { timeoutMs: 8000 }),
        apiFetch(`/analytics/insights`, { timeoutMs: 8000 }),
      ]);
      if (!r1.ok) throw new Error(await r1.text());
      const j1 = (await r1.json()) as MetricsResponse;
      setData(j1);
      try {
        if (r2.ok) {
          const j2 = await r2.json();
          setSummary(j2?.summary || null);
        }
      } catch {}
      try {
        if (r3.ok) {
          const j3 = (await r3.json()) as GoldLatest;
          setGold(j3);
        }
      } catch {}
      try {
        if (r4.ok) {
          const j4 = (await r4.json()) as Insights;
          setInsights(j4);
        }
      } catch {}
    } catch (e: any) {
      setError(e?.message || "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Redirect to login if no token present
    if (typeof window !== "undefined") {
      const tok = localStorage.getItem("docpilot_token");
      if (!tok) {
        window.location.href = "/login";
        return;
      }
    }
    let stopped = false;
    const poll = () => {
      if (document.visibilityState === 'visible') load();
    };
    load();
    const id = setInterval(poll, 3000);
    const onVis = () => {
      if (document.visibilityState === 'visible') poll();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const qpmSeries = useMemo(() => buildLast10MinutesSeries(data?.qpm || []), [data]);
  const latestAvgConf = useMemo(() => {
    const arr = insights?.confidence_heatmap || [];
    const last = arr[arr.length - 1];
    return typeof last?.avg_conf === "number" ? Math.max(0, Math.min(1, last.avg_conf)) : null;
  }, [insights]);
  const latestGold = useMemo(() => (gold?.rows || [])[0] || null, [gold]);
  const beforeAfter = useMemo(() => {
    const rows = (gold?.rows || []).slice().reverse(); // oldest -> newest
    if (rows.length < 4) return { before: null as number | null, after: null as number | null };
    const mid = Math.floor(rows.length / 2);
    const avg = (xs: (number | null | undefined)[]) => {
      const vals = xs.map((v) => (typeof v === "number" ? v : NaN)).filter((v) => !Number.isNaN(v));
      if (!vals.length) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    const before = avg(rows.slice(0, mid).map((r) => r.match_score ?? null));
    const after = avg(rows.slice(mid).map((r) => r.match_score ?? null));
    return { before, after };
  }, [gold]);
  const particles = Math.min(140, Math.max(70, (data?.qpm?.reduce((a, b) => a + (b.count || 0), 0) || 0) * 2));
  const hue = 190 + Math.round(((data?.avg_rating ?? 3) - 3) * 18); // ~rating→hue shift
  const color = `hsl(${hue}, 90%, 60%)`;
  const connectDist = 110 + Math.min(60, Math.max(0, (data?.qpm?.at(-1)?.count || 0) * 6));

  return (
    <div className="relative p-3 sm:p-6 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <BackgroundCanvas particles={particles} maxSpeed={0.3} color={color} connectDist={connectDist} />
      </div>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-xl md:col-span-1">
            <CardHeader>
              <CardTitle className="text-base font-semibold tracking-tight">Average Answer Rating (1–5)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-extrabold">{formatTwoDecimals(data?.avg_rating ?? null)}</div>
              <div className="text-xs opacity-70 mt-1">Last hour</div>
              {loading && <div className="text-xs opacity-70 mt-2">Loading…</div>}
              {error && <div className="text-xs text-red-400 mt-2">{error}</div>}
            </CardContent>
          </Card>

          <Card className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-xl md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base font-semibold tracking-tight">Query Per Minute (last 10 minutes)</CardTitle>
            </CardHeader>
            <CardContent className="h-56">
              {loading ? (
                <div className="text-sm opacity-70">Loading chart…</div>
              ) : error ? (
                <div className="text-sm text-red-400">{error}</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={qpmSeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="minute" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(11)} stroke="rgba(255,255,255,0.6)" />
                    <YAxis allowDecimals={false} stroke="rgba(255,255,255,0.6)" />
                    <Tooltip formatter={(v: number) => [v, "Queries"]} labelFormatter={(l: string) => `Minute ${l}`} />
                    <Line type="monotone" dataKey="count" stroke="#22d3ee" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Mini-metrics: Confidence, Latency, Keyword Recall, nDCG */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-xl">
            <CardHeader>
              <CardTitle className="text-sm font-semibold tracking-tight">Confidence</CardTitle>
            </CardHeader>
            <CardContent>
              {latestAvgConf == null ? (
                <div className="text-2xl font-extrabold">-</div>
              ) : (
                <>
                  <div className="text-2xl font-extrabold">{Math.round(latestAvgConf * 100)}%</div>
                  <div className="w-full h-2 bg-white/10 rounded mt-2">
                    <div className="h-2 rounded bg-gradient-to-r from-sky-500 to-cyan-500" style={{ width: `${Math.round(latestAvgConf * 100)}%` }} />
                  </div>
                </>
              )}
              <div className="text-xs opacity-70 mt-1">Last hour avg</div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-xl">
            <CardHeader>
              <CardTitle className="text-sm font-semibold tracking-tight">Avg Latency</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-extrabold">{summary?.avg_latency != null ? Math.round(summary.avg_latency) : '-' } ms</div>
              <div className="text-xs opacity-70 mt-1">From eval_logs</div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-xl">
            <CardHeader>
              <CardTitle className="text-sm font-semibold tracking-tight">Keyword Recall</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-extrabold">{typeof latestGold?.keyword_recall === 'number' ? (latestGold!.keyword_recall! * 100).toFixed(0) + '%' : '-'}</div>
              <div className="text-xs opacity-70 mt-1">Latest eval run</div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-xl">
            <CardHeader>
              <CardTitle className="text-sm font-semibold tracking-tight">nDCG</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-extrabold">{typeof latestGold?.ndcg === 'number' ? (latestGold!.ndcg! * 100).toFixed(0) + '%' : '-'}</div>
              <div className="text-xs opacity-70 mt-1">Latest eval run</div>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-xl">
          <CardHeader>
            <CardTitle className="text-base font-semibold tracking-tight">Live Query Feed</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm opacity-70">Loading…</div>
            ) : error ? (
              <div className="text-sm text-red-400">{error}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-separate" style={{ borderSpacing: 0 }}>
                  <thead>
                    <tr className="text-left opacity-70">
                      <th className="py-2 pr-3">Timestamp</th>
                      <th className="py-2 pr-3">Query</th>
                      <th className="py-2 pr-0 text-right">Latency (ms)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.live_feed || []).map((r, idx) => (
                      <tr key={idx} className="border-t border-white/10">
                        <td className="py-2 pr-3 align-top whitespace-nowrap">{r.ts || '-'}</td>
                        <td className="py-2 pr-3 align-top">
                          <div className="line-clamp-2 break-words opacity-90">{r.query}</div>
                        </td>
                        <td className="py-2 pr-0 align-top text-right">{r.latency_ms ?? '-'}</td>
                      </tr>
                    ))}
                    {!data?.live_feed?.length && (
                      <tr>
                        <td colSpan={3} className="py-3 opacity-70">No recent queries</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Before vs After (Eval Runs) */}
        <Card className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-xl">
          <CardHeader>
            <CardTitle className="text-base font-semibold tracking-tight">Eval Runs — Before vs After</CardTitle>
          </CardHeader>
          <CardContent className="h-48">
            {loading ? (
              <div className="text-sm opacity-70">Loading…</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={[{ label: 'Before', value: beforeAfter.before ?? 0 }, { label: 'After', value: beforeAfter.after ?? 0 }]} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                  <XAxis dataKey="label" stroke="rgba(255,255,255,0.6)" />
                  <YAxis domain={[0, 1]} stroke="rgba(255,255,255,0.6)" />
                  <Tooltip formatter={(v: number) => [Number(v).toFixed(2), "Score"]} />
                  <Bar dataKey="value" fill="#22d3ee" radius={[6,6,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
