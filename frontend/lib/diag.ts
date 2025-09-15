import { H, assertEnv } from "./api";

assertEnv();

export async function checkHealth(): Promise<boolean> {
  try {
    const base = process.env.NEXT_PUBLIC_API_URL as string;
    const r = await fetch(`${base}/health`, { method: "GET", headers: H(), cache: "no-store" });
    if (!r.ok) return false;
    return true;
  } catch {
    return false;
  }
}


