"use client";
import { useRef } from "react";
import { LogIn } from "lucide-react";
import { motion } from "framer-motion";
import { apiFetch } from "@/lib/api";

export default function LoginPage() {
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  const demos = [
    { label: "Admin", username: "admin", password: "admin123" },
    { label: "Analyst", username: "analyst", password: "analyst123" },
  ];

  return (
    <div className="p-4 max-w-sm mx-auto">
      <div className="text-center mb-4">
        <div className="inline-flex items-center gap-2">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow">
            <defs>
              <linearGradient id="lg-login" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#60A5FA" />
                <stop offset="100%" stopColor="#06B6D4" />
              </linearGradient>
            </defs>
            <rect x="3" y="3" width="18" height="18" rx="4" fill="url(#lg-login)" opacity="0.2" />
            <path d="M6 12.5C8.2 10 11 8.5 14 8.5C16 8.5 17.5 9 18.5 9.7" stroke="url(#lg-login)" strokeWidth="2" strokeLinecap="round" />
            <path d="M6 16C8.5 13.5 11 12.5 14 12.5C16 12.5 17.5 13 18.5 13.7" stroke="url(#lg-login)" strokeWidth="2" strokeLinecap="round" />
            <circle cx="9" cy="9" r="1.2" fill="#60A5FA" />
          </svg>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-blue-300 via-cyan-300 to-blue-300 bg-clip-text text-transparent">
            DocPilot
          </h1>
        </div>
      </div>
      <form
        className="space-y-3 bg-white/5 backdrop-blur border border-white/10 p-4 rounded-2xl"
        onSubmit={async (e) => {
          e.preventDefault();
          const username = userRef.current?.value || "";
          const password = passRef.current?.value || "";
          try {
            const res = await apiFetch(`/ap/logn`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ username, password }),
            });
            if (!res.ok) {
              const msg = await res.text().catch(() => "");
              alert(`Login failed${msg ? `: ${msg}` : ""}`);
              return;
            }
            let data: any = {};
            try { data = await res.json(); } catch {}
            // Support both cookie-mode (no token) and dev token mode
            if (process.env.NODE_ENV !== "production") {
              const token = (data && typeof data.token === "string" && data.token) ? data.token : "cookie";
              try { localStorage.setItem("docpilot_token", token); } catch {}
            }
            // After login, go to ingest (home) as requested
            window.location.href = "/";
          } catch (err) {
            alert("Login error: network/CORS");
          }
        }}
      >
        <h1 className="text-xl font-semibold mb-2">Login</h1>
        <div>
          <label className="block text-sm mb-1">Username</label>
          <input ref={userRef} name="username" className="w-full rounded bg-white/10 p-2" />
        </div>
        <div>
          <label className="block text-sm mb-1">Password</label>
          <input ref={passRef} name="password" type="password" className="w-full rounded bg-white/10 p-2" />
        </div>
        <motion.button
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.98 }}
          className="w-full mt-2 bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-500 hover:to-cyan-500 text-white rounded p-2 shadow transition-transform"
        >
          <span className="font-semibold tracking-wide">Sign In</span>
        </motion.button>
        <div className="mt-4 text-xs text-white/90">
          <div className="mb-1 font-medium">Demo Accounts</div>
          <div className="space-y-1">
            {demos.map((d) => (
              <div key={d.username} className="flex items-center justify-between bg-white/10 border border-white/15 rounded px-2 py-1">
                <span>
                  {d.label}: <span className="font-mono text-sky-200">{d.username}</span> / <span className="font-mono text-sky-200">{d.password}</span>
                </span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-sky-300 hover:text-white hover:border-sky-400/40 hover:bg-white/10 transition"
                  onClick={() => {
                    if (userRef.current) userRef.current.value = d.username;
                    if (passRef.current) passRef.current.value = d.password;
                  }}
                  title={`Use ${d.label} account`}
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Use</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      </form>
    </div>
  );
}
