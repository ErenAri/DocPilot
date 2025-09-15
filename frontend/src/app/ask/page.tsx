"use client";
import Link from "next/link";
import { AnswerPanel } from "@/components/answer-panel";
import { motion } from "framer-motion";
import { AnalyticsCard } from "@/components/analytics-card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { AnalyzeCard } from "@/components/analyze-card";
import { InsightsCard } from "@/components/insights-card";
import { apiFetch } from "@/lib/api";

export default function AskPage() {
  async function seedDemo() {
    try {
      const res = await apiFetch(`/demo/seed`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      toast.success(`Seeded demo: doc_id=${data.doc_id} chunks=${data.chunks}`);
    } catch (e: any) {
      toast.error(`Seed failed: ${e.message}`);
    }
  }
  return (
    <div className="p-2 sm:p-4">
      <div className="max-w-3xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-8"
        >
          <div className="inline-flex items-center justify-center px-5 py-3 rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-xl">
            <h1 className="text-3xl md:text-5xl font-bold tracking-tight bg-gradient-to-r from-blue-300 via-cyan-300 to-blue-300 bg-clip-text text-transparent">
              Ask Your Documents
            </h1>
          </div>
          <div className="mt-4 flex items-center justify-center gap-3">
            <Link href="/" className="text-sky-300 hover:text-sky-200 transition underline">Back to Ingest →</Link>
            <Button onClick={seedDemo} className="bg-white/10 hover:bg-white/15">Seed Demo</Button>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-xl p-4 md:p-6"
        >
          <AnswerPanel />
        </motion.div>

        <div className="mt-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
          >
            <AnalyticsCard />
          </motion.div>
        </div>

        <div className="mt-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <AnalyzeCard />
          </motion.div>
        </div>

        <div className="mt-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25 }}
          >
            <InsightsCard />
          </motion.div>
        </div>
      </div>
    </div>
  );
}


