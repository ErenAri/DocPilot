"use client";
import Link from "next/link";
import { UploadCard } from "@/components/upload-card";
import { motion } from "framer-motion";

export default function Home() {
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
              DocPilot
            </h1>
          </div>
          <p className="mt-4 text-sm md:text-base text-white/70">Upload & Analyze Documents Smarter</p>
          <div className="mt-4">
            <Link href="/ask" className="text-sky-300 hover:text-sky-200 transition underline">Go to Ask →</Link>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-xl p-4 md:p-6"
        >
          <UploadCard />
        </motion.div>
      </div>
    </div>
  );
}
