"use client";
import { useCallback, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Upload, FileText } from "lucide-react";
import { motion } from "framer-motion";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function UploadCard() {
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [ocr, setOcr] = useState(false);
  const [autoSplit, setAutoSplit] = useState(true);
  const [method, setMethod] = useState<"direct" | "s3">("direct");

  type QueueItem = { id: string; file: File; status: "pending" | "uploading" | "done" | "error"; progress: number; error?: string };
  const [queue, setQueue] = useState<QueueItem[]>([]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const fl = Array.from(e.dataTransfer.files || []).filter(f => f.type === "application/pdf");
    if (fl.length) addToQueue(fl);
  }, []);

  function addToQueue(selected: File[]) {
    const next = selected.map((f) => ({ id: `${f.name}-${f.size}-${Date.now()}`, file: f, status: "pending" as const, progress: 0 }));
    setFiles(prev => [...prev, ...selected]);
    setQueue(prev => [...prev, ...next]);
  }

  async function uploadOneDirect(item: QueueItem) {
    const form = new FormData();
    form.append("file", item.file);
    form.append("title", title || item.file.name);
    form.append("meta", JSON.stringify({ ocr, auto_split: autoSplit }));
    const res = await fetch(`${API_URL}/ingest/file`, { method: "POST", body: form });
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  }

  async function uploadText() {
    if (!text.trim()) return;
    setIsUploading(true);
    try {
      const res = await fetch(`${API_URL}/ingest/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title || "Untitled", text }),
      });
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
    const presignRes = await fetch(`${API_URL}/upload/presign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: item.file.name, content_type: item.file.type || "application/octet-stream" }),
    });
    if (!presignRes.ok) throw new Error(await presignRes.text());
    const { url, key, bucket } = await presignRes.json();
    const putRes = await fetch(url, { method: "PUT", headers: { "Content-Type": item.file.type || "application/octet-stream" }, body: item.file });
    if (!putRes.ok) throw new Error(`S3 upload failed: ${putRes.status}`);
    const ingestRes = await fetch(`${API_URL}/ingest/s3`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, bucket, title: title || item.file.name, meta: { ocr, auto_split: autoSplit } }),
    });
    if (!ingestRes.ok) throw new Error(await ingestRes.text());
    return await ingestRes.json();
  }

  async function processQueue() {
    setIsUploading(true);
    try {
      const pending = queue.filter(q => q.status === "pending" || q.status === "error");
      for (const item of pending) {
        setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: "uploading", progress: 10, error: undefined } : q));
        try {
          const data = await (method === "direct" ? uploadOneDirect(item) : uploadOneS3(item));
          toast.success(`Uploaded ${item.file.name}: doc_id=${data.doc_id}`);
          setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: "done", progress: 100 } : q));
        } catch (e: any) {
          setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: "error", error: e.message ?? String(e), progress: 0 } : q));
          toast.error(`${item.file.name}: ${e.message}`);
        }
      }
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <Card className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-xl">
      <CardHeader>
        <CardTitle className="text-xl font-bold tracking-tight">Upload & Ingest</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="title">Title (optional)</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Document title" className="h-11" />
        </div>

        <div className="flex items-center gap-4 text-sm">
          <label className="inline-flex items-center gap-2 cursor-pointer select-none"><input type="checkbox" checked={ocr} onChange={(e) => setOcr(e.target.checked)} /> OCR</label>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none"><input type="checkbox" checked={autoSplit} onChange={(e) => setAutoSplit(e.target.checked)} /> Auto-split by headings</label>
          <div className="ml-auto inline-flex items-center gap-2">
            <label className="cursor-pointer select-none"><input type="radio" name="method" checked={method === "direct"} onChange={() => setMethod("direct")} /> Direct</label>
            <label className="cursor-pointer select-none"><input type="radio" name="method" checked={method === "s3"} onChange={() => setMethod("s3")} /> S3</label>
          </div>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="rounded-xl border border-dashed border-white/20 bg-white/5 hover:bg-white/10 transition p-6 text-center"
        >
          <div className="flex flex-col items-center gap-2">
            <Upload className="w-6 h-6 text-sky-300" />
            <p className="text-sm text-white/70">Drag & drop a PDF here or choose a file</p>
            <Input multiple type="file" accept="application/pdf" onChange={(e) => addToQueue(Array.from(e.target.files || []))} className="mt-2" />
            <div className="flex gap-2 mt-2">
              <Button onClick={processQueue} disabled={queue.length === 0 || isUploading} className="bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-400 hover:to-cyan-400">
                {isUploading ? "Processing..." : (
                  <span className="inline-flex items-center gap-2"><Upload className="w-4 h-4" /> Start Upload</span>
                )}
              </Button>
            </div>
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
                      <Button size="sm" onClick={() => setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: "pending", error: undefined } : q))}>Retry</Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setQueue(prev => prev.filter(q => q.id !== item.id))}>Remove</Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label>Raw Text</Label>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste text..." rows={6} className="resize-y bg-white/5" />
          <Button onClick={uploadText} disabled={!text.trim() || isUploading} className="bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-400 hover:to-cyan-400">
            {isUploading ? "Submitting..." : (
              <span className="inline-flex items-center gap-2"><FileText className="w-4 h-4" /> Ingest Text</span>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}


