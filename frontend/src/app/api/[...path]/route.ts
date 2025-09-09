import { NextRequest } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function proxy(req: NextRequest, { params }: { params: { path: string[] } }) {
  const url = `${API_URL}/${params.path.join("/")}`;
  const init: RequestInit = {
    method: req.method,
    headers: Object.fromEntries(req.headers),
    body: req.method !== "GET" && req.method !== "HEAD" ? await req.arrayBuffer() : undefined,
    redirect: "manual",
  };
  const resp = await fetch(url, init);
  const headers = new Headers(resp.headers);
  // Allow browser download for export/pdf
  headers.set("Access-Control-Expose-Headers", "Content-Disposition");
  return new Response(resp.body, { status: resp.status, headers });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE };


