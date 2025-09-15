export const API_BASE = process.env.NEXT_PUBLIC_API_URL;
const ORG = process.env.NEXT_PUBLIC_ORG_ID;
const ROLE = process.env.NEXT_PUBLIC_ROLE || "viewer";

export function assertEnv(): void {
  if (!API_BASE) throw new Error("NEXT_PUBLIC_API_URL is required");
  if (!ORG) throw new Error("NEXT_PUBLIC_ORG_ID is required");
}

// Fail fast on import
assertEnv();

const API = API_BASE as string;
const ORG_ID = ORG as string;

export function H(json: boolean = true): Headers {
  const h = new Headers();
  if (json) h.set("Content-Type", "application/json");
  h.set("X-Org-Id", ORG_ID);
  h.set("X-Role", ROLE);
  return h;
}

export type DocumentInfo = { id: string; title: string; created_at: string; meta?: Record<string, unknown> | null };
export type Chunk = { id: string; ord: number; text: string; page?: number | null };
export type AnalyzeResult = { doc_id: string; clauses: Record<string, boolean>; risks: { item: string; severity: string }[] };
export type AnswerResult = {
  summary: string;
  checklist: string[];
  draft: string;
  evidence: { id: string; doc_id?: string; ord: number; page?: number | null; text: string }[];
};

export async function parseError(r: Response): Promise<string> {
  try {
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("json")) {
      const j = await r.json();
      return j?.error || j?.detail || JSON.stringify(j);
    }
    return await r.text();
  } catch {
    return `${r.status} ${r.statusText}`;
  }
}

export async function withRetry<T>(fn: () => Promise<T>, opts: { retries?: number; backoffMs?: number } = {}): Promise<T> {
  const { retries = 2, backoffMs = 300 } = opts;
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e; if (i === retries) break;
      await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, i)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function listDocuments(limit: number = 50, offset: number = 0): Promise<{ items: DocumentInfo[]; total: number }> {
  const url = `${API}/documents?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`;
  const r = await withRetry(() => fetch(url, { method: "GET", headers: H(), cache: "no-store" }));
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function getDocument(docId: string): Promise<{ chunks: Chunk[] }> {
  const r = await withRetry(() => fetch(`${API}/documents/${encodeURIComponent(docId)}`, { method: "GET", headers: H(), cache: "no-store" }));
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function analyzeDoc(docId: string): Promise<AnalyzeResult> {
  const r = await withRetry(() => fetch(`${API}/analyze/doc`, { method: "POST", headers: H(), body: JSON.stringify({ doc_id: docId }) }));
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function ask(query: string, keyword?: string): Promise<AnswerResult> {
  const r = await withRetry(() => fetch(`${API}/answer`, { method: "POST", headers: H(), body: JSON.stringify({ query, keyword }) }));
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function ingestFile(file: File, meta?: unknown): Promise<Record<string, unknown>> {
  const form = new FormData();
  form.append("file", file);
  if (meta !== undefined) form.append("meta", JSON.stringify(meta));
  const r = await withRetry(() => fetch(`${API}/ingest/file`, { method: "POST", headers: H(false), body: form }));
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}


