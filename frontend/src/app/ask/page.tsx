"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { listDocuments, getDocument, analyzeDoc, ask } from "../../../lib/actions";
import type { DocumentInfo, AnalyzeResult, Chunk, AnswerResult } from "../../../lib/actions";
import QAPanel from "../documents/QAPanel";
import { toastError, toastInfo } from "../../../lib/toast";

export default function AskPage() {
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [q, setQ] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [loadingChunks, setLoadingChunks] = useState<boolean>(false);
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [askQ, setAskQ] = useState<string>("");
  const [asking, setAsking] = useState<boolean>(false);
  const [answer, setAnswer] = useState<AnswerResult | null>(null);
  const [askError, setAskError] = useState<string>("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await listDocuments(100, 0);
        if (!res.ok) throw new Error(res.error);
        setDocs(res.data.items || []);
      } catch (e: any) {
        toastError(e?.message || "Failed to load documents");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!q.trim()) return docs;
    const s = q.toLowerCase();
    return docs.filter(d => (d.title || "").toLowerCase().includes(s) || JSON.stringify(d.meta || {}).toLowerCase().includes(s));
  }, [docs, q]);

  const selectedDoc = useMemo(() => docs.find(d => d.id === selectedId) || null, [docs, selectedId]);

  useEffect(() => {
    setAnalysis(null);
    setAnswer(null);
    setAskError("");
    if (!selectedId) { setChunks([]); return; }
    setLoadingChunks(true);
    (async () => {
      try {
        const res = await getDocument(selectedId);
        if (!res.ok) throw new Error(res.error);
        setChunks((res.data.chunks || []).slice().sort((a, b) => a.ord - b.ord));
      } catch (e: any) {
        setChunks([]);
        toastError(e?.message || "Preview failed");
      } finally {
        setLoadingChunks(false);
      }
    })();
    (async () => {
      setAnalyzing(true);
      try {
        const res = await analyzeDoc(selectedId);
        if (!res.ok) throw new Error(res.error);
        setAnalysis(res.data);
      } catch (e: any) {
        setAnalysis(null);
        toastError(e?.message || "Analyze failed");
      } finally {
        setAnalyzing(false);
      }
    })();
  }, [selectedId]);

  function humanize(key: string) {
    const s = (key || "").replace(/_/g, " ").trim();
    return s.replace(/\b\w/g, (m) => m.toUpperCase());
  }

  const strengths = useMemo(() => {
    const m: string[] = [];
    const clauses = (analysis && analysis.clauses) || {} as Record<string, unknown>;
    for (const [k, v] of Object.entries(clauses)) {
      if (v) m.push(humanize(k));
    }
    return m;
  }, [analysis]);

  const missing = useMemo(() => {
    const m: string[] = [];
    const clauses = (analysis && analysis.clauses) || {} as Record<string, unknown>;
    for (const [k, v] of Object.entries(clauses)) {
      if (!v) m.push(humanize(k));
    }
    return m;
  }, [analysis]);

  const weaknesses = useMemo(() => {
    const risks = (analysis && (analysis as any).risks) || [] as Array<{ item: string; severity?: string }>;
    return risks.map((r: { item: string; severity?: string }) => `${r.item}${r.severity ? ` [${String(r.severity).toUpperCase()}]` : ""}`);
  }, [analysis]);

  const suggestions = useMemo(() => {
    const out: string[] = [];
    for (const m of missing) {
      const k = m.toLowerCase();
      if (k.includes("liability")) out.push("Add a clear Liability Cap clause (e.g., limited to last 12 months of fees).");
      else if (k.includes("uptime") || k.includes("sla")) out.push("Define an Uptime SLA (e.g., 99.9%) and remedies for breaches.");
      else if (k.includes("termination")) out.push("Specify termination terms, notice periods (e.g., 30 days), and consequences.");
      else if (k.includes("jurisdiction")) out.push("State governing law and venue for disputes.");
      else if (k.includes("data")) out.push("Include data protection and privacy obligations (GDPR/DPAs, confidentiality).");
      else out.push(`Add missing clause: ${m}.`);
    }
    const risks = (analysis && (analysis as any).risks) || [] as Array<{ item: string; severity?: string }>;
    for (const r of risks) {
      const sev = String(r.severity || "").toUpperCase();
      if (sev === "HIGH") out.push(`Mitigate: ${r.item}. Add strict limitations, clear definitions, and explicit remedies.`);
      else if (sev === "MEDIUM") out.push(`Clarify: ${r.item}. Tighten language and add objective criteria.`);
      else out.push(`Review: ${r.item}. Consider adding safeguards.`);
    }
    return out;
  }, [missing, analysis]);

  async function runAsk() {
    const query = askQ.trim();
    if (!query) return;
    setAsking(true);
    setAskError("");
    try {
      // Bias retrieval using document title as keyword if available
      const kw = selectedDoc?.title || undefined;
      const res = await ask(query, kw);
      if (!res.ok) throw new Error(res.error);
      setAnswer(res.data);
      toastInfo("Answer ready");
    } catch (e: any) {
      setAnswer(null);
      setAskError(e?.message || "Ask failed");
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="p-2 sm:p-4">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10">
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Ask Your Documents</h1>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <Card className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-xl">
            <CardHeader>
              <CardTitle className="text-base font-semibold">All Documents</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-2">
                <Input placeholder="Search by title or meta..." value={q} onChange={(e) => setQ(e.target.value)} className="h-9" />
              </div>
              <div className="max-h-[70vh] overflow-auto divide-y divide-white/10">
                {loading ? (
                  <div className="p-3 space-y-2">{Array.from({ length: 6 }).map((_, i) => (<div key={i} className="h-5 rounded bg-white/10 animate-pulse" />))}</div>
                ) : filtered.length === 0 ? (
                  <div className="p-3 text-sm text-white/70">No documents found.</div>
                ) : (
                  filtered.map(d => (
                    <div key={d.id} onClick={() => setSelectedId(d.id)} className={`w-full text-left p-3 hover:bg-white/5 transition ${selectedId === d.id ? "bg-white/10" : ""}`}>
                      <div className="font-medium truncate">{d.title || d.id}</div>
                      <div className="text-xs text-white/60">{new Date(d.created_at).toLocaleString()}</div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-xl">
            <CardHeader>
              <CardTitle className="text-base font-semibold">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedDoc ? (
                <div className="text-sm text-white/70">Select a document from the left.</div>
              ) : (
                <>
                  <div className="text-sm">
                    <div className="font-semibold truncate">{selectedDoc.title || selectedDoc.id}</div>
                    <div className="text-xs text-white/60">{selectedDoc.id}</div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-semibold">Analysis {analyzing && <span className="text-white/60">(Analyzing…)</span>}</div>
                    {!analysis ? (
                      <div className="text-sm text-white/70">{analyzing ? "Running analysis…" : "No analysis yet."}</div>
                    ) : (
                      <div className="grid md:grid-cols-3 gap-3">
                        <div className="rounded border border-white/10 bg-white/5 p-2">
                          <div className="text-xs font-semibold mb-1">Strengths</div>
                          {strengths.length === 0 ? <div className="text-xs text-white/60">—</div> : (
                            <ul className="text-xs list-disc pl-4 space-y-1">
                              {strengths.map((s, i) => (<li key={i}>{s}</li>))}
                            </ul>
                          )}
                        </div>
                        <div className="rounded border border-white/10 bg-white/5 p-2">
                          <div className="text-xs font-semibold mb-1">Missing</div>
                          {missing.length === 0 ? <div className="text-xs text-white/60">—</div> : (
                            <ul className="text-xs list-disc pl-4 space-y-1">
                              {missing.map((s, i) => (<li key={i}>{s}</li>))}
                            </ul>
                          )}
                        </div>
                        <div className="rounded border border-white/10 bg-white/5 p-2">
                          <div className="text-xs font-semibold mb-1">Weaknesses</div>
                          {weaknesses.length === 0 ? <div className="text-xs text-white/60">—</div> : (
                            <ul className="text-xs list-disc pl-4 space-y-1">
                              {weaknesses.map((s: any, i: any) => (<li key={i}>{s}</li>))}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-semibold">Suggested Fixes</div>
                    {suggestions.length === 0 ? <div className="text-sm text-white/70">No suggestions.</div> : (
                      <ul className="text-sm list-disc pl-5 space-y-1">
                        {suggestions.map((s, i) => (<li key={i}>{s}</li>))}
                      </ul>
                    )}
                  </div>

                  
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}


