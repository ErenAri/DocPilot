"use client";
import { usePathname } from "next/navigation";
import TopNav from "@/components/top-nav";
import GradientWaves from "@/components/gradient-waves";
import ChatLauncher from "@/components/chat-launcher";
// import FlowField from "@/components/flow-field";

export default function SiteFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login";
  return (
    <div className="relative min-h-screen bg-gradient-to-br from-slate-950 to-slate-900 text-white overflow-hidden">
      {/* Background: Gradient Waves (smooth) */}
      <GradientWaves bands={3} speed={0.6} amplitude={28} />
      {/** FlowField alternative:
       * <FlowField particles={800} fade={0.06} scale={0.0026} speed={0.9} color="#22d3ee" />
       */}
      <div className="mx-auto max-w-5xl p-4 relative z-10">
        {!isLogin && (
          <div className="mb-6">
            <TopNav />
          </div>
        )}
        {children}
        {!isLogin && (
          <footer className="mt-10 py-6 text-xs text-white/60">
            <div className="border-t border-white/10 pt-4 flex items-center justify-between">
              <div>© {new Date().getFullYear()} DocPilot</div>
              <div className="space-x-3">
                <a href="/ask" className="hover:underline">Ask</a>
                <a href="/ops" className="hover:underline">Ops</a>
              </div>
            </div>
          </footer>
        )}
      </div>
      <ChatLauncher />
    </div>
  );
}


