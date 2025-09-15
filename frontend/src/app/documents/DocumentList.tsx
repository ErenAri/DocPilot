"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DocumentInfo } from "../../../lib/actions";
import { deleteDocument } from "../../../lib/actions";
import { Trash } from "lucide-react";
import { useState } from "react";

export interface DocumentListProps {
  docs: DocumentInfo[];
  loading: boolean;
  hasMore: boolean;
  loadMorePending: boolean;
  onLoadMore: () => void;
  filtered: DocumentInfo[];
  selectedId: string | null;
  bulkMode: boolean;
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  onSelect: (id: string) => void;
}

export function DocumentList({ docs, loading, hasMore, loadMorePending, onLoadMore, filtered, selectedId, bulkMode, selectedIds, toggleSelect, onSelect }: DocumentListProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  useEffect(() => {
    try {
      const role = (typeof window !== "undefined" ? localStorage.getItem("docpilot_role") : "") || "";
      setIsAdmin(role.toLowerCase() === "admin");
    } catch {}
  }, []);

  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      const ratio = (el.scrollTop + el.clientHeight) / Math.max(1, el.scrollHeight);
      if (ratio > 0.8 && hasMore && !loadMorePending && !loading) onLoadMore();
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [hasMore, loadMorePending, loading, onLoadMore]);

  function formatDate(iso: string) {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }

  return (
    <div ref={listRef} className="max-h-[70vh] overflow-auto divide-y divide-white/10" role="list">
      {loading && (
        <div className="p-3 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-5 rounded bg-white/10 animate-pulse" />
          ))}
        </div>
      )}
      {!loading && filtered.length === 0 && (
        <div className="p-3 text-sm text-white/70">No documents found. <span className="underline">Upload PDF/TXT</span></div>
      )}
      {!loading && filtered.map(d => {
        const entries = Object.entries(d.meta || {}).slice(0, 3);
        return (
          <button
            key={d.id}
            role="listitem"
            onClick={(e) => {
              if (bulkMode) { e.preventDefault(); toggleSelect(d.id); } else { onSelect(d.id); }
            }}
            className={`w-full text-left p-3 hover:bg-white/5 transition ${selectedId === d.id ? "bg-white/10" : ""}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {bulkMode && (
                  <input
                    type="checkbox"
                    onClick={(e) => e.stopPropagation()}
                    checked={selectedIds.has(d.id)}
                    onChange={() => toggleSelect(d.id)}
                  />
                )}
                <div className="font-medium truncate">{d.title || d.id}</div>
              </div>
              <div className="flex items-center gap-2 whitespace-nowrap">
                <div className="text-xs text-white/60">{formatDate(d.created_at)}</div>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={async (ev) => {
                      ev.stopPropagation();
                      setConfirmFor(d.id);
                    }}
                    className="inline-flex items-center justify-center h-6 w-6 rounded bg-red-500/15 border border-red-400/30 hover:bg-red-500/25 text-red-300 hover:text-red-200"
                    title="Delete document"
                    aria-label="Delete document"
                  >
                    <Trash className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            {entries.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {entries.map(([k, v]) => (
                  <span key={k} className="text-xs px-2 py-0.5 rounded-full bg-white/10 border border-white/15">
                    {k}: {String(typeof v === "object" ? JSON.stringify(v) : v).slice(0, 24)}
                  </span>
                ))}
              </div>
            )}
          </button>
        );
      })}
      {!loading && hasMore && (
        <div className="p-3 text-xs text-white/60">{loadMorePending ? "Loading more…" : "Scroll for more"}</div>
      )}
    </div>
    {confirmFor && (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/60" onClick={() => setConfirmFor(null)} />
        <div className="relative z-10 w-[min(420px,94vw)] rounded-2xl bg-slate-900 border border-white/10 p-4 text-white shadow-xl">
          <div className="text-base font-semibold mb-1">Delete document?</div>
          <div className="text-sm text-white/70 mb-3">This action cannot be undone.</div>
          <div className="flex justify-end gap-2">
            <button
              className="px-3 py-1.5 rounded border border-white/15 bg-white/5 hover:bg-white/10"
              onClick={() => setConfirmFor(null)}
            >Cancel</button>
            <button
              className="px-3 py-1.5 rounded border border-red-400/30 bg-red-500/20 hover:bg-red-500/30 text-red-200"
              disabled={deleting === confirmFor}
              onClick={async () => {
                if (!confirmFor) return;
                setDeleting(confirmFor);
                const res = await deleteDocument(confirmFor);
                setDeleting(null);
                if (!res.ok) {
                  alert(`Delete failed: ${res.error}`);
                } else {
                  setConfirmFor(null);
                  window.location.reload();
                }
              }}
            >{deleting === confirmFor ? 'Deleting…' : 'Delete'}</button>
          </div>
        </div>
      </div>
    )}
  );
}

export default DocumentList;


