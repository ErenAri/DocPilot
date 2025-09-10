"use client";
import { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { EvidenceBadgeList } from "@/components/evidence-badge-list";
import type { EvidencePassage, AnswerResponse } from "@/lib/types";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Search, FileDown, MessageSquare } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import Confetti from "@/components/confetti";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Passage = EvidencePassage & { dist: number };

export function AnswerPanel() {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState<number>(5);
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [keyword, setKeyword] = useState<string>("");

  const [passages, setPassages] = useState<Passage[]>([]);
  const [answer, setAnswer] = useState<string>("");
  const [lowEvidence, setLowEvidence] = useState<boolean | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [streaming, setStreaming] = useState<boolean>(false);
  const [evalId, setEvalId] = useState<string | null>(null);
  const [highlightIdx, setHighlightIdx] = useState<number | null>(null);
  const [confettiTick, setConfettiTick] = useState(0);
  const passageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  function registerPassageRef(key: string) {
    return (el: HTMLDivElement | null) => {
      passageRefs.current[key] = el;
    };
  }

  function scrollToEvidence(idx: number) {
    const key = String(idx);
    const el = passageRefs.current[key];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightIdx(idx);
      setTimeout(() => setHighlightIdx((cur) => (cur === idx ? null : cur)), 1200);
    }
  }

  function parseAnswerSections(a: string) {
    if (!a) return { summary: "", risks: "", draft: "" };
    const text = a;
    const sections = { summary: "", risks: "", draft: "" } as { [k: string]: string };
    // Try explicit headings first
    const patterns = [
      { key: "summary", re: /(?:^|\n)\s*(?:1\)|#|##)?\s*Executive\s+Summary[\s\S]*?(?=\n\s*(?:2\)|Risks|Risk\s+Checklist|Response\s+Draft|$))/i },
      { key: "risks", re: /(?:^|\n)\s*(?:2\))?\s*(?:Risks|Risk\s+Checklist)[\s\S]*?(?=\n\s*(?:3\)|Response\s+Draft|Executive\s+Summary|$))/i },
      { key: "draft", re: /(?:^|\n)\s*(?:3\))?\s*Response\s+Draft[\s\S]*/i },
    ];
    for (const { key, re } of patterns) {
      const m = text.match(re);
      if (m) sections[key] = m[0].trim();
    }
    // Fallbacks
    if (!sections.summary) {
      const lines = text.split(/\n+/).filter(Boolean);
      const bullets = lines.filter((l) => /^\s*(?:[-*•]|\d+\.)\s+/.test(l)).slice(0, 3);
      sections.summary = bullets.join("\n");
    }
    if (!sections.risks) sections.risks = sections.summary ? "" : text;
    if (!sections.draft) {
      const draftStart = text.toLowerCase().indexOf("response draft");
      sections.draft = draftStart >= 0 ? text.slice(draftStart) : text;
    }
    return { summary: sections.summary, risks: sections.risks, draft: sections.draft };
  }

  function renderAnswerWithLinks(a: string) {
    if (!a) return null;
    const parts = a.split(/(\[\s*Evidence\s*#(\d+)\s*\])/gi);
    const nodes: any[] = [];
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      const numStr = parts[i + 1];
      if (seg && seg.match(/^\[\s*evidence/i) && numStr) {
        const idx = Number(numStr);
        nodes.push(
          <button
            key={`ev-${i}`}
            onClick={() => scrollToEvidence(idx)}
            className="underline decoration-dotted text-sky-300 hover:text-sky-200"
            title={`Jump to Evidence #${idx}`}
          >
            {`[Evidence #${idx}]`}
          </button>
        );
        i += 1; // skip captured number
      } else {
        nodes.push(<span key={`t-${i}`}>{seg}</span>);
      }
    }
    return <div className="whitespace-pre-wrap text-sm p-3">{nodes}</div>;
  }

  async function createLinearIssue(titleStr: string, descriptionStr: string) {
    try {
      const res = await fetch(`${API_URL}/actions/linear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: titleStr, description: descriptionStr })
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "failed");
      toast.success(`Linear issue created: ${j.issue?.identifier || j.issue?.id || "ok"}`);
    } catch (e: any) {
      toast.error(`Linear failed: ${e.message}`);
    }
  }

  async function publishConfluence(spaceKey: string, titleStr: string, html: string) {
    try {
      const res = await fetch(`${API_URL}/actions/confluence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ space_key: spaceKey, title: titleStr, content_html: html })
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "failed");
      toast.success("Published to Confluence");
    } catch (e: any) {
      toast.error(`Confluence failed: ${e.message}`);
    }
  }

  function toHtml(textStr: string) {
    const esc = (s: string) => s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<p>${esc(textStr || "").replace(/\n/g, "<br/>")}</p>`;
  }

  const apiPayload = useMemo(() => ({
    query,
    top_k: topK,
    filter_category: filterCategory || undefined,
    keyword: keyword || undefined,
  }), [query, topK, filterCategory, keyword]);

  async function doSearch() {
    setLoading(true);
    setAnswer("");
    try {
      const res = await fetch(`${API_URL}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apiPayload),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: { passages: Passage[] } = await res.json();
      setPassages(data.passages || []);
    } catch (e: any) {
      toast.error(`Search failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function doAnswer() {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apiPayload),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: AnswerResponse = await res.json();
      setAnswer(data.answer || "");
      setPassages((data.evidence as Passage[]) || []);
      setLowEvidence(data.low_evidence ?? null);
      setConfidence(typeof data.confidence === 'number' ? data.confidence : null);
      setEvalId(typeof data.eval_id === 'string' ? data.eval_id : null);
      try { setConfettiTick(t => t + 1); } catch {}
    } catch (e: any) {
      toast.error(`Answer failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function doExport() {
    try {
      const res = await fetch(`${API_URL}/export/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apiPayload),
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "docpilot_report.pdf";
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(`Export failed: ${e.message}`);
    }
  }

  async function doStream() {
    if (!query.trim()) return;
    setAnswer("");
    setStreaming(true);
    try {
      const res = await fetch(`${API_URL}/answer/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apiPayload),
      });
      if (!res.ok || !res.body) throw new Error(await res.text());
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        if (value) setAnswer((prev) => prev + decoder.decode(value));
      }
    } catch (e: any) {
      toast.error(`Stream failed: ${e.message}`);
    } finally {
      setStreaming(false);
    }
  }

  return (
    <Card className="relative rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-xl overflow-hidden">
      {confettiTick > 0 && <Confetti trigger={confettiTick} />}
      <CardHeader>
        <CardTitle className="text-xl font-bold tracking-tight">Query & Answer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/50" />
          <Input
            id="query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask a question about your documents..."
            className="h-12 pl-10 text-base"
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label htmlFor="topk">top_k</Label>
            <Input id="topk" type="number" value={topK} onChange={(e) => setTopK(Number(e.target.value) || 0)} className="h-10" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fc">filter_category</Label>
            <Input id="fc" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="h-10" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="kw">keyword</Label>
            <Input id="kw" value={keyword} onChange={(e) => setKeyword(e.target.value)} className="h-10" />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={doSearch} disabled={loading || !query.trim()} className="bg-white/10 hover:bg-white/15">
            <span className="inline-flex items-center gap-2"><Search className="w-4 h-4" /> Search</span>
          </Button>
          <Button onClick={doAnswer} disabled={loading || !query.trim()} className="bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-400 hover:to-cyan-400">
            <span className="inline-flex items-center gap-2"><MessageSquare className="w-4 h-4" /> Get Answer</span>
          </Button>
          <Button onClick={doStream} disabled={streaming || !query.trim()} className="bg-white/10 hover:bg-white/15">
            {streaming ? "Streaming..." : "Stream Answer"}
          </Button>
          <Button onClick={doExport} disabled={!query.trim()} variant="outline" className="border-white/20">
            <span className="inline-flex items-center gap-2"><FileDown className="w-4 h-4" /> Export PDF</span>
          </Button>
        </div>

        {passages.length > 0 && (
          <div className="space-y-2">
            <h3 className="font-semibold">Passages</h3>
            <div className="grid gap-3 md:grid-cols-2">
              {passages.map((p, i) => (
                <TooltipProvider key={p.id}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <motion.div
                        ref={registerPassageRef(String(i + 1))}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25 }}
                        className={`border rounded-xl p-3 bg-white/5 hover:scale-[1.01] transition ${highlightIdx === i + 1 ? "border-sky-400/70" : "border-white/10"}`}
                      >
                        <div className="text-xs opacity-70 mb-1">#{i + 1} dist={p.dist.toFixed(4)} doc={p.document_id || p.doc_id} ord={p.ord}{p.page != null ? ` p=${p.page}` : ""}</div>
                        <div className="text-sm line-clamp-4">{p.snippet || p.text}</div>
                      </motion.div>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-sm whitespace-pre-wrap text-xs">
                      {p.text}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
            </div>
          </div>
        )}

        {answer && (
          <div className="space-y-2">
            <h3 className="font-semibold">Answer</h3>
            {lowEvidence && (
              <div className="text-amber-300 text-sm bg-amber-500/10 border border-amber-400/20 rounded-md px-3 py-2">
                Evidence may be insufficient. Review carefully before relying on this draft.
              </div>
            )}
            {confidence !== null && (
              <div className="text-sm">
                <div className="opacity-70 mb-1">Confidence</div>
                <div className="w-full h-2 bg-white/10 rounded">
                  <div className="h-2 rounded bg-gradient-to-r from-sky-500 to-cyan-500" style={{ width: `${Math.round(confidence * 100)}%` }} />
                </div>
                <div className="text-xs opacity-70 mt-1">{Math.round(confidence * 100)}%</div>
              </div>
            )}
            {evalId && (
              <div className="flex gap-2 items-center">
                <button
                  className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/15"
                  onClick={async () => {
                    const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
                    await fetch(`${api}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eval_id: evalId, rating: 1 }) });
                    toast.success('Thanks for the feedback!');
                  }}
                >👍 Helpful</button>
                <button
                  className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/15"
                  onClick={async () => {
                    const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
                    await fetch(`${api}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eval_id: evalId, rating: 0 }) });
                    toast.success('Feedback recorded.');
                  }}
                >👎 Needs work</button>
              </div>
            )}
            <Accordion type="single" collapsible className="bg-white/5 rounded-xl border border-white/10">
              {(() => {
                const s = parseAnswerSections(answer);
                const doCopy = async (txt: string) => {
                  try { await navigator.clipboard.writeText(txt || ""); toast.success("Copied to clipboard"); } catch { toast.error("Copy failed"); }
                };
                return (
                  <>
                    <AccordionItem value="summary">
                      <AccordionTrigger>Executive Summary</AccordionTrigger>
                      <AccordionContent>
                        <div className="flex justify-end pr-3">
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => doCopy(s.summary)}>Copy</Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={async () => {
                              const space = window.prompt("Confluence space key?") || "";
                              if (!space) return;
                              await publishConfluence(space, `Summary: ${query.slice(0,80)}`, toHtml(s.summary || answer));
                            }}
                          >Insert to Confluence</Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={() => createLinearIssue(`Summary: ${query.slice(0,80)}`, s.summary || answer)}
                          >Insert to Linear</Button>
                        </div>
                        {renderAnswerWithLinks(s.summary || answer)}
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="risks">
                      <AccordionTrigger>Risks</AccordionTrigger>
                      <AccordionContent>
                        <div className="flex justify-end pr-3">
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => doCopy(s.risks)}>Copy</Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={async () => {
                              const space = window.prompt("Confluence space key?") || "";
                              if (!space) return;
                              await publishConfluence(space, `Risks: ${query.slice(0,80)}`, toHtml(s.risks || answer));
                            }}
                          >Insert to Confluence</Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={() => createLinearIssue(`Risks: ${query.slice(0,80)}`, s.risks || answer)}
                          >Insert to Linear</Button>
                        </div>
                        {renderAnswerWithLinks(s.risks || answer)}
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="draft">
                      <AccordionTrigger>Response Draft</AccordionTrigger>
                      <AccordionContent>
                        <div className="flex justify-end pr-3">
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => doCopy(s.draft)}>Copy</Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={async () => {
                              const space = window.prompt("Confluence space key?") || "";
                              if (!space) return;
                              await publishConfluence(space, `Draft: ${query.slice(0,80)}`, toHtml(s.draft || answer));
                            }}
                          >Insert to Confluence</Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={() => createLinearIssue(`Draft: ${query.slice(0,80)}`, s.draft || answer)}
                          >Insert to Linear</Button>
                        </div>
                        {renderAnswerWithLinks(s.draft || answer)}
                      </AccordionContent>
                    </AccordionItem>
                  </>
                );
              })()}
            </Accordion>
            <EvidenceBadgeList evidence={passages} onClick={(_, idx) => scrollToEvidence(idx + 1)} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}


