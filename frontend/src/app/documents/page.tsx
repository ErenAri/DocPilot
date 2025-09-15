"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DocumentInfo, Chunk, AnalyzeResult, AnswerResult } from "../../../lib/actions";
import { listDocuments, ingestFile, getDocument, analyzeDoc, ask } from "../../../lib/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { checkHealth } from "../../../lib/diag";
import { toastError, toastInfo, toastSuccess } from "../../../lib/toast";
import DocumentList from "./DocumentList";
import DocumentViewer from "./DocumentViewer";
import AnalysisPanel from "./AnalysisPanel";
import QAPanel from "./QAPanel";

export default function DocumentsPage() {
  const LIMIT = 50;
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [q, setQ] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [loadingChunks, setLoadingChunks] = useState<boolean>(false);
  const [find, setFind] = useState<string>("");
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string>("");
  const [askQ, setAskQ] = useState<string>("");
  const [asking, setAsking] = useState<boolean>(false);
  const [answer, setAnswer] = useState<AnswerResult | null>(null);
  const [askError, setAskError] = useState<string>("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [healthOk, setHealthOk] = useState<boolean>(true);
  const [offset, setOffset] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [loadMorePending, setLoadMorePending] = useState<boolean>(false);
  const [bulkMode, setBulkMode] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAnalyzing, setBulkAnalyzing] = useState<boolean>(false);
  const [bulkRows, setBulkRows] = useState<Array<{ id: string; title: string; riskCount: number; critical: boolean; missingClauses: string[] }>>([]);
  const [catFilter, setCatFilter] = useState<string>("All");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [tagFilter, setTagFilter] = useState<string>("");

  function dedupById(items: DocumentInfo[]): DocumentInfo[] {
    const map = new Map<string, DocumentInfo>();
    for (const it of items) map.set(it.id, it);
    return Array.from(map.values());
  }

  async function fetchPage(nextOffset: number, replace: boolean = false) {
    if (loadMorePending) return;
    setLoadMorePending(true);
    try {
      const res = await listDocuments(LIMIT, nextOffset);
      if (!res.ok) {
        toastError(res.error);
      } else {
        const { items, total } = res.data;
        setHasMore(nextOffset + LIMIT < (total || 0));
        setDocs(prev => {
          const incoming = items || [];
          if (replace) return dedupById(incoming);
          const map = new Map(prev.map(d => [d.id, d] as const));
          for (const item of incoming) if (!map.has(item.id)) map.set(item.id, item);
          return Array.from(map.values());
        });
      }
      setOffset(nextOffset + LIMIT);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadMorePending(false);
      setLoading(false);
    }
  }

  async function refresh() {
    setLoading(true);
    setDocs([]);
    setOffset(0);
    setHasMore(true);
    await fetchPage(0, true);
  }

  function toggleBulk(v: boolean) {
    setBulkMode(v);
    if (!v) setSelectedIds(new Set());
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function analyzeSelected() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkAnalyzing(true);
    setBulkRows([]);
    const limit = 4;
    let index = 0;
    const out: Array<{ id: string; title: string; riskCount: number; critical: boolean; missingClauses: string[] }> = [];
    const worker = async () => {
      while (index < ids.length) {
        const my = index++;
        const id = ids[my];
        const doc = docs.find(d => d.id === id);
        try {
          const res = await analyzeDoc(id);
          const riskCount = (res.risks || []).length;
          const critical = (res.risks || []).some(r => String(r.severity || '').toLowerCase() === 'critical' || String(r.severity || '').toLowerCase() === 'high');
          const missingClauses = Object.entries(res.clauses || {}).filter(([, v]) => !v).map(([k]) => humanize(k)).slice(0, 3);
          out.push({ id, title: doc?.title || id, riskCount, critical, missingClauses });
        } catch (e) {
          out.push({ id, title: doc?.title || id, riskCount: 0, critical: false, missingClauses: ["Error"] });
        }
      }
    };
    const workers = Array.from({ length: Math.min(limit, ids.length) }, () => worker());
    await Promise.all(workers);
    // Keep original selection order in output
    const byId = new Map(out.map(r => [r.id, r] as const));
    setBulkRows(ids.map(id => byId.get(id)!).filter(Boolean));
    setBulkAnalyzing(false);
  }

  function exportCsv() {
    if (bulkRows.length === 0) return;
    const header = ["Title", "RiskCount", "Critical", "MissingClauses"].join(",");
    const rows = bulkRows.map(r => {
      const parts = [
        '"' + (r.title || '').replace(/"/g, '""') + '"',
        String(r.riskCount),
        r.critical ? "true" : "false",
        '"' + (r.missingClauses.join("; ") || '').replace(/"/g, '""') + '"',
      ];
      return parts.join(",");
    });
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bulk_analysis.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    (async () => {
      const ok = await checkHealth();
      setHealthOk(ok);
    })();
    refresh();
  }, []);

  // Infinite scroll handled inside DocumentList via onLoadMore

  const selectedDoc = useMemo(() => docs.find(d => d.id === selectedId) || null, [docs, selectedId]);

  useEffect(() => {
    setAnalysis(null);
    setAnalysisError("");
    if (!selectedId) { setChunks([]); return; }
    setLoadingChunks(true);
    (async () => {
      const res = await getDocument(selectedId);
      if (!res.ok) {
        console.error(res.error);
        setChunks([]);
        toastError("Preview failed");
      } else {
        setChunks((res.data.chunks || []).slice().sort((a, b) => a.ord - b.ord));
      }
      setLoadingChunks(false);
    })();
  }, [selectedId]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const d of docs) {
      const cat = (d.meta as any)?.category;
      if (typeof cat === "string" && cat.trim()) set.add(cat.trim());
    }
    return ["All", ...Array.from(set.values()).sort((a, b) => a.localeCompare(b))];
  }, [docs]);

  const preFiltered = useMemo(() => {
    const tf = tagFilter.trim().toLowerCase();
    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toMs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;
    return docs.filter(d => {
      const meta: any = d.meta || {};
      if (catFilter !== "All") {
        if (String(meta?.category || "") !== catFilter) return false;
      }
      if (fromMs || toMs) {
        const t = new Date(d.created_at).getTime();
        if (Number.isFinite(fromMs as number) && t < (fromMs as number)) return false;
        if (Number.isFinite(toMs as number) && t > (toMs as number)) return false;
      }
      if (tf) {
        const tags = Array.isArray(meta?.tags) ? meta.tags : [];
        const has = tags.some((x: unknown) => typeof x === "string" && x.toLowerCase().includes(tf));
        if (!has) return false;
      }
      return true;
    });
  }, [docs, catFilter, dateFrom, dateTo, tagFilter]);

  const filtered = useMemo(() => {
    if (!q.trim()) return preFiltered;
    const s = q.toLowerCase();
    return preFiltered.filter(d => {
      const t = (d.title || "").toLowerCase();
      const metaStr = JSON.stringify(d.meta || {}).toLowerCase();
      return t.includes(s) || metaStr.includes(s);
    });
  }, [preFiltered, q]);

  async function onChooseFile(f: File) {
    setUploading(true);
    try {
      const res = await ingestFile(f);
      if (!res.ok) {
        toastError(res.error || "Upload failed");
      } else {
        await refresh();
        toastSuccess("Uploaded successfully");
      }
    } catch (e) {
      console.error(e);
      toastError("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function humanize(key: string) {
    const s = (key || "").replace(/_/g, " ").trim();
    return s.replace(/\b\w/g, (m) => m.toUpperCase());
  }

  // Persist last analysis per document
  const [analysisCache, setAnalysisCache] = useState<Record<string, AnalyzeResult>>({});
  useEffect(() => {
    try {
      setAnalysis(selectedId ? analysisCache[selectedId] || null : null);
    } catch {}
  }, [selectedId, analysisCache]);

  async function runAnalysis() {
    if (!selectedId) return;
    setAnalyzing(true);
    setAnalysisError("");
    try {
      const res = await analyzeDoc(selectedId);
      if (!res.ok) {
        setAnalysis(null);
        setAnalysisError(res.error || "Analyze failed");
        toastError(res.error || "Analyze failed");
      } else {
        setAnalysis(res.data);
        setAnalysisCache(prev => ({ ...prev, [selectedId]: res.data }));
        toastSuccess("Analysis complete");
      }
    } catch (e: any) {
      setAnalysis(null);
      setAnalysisError(e?.message || "Analyze failed");
      toastError(e?.message || "Analyze failed");
    } finally {
      setAnalyzing(false);
    }
  }

  async function runAsk() {
    const query = askQ.trim();
    if (!query) return;
    setAsking(true);
    setAskError("");
    try {
      const res = await ask(query);
      if (!res.ok) {
        setAnswer(null);
        setAskError(res.error || "Ask failed");
        toastError(res.error || "Ask failed");
      } else {
        setAnswer(res.data);
        toastInfo("Answer ready");
      }
    } catch (e: any) {
      setAnswer(null);
      setAskError(e?.message || "Ask failed");
      toastError(e?.message || "Ask failed");
    } finally {
      setAsking(false);
    }
  }

  function exportAnswerPdf() {
    if (!answer) return;
    const title = (selectedDoc?.title || selectedDoc?.id || "Corpus").toString();
    const dateStr = new Date().toLocaleString();
    const summary = String(answer.summary || "");
    const checklistItems = Array.isArray(answer.checklist)
      ? answer.checklist
      : String(answer.checklist || "").split(/\n+/).filter(Boolean);
    const draft = String(answer.draft || "");
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>DocPilot Report</title>
<style>
  @page { size: A4; margin: 18mm; }
  html, body { background: #fff; }
  body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Inter, sans-serif; color: #111; }
  h1 { font-size: 20pt; margin: 0 0 8pt; }
  h2 { font-size: 12pt; margin: 14pt 0 6pt; }
  .meta { font-size: 10pt; color: #555; margin-bottom: 14pt; }
  pre { white-space: pre-wrap; word-wrap: break-word; font: inherit; line-height: 1.5; }
  ul { margin: 0; padding-left: 16pt; }
  li { margin: 2pt 0; }
  .section { page-break-inside: avoid; }
</style></head>
<body>
  <h1>${esc(title)}</h1>
  <div class="meta">${esc(dateStr)}</div>
  <div class="section">
    <h2>Executive Summary</h2>
    <pre>${esc(summary)}</pre>
  </div>
  <div class="section">
    <h2>Risk Checklist</h2>
    <ul>${checklistItems.map(i => `<li>${esc(String(i))}</li>`).join("")}</ul>
  </div>
  <div class="section">
    <h2>Response Draft</h2>
    <pre>${esc(draft)}</pre>
  </div>
</body></html>`;
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    w.onload = () => { try { w.print(); } catch {} try { w.close(); } catch {} };
  }

  return (
    <div className="space-y-4">
      {!healthOk && (
        <div className="rounded-md border border-red-400/30 bg-red-500/10 text-red-200 px-3 py-2 text-sm">
          Backend unreachable or missing headers (X-Org-Id, X-Role). Check .env.local
        </div>
      )}
      {/* Top bar */}
      <div className="flex items-center gap-3">
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Documents</h1>
        <div className="flex-1" />
        <Input
          placeholder="Search by title or meta..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs h-10"
        />
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={async (e) => {
            const f = (e.target.files || [])[0];
            if (f) await onChooseFile(f);
            if (fileRef.current) fileRef.current.value = "";
          }}
        />
        <Button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="h-10"
        >{uploading ? "Uploading..." : "Upload"}</Button>
      </div>

      {/* Grid */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Left: list */}
        <Card className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-xl">
          <CardHeader>
            <CardTitle className="text-base font-semibold">All Documents</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Filter bar */}
            <div className="mb-2 grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
              <div>
                <div className="text-xs text-white/70 mb-1">Category</div>
                <select
                  value={catFilter}
                  onChange={(e) => setCatFilter(e.target.value)}
                  className="h-9 w-full rounded border border-white/15 bg-white/10 px-2 text-sm text-white/90"
                >
                  {categories.map((c) => (
                    <option key={c} value={c} className="text-black">{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-xs text-white/70 mb-1">From</div>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-full rounded border border-white/15 bg-white/10 px-2 text-sm text-white/90" />
              </div>
              <div>
                <div className="text-xs text-white/70 mb-1">To</div>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-full rounded border border-white/15 bg-white/10 px-2 text-sm text-white/90" />
              </div>
              <div>
                <div className="text-xs text-white/70 mb-1">Tag</div>
                <Input value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} placeholder="tag contains…" className="h-9" />
              </div>
            </div>
            <div className="mb-2 flex items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={bulkMode} onChange={(e) => toggleBulk(e.target.checked)} /> Bulk
              </label>
              <div className="flex-1" />
              {bulkMode && (
                <div className="flex items-center gap-2">
                  <Button onClick={analyzeSelected} disabled={bulkAnalyzing || selectedIds.size === 0} className="h-8" aria-busy={bulkAnalyzing}>
                    {bulkAnalyzing ? "Analyzing Selected…" : "Analyze Selected"}
                  </Button>
                  <Button variant="outline" onClick={exportCsv} disabled={bulkRows.length === 0} className="h-8">
                    Export CSV
                  </Button>
                </div>
              )}
            </div>
            <DocumentList
              docs={docs}
              loading={loading}
              hasMore={hasMore}
              loadMorePending={loadMorePending}
              onLoadMore={() => fetchPage(offset)}
              filtered={filtered}
              selectedId={selectedId}
              bulkMode={bulkMode}
              selectedIds={selectedIds}
              toggleSelect={toggleSelect}
              onSelect={setSelectedId}
            />
          </CardContent>
        </Card>

        {bulkRows.length > 0 && (
          <Card className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-xl">
            <CardHeader>
              <CardTitle className="text-base font-semibold">Bulk Results</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-white/70">
                      <th className="px-2 py-1">Title</th>
                      <th className="px-2 py-1">RiskCount</th>
                      <th className="px-2 py-1">Critical?</th>
                      <th className="px-2 py-1">MissingClauses (examples)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkRows.map(r => (
                      <tr key={r.id} className="border-t border-white/10">
                        <td className="px-2 py-1 whitespace-nowrap">{r.title}</td>
                        <td className="px-2 py-1">{r.riskCount}</td>
                        <td className="px-2 py-1">{r.critical ? "Yes" : "No"}</td>
                        <td className="px-2 py-1">{r.missingClauses.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Right: viewer */}
        <Card className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-xl">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base font-semibold">
                {selectedDoc ? (
                  <div>
                    <div className="truncate">{selectedDoc.title || selectedDoc.id}</div>
                    <div className="text-xs text-white/60">{selectedDoc.id}</div>
                  </div>
                ) : (
                  <span>Details</span>
                )}
              </CardTitle>
              {selectedDoc && (
                <Button onClick={runAnalysis} disabled={analyzing} className="h-9">
                  {analyzing ? "Analyzing…" : "Analyze"}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedDoc ? (
              <>
                {analysisError && (
                  <div className="text-sm rounded-md border border-red-400/30 bg-red-500/10 text-red-200 px-3 py-2">
                    {analysisError}
                  </div>
                )}
                <DocumentViewer
                  title={selectedDoc.title || selectedDoc.id}
                  id={selectedDoc.id}
                  chunks={chunks}
                  loading={loadingChunks}
                  find={find}
                  onFindChange={setFind}
                />
                <AnalysisPanel analysis={analysis} />
              </>
            ) : (
              <div className="text-sm text-white/70">Select a document...</div>
            )}
          </CardContent>
        </Card>

        {/* Right: Ask panel removed per request */}
      </div>
    </div>
  );
}


