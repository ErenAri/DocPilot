from pydantic import BaseModel
from typing import Optional, List, Any

class IngestText(BaseModel):
    title: str
    text: str
    meta: Optional[Any] = None
    chunk_size: int = 800
    chunk_overlap: int = 80

class IngestFileResp(BaseModel):
    doc_id: str
    chunk_count: int

class QueryReq(BaseModel):
    query: str
    top_k: int = 10
    filter_category: Optional[str] = None
    keyword: Optional[str] = None

class Passage(BaseModel):
    id: str
    doc_id: str
    ord: int
    text: str
    dist: float
    rerank_score: Optional[float] = None

class QueryResp(BaseModel):
    passages: List[Passage]

class AnswerResp(BaseModel):
    answer: str
    evidence: List[Passage]
    low_evidence: Optional[bool] = None
    confidence: Optional[float] = None
    eval_id: Optional[str] = None