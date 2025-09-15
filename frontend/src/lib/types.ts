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

// Documents list
export interface DocumentMeta {
  id: string;
  title: string;
  created_at: string; // ISO timestamp
  meta?: Record<string, unknown> | null;
}

export interface DocumentsListResponse {
  items: DocumentMeta[];
  total: number;
}

// Document details
export interface DocumentChunk {
  id: string;
  ord: number;
  text: string;
  page?: number | null;
}

export interface DocumentDetailResponse {
  chunks: DocumentChunk[];
}


