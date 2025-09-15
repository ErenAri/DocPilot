"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={
        "px-3 py-1.5 rounded-md transition " +
        (active
          ? "bg-white/10 text-white"
          : "text-white/80 hover:text-white hover:bg-white/5")
      }
    >
      {label}
    </Link>
  );
}

export function TopNav() {
  const router = useRouter();
  const [org, setOrg] = (typeof window !== "undefined")
    ? [localStorage.getItem("docpilot_org_id") || "demo", (v: string) => { try { localStorage.setItem("docpilot_org_id", v); } catch {} }]
    : ["demo", (_v: string) => {}];
  return (
    <div className="sticky top-0 z-50">
      <div className="backdrop-blur bg-white/5 border border-white/10 rounded-2xl shadow-xl">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <Link href="/" className="font-semibold tracking-tight inline-flex items-center gap-2">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow">
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#60A5FA" />
                  <stop offset="100%" stopColor="#06B6D4" />
                </linearGradient>
              </defs>
              <rect x="3" y="3" width="18" height="18" rx="4" fill="url(#g1)" opacity="0.2" />
              <path d="M6 12.5C8.2 10 11 8.5 14 8.5C16 8.5 17.5 9 18.5 9.7" stroke="url(#g1)" strokeWidth="2" strokeLinecap="round" />
              <path d="M6 16C8.5 13.5 11 12.5 14 12.5C16 12.5 17.5 13 18.5 13.7" stroke="url(#g1)" strokeWidth="2" strokeLinecap="round" />
              <circle cx="9" cy="9" r="1.2" fill="#60A5FA" />
            </svg>
            <span className="bg-gradient-to-r from-blue-300 via-cyan-300 to-blue-300 bg-clip-text text-transparent">
              DocPilot
            </span>
          </Link>
          <div className="flex items-center gap-1">
            <NavLink href="/" label="Ingest" />
            <NavLink href="/documents" label="Documents" />
            <NavLink href="/ask" label="Ask" />
            <NavLink href="/ops" label="Ops" />
            <NavLink href="/admin" label="Admin" />
            
            <button
              onClick={() => {
                try { localStorage.removeItem("docpilot_token"); } catch (_) {}
                router.replace("/login");
              }}
              className="ml-2 px-3 py-1.5 rounded-md text-white/80 hover:text-white hover:bg-white/5 transition"
            >Logout</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TopNav;


