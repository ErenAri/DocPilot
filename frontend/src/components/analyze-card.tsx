"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";

export function AnalyzeCard() {
  const [docId, setDocId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);

  async function run() {
    setLoading(true);
    try {
      const res = await apiFetch(`/analyze/doc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_id: docId || '' })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResult(data);
    } catch (e: any) {
      toast.error(`Analyze failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-xl">
      <CardHeader>
        <CardTitle className="text-xl font-bold tracking-tight">Analyze Doc</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input placeholder="doc_id" value={docId} onChange={(e) => setDocId(e.target.value)} />
          <Button onClick={run} disabled={loading || !docId.trim()} className="bg-white/10 hover:bg-white/15">
            {loading ? 'Analyzing...' : 'Run'}
          </Button>
        </div>
        {result && (
          <div className="space-y-2 text-sm">
            <div className="opacity-70">Clauses detected:</div>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(result.clauses || {}).map(([k, v]) => (
                <div key={k} className="bg-white/5 rounded p-2 border border-white/10 flex justify-between">
                  <span>{k}</span>
                  <span className={v ? 'text-green-300' : 'text-red-300'}>{v ? 'yes' : 'no'}</span>
                </div>
              ))}
            </div>
            <div className="opacity-70 mt-2">Risks:</div>
            <div className="space-y-1">
              {(result.risks || []).map((r: any, i: number) => (
                <div key={i} className="bg-white/5 rounded p-2 border border-white/10">
                  {r.item} — <span className="opacity-80">{r.severity}</span>
                </div>
              ))}
              {!result.risks?.length && <div className="opacity-70">No risks found</div>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


