"use client";
import { useCallback, useMemo, useState } from "react";
import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Upload, FileText } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import Confetti from "@/components/confetti";
import { apiFetch } from "@/lib/api";
import { useRef } from "react";
import { FolderOpen } from "lucide-react";
import { motion } from "framer-motion";

export function UploadCard() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [ocr, setOcr] = useState(false);
  const [autoSplit, setAutoSplit] = useState(true);
  const [method, setMethod] = useState<"direct" | "s3">("direct");

  type QueueItem = { id: string; file: File; status: "pending" | "uploading" | "done" | "error"; progress: number; error?: string };
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueRef = useRef<QueueItem[]>([]);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  // Auto-start when there are pending items and not currently uploading
  useEffect(() => {
    const hasPending = (queueRef.current || []).some(q => q.status === "pending");
    if (hasPending && !isUploading) {
      setTimeout(() => { processQueue(); }, 0);
    }
  }, [queue, isUploading]);
  const [confettiTick, setConfettiTick] = useState(0);

  const onDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const fl = Array.from(e.dataTransfer.files || []).filter(f => {
      const name = (f.name || "").toLowerCase();
      return name.endsWith(".pdf") || name.endsWith(".docx") || name.endsWith(".txt");
    });
    if (fl.length) {
      addToQueue(fl);
      // Auto-start is handled by the queue useEffect
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }, []);

  function addToQueue(selected: File[]) {
    const next = selected.map((f) => ({ id: `${f.name}-${f.size}-${Date.now()}`, file: f, status: "pending" as const, progress: 0 }));
    setFiles(prev => [...prev, ...selected]);
    setQueue(prev => [...prev, ...next]);
    // Processing is triggered by the queue useEffect
  }

  async function uploadOneDirect(item: QueueItem) {
    const form = new FormData();
    form.append("file", item.file);
    form.append("title", title || item.file.name);
    form.append("meta", JSON.stringify({ ocr, auto_split: autoSplit }));
    const res = await apiFetch(`/ingest/file`, { method: "POST", body: form, timeoutMs: 180000 });
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  }

  async function uploadText() {
    if (!text.trim()) return;
    setIsUploading(true);
    try {
      const res = await apiFetch(`/ingest/text`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title || "Untitled", text }) });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      toast.success(`Ingested. doc_id: ${data.doc_id}, chunks: ${data.chunk_count}`);
    } catch (e: any) {
      toast.error(`Ingest failed: ${e.message}`);
    } finally {
      setIsUploading(false);
    }
  }

  async function uploadOneS3(item: QueueItem) {
    const presignRes = await apiFetch(`/upload/presign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: item.file.name, content_type: item.file.type || "application/octet-stream" }), timeoutMs: 60000 });
    if (!presignRes.ok) throw new Error(await presignRes.text());
    const { url, key, bucket } = await presignRes.json();
    const putRes = await fetch(url, { method: "PUT", headers: { "Content-Type": item.file.type || "application/octet-stream" }, body: item.file });
    if (!putRes.ok) throw new Error(`S3 upload failed: ${putRes.status}`);
    const ingestRes = await apiFetch(`/ingest/s3`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, bucket, title: title || item.file.name, meta: { ocr, auto_split: autoSplit } }), timeoutMs: 120000 });
    if (!ingestRes.ok) throw new Error(await ingestRes.text());
    return await ingestRes.json();
  }

  async function processQueue() {
    const current = queueRef.current || [];
    if (current.length === 0) {
      toast.info("Add a PDF first.");
      return;
    }
    setIsUploading(true);
    // Let the UI paint the loading state before we start uploads
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const pending = current.filter(q => q.status === "pending" || q.status === "error");
      for (const item of pending) {
        setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: "uploading", progress: 12, error: undefined } : q));
        // Start a gentle fake progress while uploading (caps at 85%)
        const tick = window.setInterval(() => {
          setQueue(prev => prev.map(q => q.id === item.id && q.status === "uploading"
            ? { ...q, progress: Math.min(85, (q.progress || 0) + 3) }
            : q));
        }, 700);
        try {
          const useS3 = method === "s3" || item.file.size > 5 * 1024 * 1024; // auto S3 for >5MB
          const data = await (useS3 ? uploadOneS3(item) : uploadOneDirect(item));
          toast.success(`Uploaded ${item.file.name}: doc_id=${data.doc_id}`);
          setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: "done", progress: 100 } : q));
          setConfettiTick(t => t + 1);
        } catch (e: any) {
          const isAbort = e?.name === "AbortError";
          const msg = isAbort ? "Upload timed out. Check API URL/CORS or try S3 method." : (e?.message ?? String(e));
          setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: "error", error: msg, progress: 0 } : q));
          toast.error(`${item.file.name}: ${msg}`);
        } finally { try { window.clearInterval(tick); } catch {} }
      }
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <Card className="relative rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-xl overflow-hidden">
      {confettiTick > 0 && <Confetti trigger={confettiTick} />}
      <CardHeader>
        <CardTitle className="text-xl font-bold tracking-tight">Upload & Ingest</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="title">Title (optional)</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Document title" className="h-11" />
        </div>

        <TooltipProvider delayDuration={100}>
          <div className="flex items-center gap-4 text-sm">
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="inline-flex items-center gap-2 cursor-pointer select-none"><input type="checkbox" checked={ocr} onChange={(e) => setOcr(e.target.checked)} /> OCR</label>
              </TooltipTrigger>
              <TooltipContent>Optical Character Recognition for scanned PDFs/images to extract text.</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="inline-flex items-center gap-2 cursor-pointer select-none"><input type="checkbox" checked={autoSplit} onChange={(e) => setAutoSplit(e.target.checked)} /> Auto-split by headings</label>
              </TooltipTrigger>
              <TooltipContent>Automatically split long documents into chunks based on headings.</TooltipContent>
            </Tooltip>
            <div className="ml-auto inline-flex items-center gap-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <label className="cursor-pointer select-none"><input type="radio" name="method" checked={method === "direct"} onChange={() => setMethod("direct")} /> Direct</label>
                </TooltipTrigger>
                <TooltipContent>Upload directly to the API (best for small files, quick demos).</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <label className="cursor-pointer select-none"><input type="radio" name="method" checked={method === "s3"} onChange={() => setMethod("s3")} /> S3</label>
                </TooltipTrigger>
                <TooltipContent>Use S3 presigned upload for large files and production workflows.</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </TooltipProvider>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="rounded-xl border border-dashed border-white/20 bg-white/5 hover:bg-white/10 transition p-6 text-center"
        >
          <div className="flex flex-col items-center gap-2">
            <Upload className="w-6 h-6 text-sky-300" />
            <p className="text-sm text-white/70">Drag & drop a PDF here or choose a file</p>
            <input
              ref={fileInputRef}
              multiple
              type="file"
              accept=".pdf,.docx,.txt"
              className="hidden"
              onChange={async (e) => {
                const arr = Array.from(e.target.files || []);
                if (arr.length === 0) return;
                addToQueue(arr);
                await new Promise<void>((r) => requestAnimationFrame(() => r()));
              }}
            />
            <Button
              type="button"
              onClick={() => requestAnimationFrame(() => fileInputRef.current?.click())}
              className="bg-white/10 hover:bg-white/15"
            >
              <span className="inline-flex items-center gap-2"><FolderOpen className="w-4 h-4" /> Choose File</span>
            </Button>
            {/* Auto-starts after choose/drop; manual start removed by request */}
          </div>
        </div>

        {queue.length > 0 && (
          <div className="space-y-2">
            <h3 className="font-semibold">Queue</h3>
            <div className="space-y-2">
              {queue.map(item => (
                <div key={item.id} className="flex items-center justify-between border border-white/10 rounded-md px-3 py-2 bg-white/5">
                  <div className="text-sm">
                    <div className="font-medium">{item.file.name}</div>
                    <div className="text-white/60 text-xs">{(item.file.size/1024/1024).toFixed(2)} MB • {item.status}</div>
                    {item.error && <div className="text-red-300 text-xs">{item.error}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-32 h-2 bg-white/10 rounded"><div className="h-2 bg-sky-500 rounded" style={{ width: `${item.progress}%` }} /></div>
                    {item.status === "error" && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: "pending", error: undefined } : q));
                          setTimeout(() => { processQueue(); }, 0);
                        }}
                      >Retry</Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setQueue(prev => prev.filter(q => q.id !== item.id))}>Remove</Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <details className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
          <summary className="cursor-pointer text-sm font-semibold">Raw Text (optional)</summary>
          <div className="text-xs text-white/70 -mt-1 mb-2">Paste plain text to ingest without uploading a file. Handy for quick tests and small notes.</div>
          <Label htmlFor="rawtext" className="sr-only">Raw Text</Label>
          <Textarea id="rawtext" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste text..." rows={6} className="resize-y bg-white/5" />
        </details>
        <div className="flex justify-between items-center">
          <div className="text-xs text-white/60">PDF uploads start automatically. Use this only for pasted text.</div>
          { (text.trim().length > 0) && (
            <Button onClick={uploadText} disabled={isUploading} className="bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-400 hover:to-cyan-400">
              {isUploading ? "Submitting..." : (
                <span className="inline-flex items-center gap-2"><FileText className="w-4 h-4" /> Ingest Raw Text</span>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}


