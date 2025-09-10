"use client";
import Link from "next/link";
import { ArrowRightCircle } from "lucide-react";
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
            <Link
              href="/ask"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-sky-500 to-cyan-500 text-white shadow-lg hover:from-sky-400 hover:to-cyan-400 transition focus:outline-none focus:ring-2 focus:ring-cyan-400/60"
            >
              <ArrowRightCircle className="w-5 h-5" aria-hidden />
              <span className="font-semibold">Go to Ask</span>
              <span className="sr-only">Navigate to Ask page</span>
            </Link>
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
