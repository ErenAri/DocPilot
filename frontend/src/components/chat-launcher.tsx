"use client";
import { useEffect, useRef, useState } from "react";
import { MessageSquare, X, Send, Link2, RotateCcw, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";

type Msg = { role: "user" | "assistant"; content: string };

export default function ChatLauncher() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [useSel, setUseSel] = useState(true);
  const [selPreview, setSelPreview] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let hydrated = false;
    try {
      const raw = sessionStorage.getItem("docpilot_chat");
      if (raw) {
        setMsgs(JSON.parse(raw));
        hydrated = true;
      }
    } catch {}
    try {
      const s = (window.getSelection()?.toString() || "").trim();
      if (s) setSelPreview(s.slice(0, 180));
      else setSelPreview("");
    } catch {}
    // Seed a friendly greeting if no history
    if (!hydrated) {
      setMsgs([{ role: "assistant", content: "Hello — how can I help you today? Ask about your documents, and I’ll cite the exact passages. If you’ve selected text on the page, I’ll use it as context." }]);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    try { sessionStorage.setItem("docpilot_chat", JSON.stringify(msgs.slice(-10))); } catch {}
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, open]);

  function refreshAll() {
    try {
      const raw = sessionStorage.getItem("docpilot_chat");
      if (raw) setMsgs(JSON.parse(raw));
      else setMsgs([{ role: "assistant", content: "Hello — how can I help you today? Ask about your documents, and I’ll cite the exact passages. If you’ve selected text on the page, I’ll use it as context." }]);
    } catch {
      setMsgs([{ role: "assistant", content: "Hello — how can I help you today?" }]);
    }
    try {
      const s = (window.getSelection()?.toString() || "").trim();
      setSelPreview(s.slice(0, 180));
    } catch { setSelPreview(""); }
  }

  function clearChat() {
    try { sessionStorage.removeItem("docpilot_chat"); } catch {}
    setMsgs([{ role: "assistant", content: "Hello — how can I help you today?" }]);
  }

  async function ask() {
    const q = input.trim();
    if (!q) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setBusy(true);
    try {
      // Small-talk shortcut: don't call backend for greetings
      if (/^(hi|hello|hey|selam|merhaba|hola|ciao|h(i|e)y?a?)\b/i.test(q) && q.split(/\s+/).length <= 3) {
        setMsgs((m) => [...m, { role: "assistant", content: "Hi! You can upload a PDF from the Ingest section and then ask a question here. I’ll cite exact passages from your documents. How can I help?" }]);
        return;
      }
      let query = q;
      if (useSel) {
        try {
          const s = (window.getSelection()?.toString() || "").trim();
          if (s) query = `Context (selected):\n${s.slice(0, 1500)}\n\nQuestion: ${q}`;
        } catch {}
      }
      const res = await apiFetch("/answer", { method: "POST", body: JSON.stringify({ query, top_k: 5 }), timeoutMs: 25000 });
      if (!res.ok) throw new Error(await res.text());
      const j = await res.json();
      let a = String(j?.answer || "");
      if (j?.low_evidence === true) {
        a = "I couldn't find enough evidence in indexed documents. Try uploading a file on the Ingest page and ask again (I'll cite exact passages).";
      }
      setMsgs((m) => [...m, { role: "assistant", content: a }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "assistant", content: `Error: ${e?.message || "failed"}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (next) {
              try {
                const raw = sessionStorage.getItem("docpilot_chat");
                if (!raw) {
                  const seed = [{ role: "assistant", content: "Hello — how can I help you today? Ask about your documents, and I’ll cite the exact passages. If you’ve selected text on the page, I’ll use it as context." } as Msg];
                  sessionStorage.setItem("docpilot_chat", JSON.stringify(seed));
                  setMsgs(seed);
                }
              } catch {}
            }
            return next;
          });
        }}
        className="fixed z-40 bottom-4 right-4 rounded-full p-3 bg-gradient-to-r from-sky-500 to-cyan-500 text-white shadow-lg hover:from-sky-400 hover:to-cyan-400"
        aria-label="Open chat"
      >
        {open ? <X className="w-5 h-5" /> : <MessageSquare className="w-5 h-5" />}
      </button>
      {open && (
        <div className="fixed z-40 bottom-20 right-4 w-[380px] max-h-[72vh] rounded-2xl bg-white/10 backdrop-blur border border-white/15 shadow-2xl overflow-hidden flex flex-col">
          <div className="px-3 py-2 text-sm font-semibold border-b border-white/10">Quick Ask</div>
          <div className="flex-1 overflow-auto p-3 space-y-2 text-sm">
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                <div className={`${m.role === "user" ? "bg-sky-500/20" : "bg-white/10"} inline-block rounded-xl px-3 py-2 max-w-[90%] whitespace-pre-wrap`}>{m.content}</div>
              </div>
            ))}
            {useSel && selPreview && (
              <div className="text-[11px] opacity-70 bg-white/5 rounded-lg p-2">
                <div className="inline-flex items-center gap-1 mb-1"><Link2 className="w-3.5 h-3.5" /> Using page selection</div>
                <div className="line-clamp-3 whitespace-pre-wrap">{selPreview}</div>
              </div>
            )}
            <div ref={endRef} />
          </div>
          <div className="p-2 border-t border-white/10">
            <form
              onSubmit={(e) => { e.preventDefault(); if (!busy) ask(); }}
              className="flex items-center gap-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask…"
                className="flex-1 bg-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400/60"
              />
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-1 bg-white/10 hover:bg-white/15 text-white rounded-xl px-3 py-2 text-sm disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                Send
              </button>
            </form>
            <div className="flex items-center justify-between mt-2 text-[11px] opacity-80">
              <label className="inline-flex items-center gap-1 cursor-pointer select-none">
                <input type="checkbox" checked={useSel} onChange={(e) => setUseSel(e.target.checked)} />
                Use current selection as context
              </label>
              <div className="inline-flex items-center gap-2">
                <button
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-sky-300 hover:text-white hover:border-sky-400/40 hover:bg-white/10 transition"
                  onClick={() => refreshAll()}
                  type="button"
                  title="Refresh chat & selection"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Refresh
                </button>
                <button
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-red-300 hover:text-white hover:border-red-400/40 hover:bg-white/10 transition"
                  onClick={() => clearChat()}
                  type="button"
                  title="Clear chat history"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Clear
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


