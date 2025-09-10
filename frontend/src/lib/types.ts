export interface EvidencePassage {
  id: string;
  doc_id: string;
  document_id?: string | null;
  ord: number;
  page?: number | null;
  text: string;
  snippet?: string | null;
  dist?: number;
}

export interface AnswerResponse {
  answer: string;
  evidence: EvidencePassage[];
  low_evidence?: boolean;
  confidence?: number;
  eval_id?: string;
}


