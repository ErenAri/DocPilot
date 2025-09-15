"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";

export default function OpsPage() {
  const [slo, setSlo] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [calib, setCalib] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function loadAll() {
    try {
      const [s1, s2, s3] = await Promise.all([
        apiFetch(`/ops/slo`).then(r => r.json()).catch(() => null),
        apiFetch(`/ops/status`).then(r => r.json()).catch(() => null),
        apiFetch(`/ops/calibration`).then(r => r.json()).catch(() => null),
      ]);
      setSlo(s1?.slo || null);
      setStatus(s2?.ops || null);
      setCalib(s3?.calibration || null);
    } catch {}
  }

  useEffect(() => { loadAll(); }, []);

  async function runSelfHeal() {
    setLoading(true);
    try {
      const r = await apiFetch(`/ops/self-heal`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "failed");
      toast.success("Self-heal executed");
      await loadAll();
    } catch (e: any) {
      toast.error(`Self-heal failed: ${e.message}`);
    } finally { setLoading(false); }
  }

  async function runCompact() {
    setLoading(true);
    try {
      const r = await apiFetch(`/ops/compact`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "failed");
      toast.success(`Compacted, deleted=${j.deleted}`);
      await loadAll();
    } catch (e: any) {
      toast.error(`Compact failed: ${e.message}`);
    } finally { setLoading(false); }
  }

  async function runCalibration() {
    setLoading(true);
    try {
      const r = await apiFetch(`/ops/calibration/run`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "failed");
      toast.success("Calibration started");
      setTimeout(loadAll, 1200);
    } catch (e: any) {
      toast.error(`Calibration failed: ${e.message}`);
    } finally { setLoading(false); }
  }

  return (
    <div className="p-2 sm:p-4 text-white">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Ops & SLO</h1>
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="bg-white/5 border-white/10">
            <CardHeader><CardTitle>SLO (24h)</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>Total: {slo?.total ?? "-"}</div>
              <div>Avg latency: {slo?.avg_latency?.toFixed ? slo.avg_latency.toFixed(1) : slo?.avg_latency ?? "-"} ms</div>
              <div>p95 latency: {slo?.p95_latency?.toFixed ? slo.p95_latency.toFixed(1) : slo?.p95_latency ?? "-"} ms</div>
              <div>Low-evidence rate: {slo?.low_evidence_rate != null ? `${Math.round(slo.low_evidence_rate * 100)}%` : "-"}</div>
            </CardContent>
          </Card>
          <Card className="bg-white/5 border-white/10">
            <CardHeader><CardTitle>Status</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>OTEL: {status?.otel_endpoint ? "on" : "off"}</div>
              <div>S3: {status?.s3_configured ? "configured" : "off"}</div>
              <div>API key: {status?.api_key_required ? "required" : "off"}</div>
              <div>Require Org: {status?.require_org_id ? "yes" : "no"}</div>
            </CardContent>
          </Card>
          <Card className="bg-white/5 border-white/10">
            <CardHeader><CardTitle>Calibration</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>Threshold: {calib?.threshold ?? "-"}</div>
              <div>Last run: {calib?.last_run ?? "-"}</div>
              <Button disabled={loading} onClick={runCalibration} className="mt-2">Run Calibration</Button>
            </CardContent>
          </Card>
          <Card className="bg-white/5 border-white/10">
            <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Button disabled={loading} onClick={runSelfHeal}>Self-Heal</Button>
              <Button disabled={loading} onClick={runCompact} variant="outline" className="ml-2">Compact/Dedup</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}


