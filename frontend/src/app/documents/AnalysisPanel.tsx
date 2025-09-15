"use client";
import type { AnalyzeResult } from "../../../lib/actions";

export interface AnalysisPanelProps {
  analysis: AnalyzeResult | null;
}

function humanize(key: string) {
  const s = (key || "").replace(/_/g, " ").trim();
  return s.replace(/\b\w/g, (m) => m.toUpperCase());
}

export function AnalysisPanel({ analysis }: AnalysisPanelProps) {
  return (
    <div className="pt-2 border-t border-white/10">
      <h3 className="text-sm font-semibold mb-2">Compliance Analysis</h3>
      {analysis ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {Object.entries(analysis.clauses || {}).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 p-2 rounded border border-white/10 bg-white/5">
                <span className={`h-2.5 w-2.5 rounded-full ${v ? "bg-green-400" : "bg-red-400"}`} />
                <span className="text-sm">{humanize(k)}</span>
              </div>
            ))}
            {Object.keys(analysis.clauses || {}).length === 0 && (
              <div className="text-sm text-white/60">No clauses returned.</div>
            )}
          </div>
          <div>
            {analysis.risks && analysis.risks.length > 0 ? (
              <ul className="list-disc list-inside space-y-1">
                {analysis.risks.map((r, i) => (
                  <li key={i} className="text-sm">
                    <span className="text-white/80">[{String(r.severity || "").toUpperCase()}]</span> {r.item}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-white/60">No high risks found.</div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-sm text-white/60">Click Analyze to run compliance checks.</div>
      )}
    </div>
  );
}

export default AnalysisPanel;


