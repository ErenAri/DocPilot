"use client";
import { Badge } from "@/components/ui/badge";
import type { EvidencePassage } from "@/lib/types";

export function EvidenceBadgeList({ evidence, onClick }: { evidence: EvidencePassage[]; onClick?: (ev: EvidencePassage, index: number) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {evidence.map((ev, idx) => (
        <Badge key={ev.id} className="cursor-pointer" onClick={() => onClick?.(ev, idx)}>
          {`Evidence #${idx + 1} (doc=${ev.document_id || ev.doc_id} ord=${ev.ord}${ev.page != null ? ` p=${ev.page}` : ""})`}
        </Badge>
      ))}
    </div>
  );
}


