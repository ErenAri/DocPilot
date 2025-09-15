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
      // In production (cookie auth), allow access and let server enforce.
      if (process.env.NODE_ENV === "production") return;

      const token = typeof window !== "undefined" ? localStorage.getItem("docpilot_token") : null;
      const isLogin = pathname === "/login";
      // Public paths (extend if needed)
      const isPublic = isLogin || pathname?.startsWith("/api") || pathname === "/favicon.ico";
      // Treat string "cookie" as logged-in via httpOnly cookie
      const hasAuth = !!token && token !== "";
      if (!hasAuth && !isPublic) {
        router.replace("/login");
      }
      if (hasAuth && isLogin) {
        router.replace("/ask");
      }
    } catch (_) {
      // no-op
    }
  }, [pathname, router]);

  return <>{children}</>;
}


