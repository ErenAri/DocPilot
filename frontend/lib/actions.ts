import type { DocumentInfo, Chunk, AnalyzeResult, AnswerResult, LoginResp } from "./api";
import { listDocuments as apiListDocuments, getDocument as apiGetDocument, analyzeDoc as apiAnalyzeDoc, ask as apiAsk, ingestFile as apiIngestFile, API_BASE, H, login as apiLogin } from "./api";
import { apiFetch } from "@/lib/api";

export type Result<T, E = string> = { ok: true; data: T } | { ok: false; error: E };

export async function listDocuments(limit: number, offset: number): Promise<Result<{ items: DocumentInfo[]; total: number }>> {
  try {
    const data = await apiListDocuments(limit, offset);
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function getDocument(docId: string): Promise<Result<{ chunks: Chunk[] }>> {
  try {
    const data = await apiGetDocument(docId);
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function analyzeDoc(docId: string): Promise<Result<AnalyzeResult>> {
  try {
    const data = await apiAnalyzeDoc(docId);
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function ask(query: string, keyword?: string): Promise<Result<AnswerResult>> {
  try {
    const data = await apiAsk(query, keyword);
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function ingestFile(file: File, meta?: unknown): Promise<Result<Record<string, unknown>>> {
  try {
    const data = await apiIngestFile(file, meta);
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export type { DocumentInfo, Chunk, AnalyzeResult, AnswerResult };

export async function deleteDocument(docId: string): Promise<Result<{ status: string }>> {
  try {
    const r = await apiFetch(`/documents/${encodeURIComponent(docId)}`, { method: "DELETE" });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function login(username: string, password: string): Promise<Result<LoginResp>> {
  try {
    const data = await apiLogin(username, password);
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}


