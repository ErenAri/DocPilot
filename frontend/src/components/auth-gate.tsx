"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

type Props = { children: React.ReactNode };

// Simple client-side guard: redirect to /login if no JWT
export default function AuthGate({ children }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("docpilot_token") : null;
      const isLogin = pathname === "/login";
      // Public paths (extend if needed)
      const isPublic = isLogin || pathname?.startsWith("/api") || pathname === "/favicon.ico";
      if (!token && !isPublic) {
        router.replace("/login");
      }
      if (token && isLogin) {
        router.replace("/ask");
      }
    } catch (_) {
      // no-op
    }
  }, [pathname, router]);

  return <>{children}</>;
}


