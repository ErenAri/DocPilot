export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function apiFetch(path: string, init?: (RequestInit & { timeoutMs?: number })) {
  const timeoutMs = init?.timeoutMs ?? 8000;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const isProd = (process.env.NODE_ENV === "production");
    const token = !isProd && typeof window !== "undefined" ? localStorage.getItem("docpilot_token") : null;
    const orgId = typeof window !== "undefined" ? localStorage.getItem("docpilot_org_id") : null;
    const headers = new Headers(init?.headers || {});
    // In production, don't attach Authorization; rely on cookies
    if (!isProd && token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
    if (orgId && !headers.has("X-Org-Id")) headers.set("X-Org-Id", orgId);
    // Only set JSON content type for plain JSON bodies
    const bodyAny = init?.body as any;
    const isFormData = typeof FormData !== "undefined" && bodyAny instanceof FormData;
    const isBlob = typeof Blob !== "undefined" && bodyAny instanceof Blob;
    if (!headers.has("Content-Type") && init?.body && !isFormData && !isBlob) {
      headers.set("Content-Type", "application/json");
    }
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers,
      // Allow cookies in production
      credentials: isProd ? "include" : (init?.credentials || "same-origin"),
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}
