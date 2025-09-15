export const API_BASE = process.env.NEXT_PUBLIC_API_URL;
const ORG = process.env.NEXT_PUBLIC_ORG_ID;
const ROLE = process.env.NEXT_PUBLIC_ROLE || "viewer";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY;

export function assertEnv(): void {
  if (!API_BASE) throw new Error("NEXT_PUBLIC_API_URL is required");
  if (!ORG) throw new Error("NEXT_PUBLIC_ORG_ID is required");
}

// Fail fast on import
assertEnv();

const API = API_BASE as string;
const ORG_ID = ORG as string;

// Ensure cookies (JWT auth) are sent on cross-origin requests
const WITH_CREDENTIALS: RequestInit = { credentials: 'include' };

// Lightweight auth token handling for local dev (Bearer fallback when cookie is not sent)
let _authToken: string | null = null;
function getToken(): string | null {
  if (_authToken) return _authToken;
  if (typeof window !== 'undefined') {
    try { _authToken = window.localStorage.getItem('docpilot_token'); } catch {}
  }
  return _authToken;
}
export function setAuthToken(token: string | null) {
  _authToken = token;
  if (typeof window !== 'undefined') {
    try {
      if (token) window.localStorage.setItem('docpilot_token', token);
      else window.localStorage.removeItem('docpilot_token');
    } catch {}
  }
}

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers((init.headers as HeadersInit) || {});
  const t = getToken();
  if (t && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${t}`);
  return fetch(`${API}${path}`, { ...WITH_CREDENTIALS, ...init, headers });
}

export function H(json: boolean = true): Headers {
  const h = new Headers();
  if (json) h.set("Content-Type", "application/json");
  h.set("X-Org-Id", ORG_ID);
  h.set("X-Role", ROLE);
  if (API_KEY) h.set("X-Api-Key", API_KEY);
  const t = getToken();
  if (t) h.set('Authorization', `Bearer ${t}`);
  return h;
}

export type DocumentInfo = { id: string; title: string; created_at: string; meta?: Record<string, unknown> | null };
export type Chunk = { id: string; ord: number; text: string; page?: number | null };
export type AnalyzeResult = { doc_id: string; clauses: Record<string, boolean>; risks: { item: string; severity: string }[] };
export type AnswerResult = {
  answer: string;
  evidence: { id: string; doc_id?: string; ord: number; page?: number | null; text: string }[];
  low_evidence?: boolean;
  confidence?: number;
  eval_id?: string;
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
  const r = await withRetry(() => fetch(url, { method: "GET", headers: H(), cache: "no-store", ...WITH_CREDENTIALS }));
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function getDocument(docId: string): Promise<{ chunks: Chunk[] }> {
  const r = await withRetry(() => fetch(`${API}/documents/${encodeURIComponent(docId)}`, { method: "GET", headers: H(), cache: "no-store", ...WITH_CREDENTIALS }));
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function analyzeDoc(docId: string): Promise<AnalyzeResult> {
  const r = await withRetry(() => fetch(`${API}/analyze/doc`, { method: "POST", headers: H(), body: JSON.stringify({ doc_id: docId }), ...WITH_CREDENTIALS }));
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function ask(query: string, keyword?: string, opts?: { docId?: string; answerMode?: 'structured' | 'concise' }): Promise<AnswerResult> {
  const body: any = { query, keyword, doc_id: opts?.docId, answer_mode: opts?.answerMode };
  let r = await withRetry(() => fetch(`${API}/answer`, { method: "POST", headers: H(), body: JSON.stringify(body), ...WITH_CREDENTIALS }));
  if (r.status === 401 || r.status === 403) {
    const demoUser = process.env.NEXT_PUBLIC_DEMO_USER;
    const demoPass = process.env.NEXT_PUBLIC_DEMO_PASS;
    if (demoUser && demoPass) {
      try { await login(demoUser, demoPass); } catch {}
      r = await fetch(`${API}/answer`, { method: "POST", headers: H(), body: JSON.stringify(body), ...WITH_CREDENTIALS });
    }
  }
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function ingestFile(file: File, meta?: unknown): Promise<Record<string, unknown>> {
  const form = new FormData();
  form.append("file", file);
  if (meta !== undefined) form.append("meta", JSON.stringify(meta));
  let r = await withRetry(() => fetch(`${API}/ingest/file`, { method: "POST", headers: H(false), body: form, ...WITH_CREDENTIALS }));
  if (r.status === 401 || r.status === 403) {
    const demoUser = process.env.NEXT_PUBLIC_DEMO_USER;
    const demoPass = process.env.NEXT_PUBLIC_DEMO_PASS;
    if (demoUser && demoPass) {
      try { await login(demoUser, demoPass); } catch {}
      r = await fetch(`${API}/ingest/file`, { method: "POST", headers: H(false), body: form, ...WITH_CREDENTIALS });
    }
  }
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export type LoginResp = { token?: string; user_id: string; username: string; org_id?: string | null };
export async function login(username: string, password: string): Promise<LoginResp> {
  const r = await apiFetch(`/ap/logn`, { method: 'POST', headers: H(), body: JSON.stringify({ username, password }) });
  if (!r.ok) throw new Error(await parseError(r));
  const data = await r.json();
  // In local dev, backend may include token in body — persist as Bearer fallback
  if (data?.token) setAuthToken(data.token);
  return data as LoginResp;
}


