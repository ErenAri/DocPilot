"use client";
import { Badge } from "@/components/ui/badge";

type Evidence = {
  id: string;
  doc_id: string;
  ord: number;
  text: string;
  dist?: number;
};

export function EvidenceBadgeList({ evidence, onClick }: { evidence: Evidence[]; onClick?: (ev: Evidence, index: number) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {evidence.map((ev, idx) => (
        <Badge key={ev.id} className="cursor-pointer" onClick={() => onClick?.(ev, idx)}>
          {`Evidence #${idx + 1} (doc=${ev.doc_id} ord=${ev.ord})`}
        </Badge>
      ))}
    </div>
  );
}


