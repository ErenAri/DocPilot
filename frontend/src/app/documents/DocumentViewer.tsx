"use client";
import type { Chunk } from "../../../lib/actions";

export interface DocumentViewerProps {
  title: string;
  id: string;
  chunks: Chunk[];
  loading: boolean;
  find: string;
  onFindChange: (v: string) => void;
}

function highlight(text: string, query: string) {
  if (!query.trim()) return text;
  try {
    const esc = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(esc, "gi");
    const parts: (string | JSX.Element)[] = [];
    let last = 0; let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index; const end = start + m[0].length;
      if (start > last) parts.push(text.slice(last, start));
      parts.push(<mark key={start} className="bg-yellow-300/40 text-inherit">{text.slice(start, end)}</mark>);
      last = end;
      if (re.lastIndex === start) re.lastIndex++;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  } catch {
    return text;
  }
}

export function DocumentViewer({ title, id, chunks, loading, find, onFindChange }: DocumentViewerProps) {
  return (
    <div className="space-y-3">
      <div className="text-sm">
        <input
          placeholder="Find in doc..."
          value={find}
          onChange={(e) => onFindChange(e.target.value)}
          className="h-9 max-w-xs bg-transparent border border-white/15 rounded px-2"
        />
      </div>
      <div className="max-h-[40vh] overflow-auto text-sm leading-[1.6] space-y-3">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-4 rounded bg-white/10 animate-pulse" />
            ))}
          </div>
        ) : chunks.length === 0 ? (
          <div className="text-sm text-white/70">No content.</div>
        ) : (
          chunks.map(c => (
            <div key={c.id} className="border border-white/10 rounded p-2 bg-white/5">
              <div className="text-xs text-white/60 mb-1">ord {c.ord}{c.page != null ? ` • p${c.page}` : ""}</div>
              <div className="whitespace-pre-wrap">{highlight(c.text, find)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default DocumentViewer;


