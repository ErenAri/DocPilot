"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function AdminPage() {
  const [seeding, setSeeding] = useState(false);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [latest, setLatest] = useState<any[]>([]);

  async function seedGold() {
    setSeeding(true);
    try {
      const payload = {
        items: [
          { query: "What is the liability cap?", expected_keywords: ["liability cap"], filter_category: "demo", top_k: 5 },
          { query: "What is the uptime SLA?", expected_keywords: ["99.9%", "uptime"], filter_category: "demo", top_k: 5 },
        ],
      };
      const res = await fetch(`${API_URL}/analytics/seed-gold`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      toast.success(`Seeded ${data.count} gold items`);
    } catch (e: any) {
      toast.error(`Seed failed: ${e.message}`);
    } finally {
      setSeeding(false);
    }
  }

  async function runGold() {
    setRunning(true);
    try {
      const res = await fetch(`${API_URL}/analytics/run-gold`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      toast.success(`Ran ${data.count} evaluations`);
      await refresh();
    } catch (e: any) {
      toast.error(`Run failed: ${e.message}`);
    } finally {
      setRunning(false);
    }
  }

  async function refresh() {
    try {
      const s = await fetch(`${API_URL}/analytics/gold/summary`);
      const r = await fetch(`${API_URL}/analytics/gold/latest`);
      if (s.ok) {
        const sj = await s.json();
        setSummary(sj.summary || sj);
      }
      if (r.ok) {
        const rj = await r.json();
        setLatest(rj.rows || []);
      }
    } catch {}
  }

  return (
    <div className="p-2 sm:p-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <Card className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-xl">
          <CardHeader>
            <CardTitle className="text-xl font-bold tracking-tight">Evaluation Admin</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button onClick={seedGold} disabled={seeding} className="bg-white/10 hover:bg-white/15">Seed Gold</Button>
              <Button onClick={runGold} disabled={running} className="bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-400 hover:to-cyan-400">Run Gold</Button>
              <Button onClick={refresh} className="bg-white/10 hover:bg-white/15">Refresh</Button>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="bg-white/5 rounded p-3">
                <div className="opacity-70">Total</div>
                <div className="text-lg font-semibold">{summary?.total ?? '-'}</div>
              </div>
              <div className="bg-white/5 rounded p-3">
                <div className="opacity-70">Passed</div>
                <div className="text-lg font-semibold">{summary?.passed ?? '-'}</div>
              </div>
              <div className="bg-white/5 rounded p-3">
                <div className="opacity-70">Avg Score</div>
                <div className="text-lg font-semibold">{summary?.avg_score ? Number(summary.avg_score).toFixed(2) : '-'}</div>
              </div>
            </div>
            <div>
              <div className="opacity-70 mb-1 text-sm">Latest Results</div>
              <div className="space-y-2 text-sm">
                {latest.map((row, i) => (
                  <div key={i} className="bg-white/5 rounded p-3 border border-white/10">
                    <div className="flex justify-between">
                      <div>{row.query}</div>
                      <div className="opacity-70">{row.passed ? '✓' : '✕'} {Number(row.match_score).toFixed(2)}</div>
                    </div>
                  </div>
                ))}
                {!latest.length && <div className="opacity-70">No results yet</div>}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


