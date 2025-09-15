"use client";
import type { AnswerResult } from "../../../lib/actions";

export interface QAPanelProps {
  askError: string;
  askQ: string;
  onAskQChange: (v: string) => void;
  asking: boolean;
  onAsk: () => void;
  onExportPdf: () => void;
  answer: AnswerResult | null;
}

export function QAPanel({ askError, askQ, onAskQChange, asking, onAsk, onExportPdf, answer }: QAPanelProps) {
  return (
    <div className="space-y-3">
      {askError && (
        <div className="text-sm rounded-md border border-red-400/30 bg-red-500/10 text-red-200 px-3 py-2">{askError}</div>
      )}
      <div className="flex items-center gap-2">
        <input
          placeholder="Enter a question..."
          value={askQ}
          onChange={(e) => onAskQChange(e.target.value)}
          className="h-10 w-full rounded border border-white/15 bg-white/10 px-2"
        />
        <button onClick={onAsk} disabled={asking || !askQ.trim()} className="h-10 px-3 rounded bg-white/10 hover:bg-white/15 disabled:opacity-60">
          {asking ? "Thinking…" : "Ask"}
        </button>
        <button onClick={onExportPdf} disabled={!answer} className="h-10 px-3 rounded border border-white/20 bg-transparent hover:bg-white/5 disabled:opacity-60">
          Export PDF
        </button>
      </div>
      {answer && (
        <div className="space-y-3">
          <details className="rounded border border-white/10 bg-white/5 p-2" open>
            <summary className="cursor-pointer text-sm font-semibold">Executive Summary</summary>
            <div className="mt-2 text-sm whitespace-pre-wrap">{answer.summary || ""}</div>
          </details>
          <details className="rounded border border-white/10 bg-white/5 p-2">
            <summary className="cursor-pointer text-sm font-semibold">Risk Checklist</summary>
            <div className="mt-2 text-sm whitespace-pre-wrap">{Array.isArray(answer.checklist) ? answer.checklist.join("\n") : String(answer.checklist || "")}</div>
          </details>
          <details className="rounded border border-white/10 bg-white/5 p-2">
            <summary className="cursor-pointer text-sm font-semibold">Response Draft</summary>
            <div className="mt-2 text-sm whitespace-pre-wrap">{answer.draft || ""}</div>
          </details>
          {Array.isArray(answer.evidence) && answer.evidence.length > 0 && (
            <details className="rounded border border-white/10 bg-white/5 p-2">
              <summary className="cursor-pointer text-sm font-semibold">Evidence</summary>
              <div className="mt-2 overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-white/70">
                      <th className="px-2 py-1">Source</th>
                      <th className="px-2 py-1">Snippet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {answer.evidence.map((e, i) => (
                      <tr key={i} className="border-t border-white/10 align-top">
                        <td className="px-2 py-1 whitespace-nowrap text-white/80">{e.doc_id ? `${e.doc_id}${e.ord != null ? `#${e.ord}` : ""}` : e.id}</td>
                        <td className="px-2 py-1 text-white/90">{e.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export default QAPanel;


