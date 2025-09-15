export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function apiFetch(path: string, init?: (RequestInit & { timeoutMs?: number })) {
  // Increase default timeout to better accommodate slower endpoints (e.g., analysis, admin metrics)
  const timeoutMs = init?.timeoutMs ?? 20000;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const isProd = (process.env.NODE_ENV === "production");
    const token = !isProd && typeof window !== "undefined" ? localStorage.getItem("docpilot_token") : null;
    const orgId = typeof window !== "undefined" ? localStorage.getItem("docpilot_org_id") : null;
    const headers = new Headers(init?.headers || {});
    // In development, attach Bearer if present; in production ensure no Authorization header is sent
    if (isProd) {
      if (headers.has("Authorization")) headers.delete("Authorization");
    } else if (token && !headers.has("Authorization")) {
      // If token is a placeholder (cookie-mode), do not send Bearer header
      if (token !== "cookie") headers.set("Authorization", `Bearer ${token}`);
    }
    // Organization & role headers (required by API). Default to demo/viewer if not provided
    if (!headers.has("X-Org-Id")) headers.set("X-Org-Id", orgId || "demo");
    if (!headers.has("X-Role")) headers.set("X-Role", "viewer");
    // Optional API key support
    const publicApiKey = process.env.NEXT_PUBLIC_API_KEY;
    if (publicApiKey && !headers.has("X-Api-Key")) headers.set("X-Api-Key", publicApiKey);
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
      // Always include cookies (dev and prod)
      credentials: "include",
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}
