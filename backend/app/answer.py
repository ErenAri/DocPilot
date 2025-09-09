import os
from typing import List, Dict
from openai import OpenAI

SYSTEM_PROMPT = """You are an expert contract analyst. Write concise, professional outputs.
Rules:
- Use only the provided Evidence passages; if insufficient, say 'Insufficient evidence.'
- Attach [Evidence #i] tags where each claim is supported.
- Output sections: Executive Summary, Risk Checklist, Response Draft.
- Risk checklist items: liability cap, termination, jurisdiction, SLA/penalties, IP/data protection."""

def get_client():
    base = os.getenv("OPENAI_BASE_URL")
    if base:
        return OpenAI(api_key=os.getenv("OPENAI_API_KEY"), base_url=base)
    return OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def format_evidence(passages: List[Dict]) -> str:
    lines = []
    for i, p in enumerate(passages, 1):
        lines.append(f"[Evidence #{i}] (doc={p['doc_id']} ord={p['ord']} dist={p['dist']:.4f}) {p['text']}")
    return "\n".join(lines)

def assess_evidence_sufficiency(passages: List[Dict]) -> bool:
    """
    Assess if evidence is sufficient based on:
    - Top 3 passages combined length < 250 chars
    - Average distance > 0.35
    Returns True if evidence is insufficient (low quality)
    """
    if not passages:
        return True
    
    # Check top 3 passages combined length
    top_3 = passages[:3]
    combined_length = sum(len(p.get('text', '')) for p in top_3)
    if combined_length < 250:
        return True
    
    # Check average distance of all passages
    distances = [p.get('dist', 1.0) for p in passages if 'dist' in p]
    if distances:
        avg_distance = sum(distances) / len(distances)
        if avg_distance > 0.35:
            return True
    
    return False

def estimate_confidence(passages: List[Dict]) -> float:
    """Simple heuristic: combine coverage (chars) and proximity (1-avg_dist)."""
    if not passages:
        return 0.0
    total_chars = sum(len(p.get('text', '')) for p in passages[:5])
    coverage = max(0.0, min(1.0, total_chars / 1500.0))
    dists = [p.get('dist', 1.0) for p in passages]
    avg_dist = sum(dists) / len(dists) if dists else 1.0
    proximity = max(0.0, min(1.0, 1.0 - avg_dist))
    return round(0.6 * coverage + 0.4 * proximity, 3)

def answer_with_evidence(query: str, passages: List[Dict], model: str) -> tuple[str, bool, float]:
    """
    Generate answer with evidence and return (answer, is_low_evidence)
    """
    # Assess evidence sufficiency
    is_low_evidence = assess_evidence_sufficiency(passages)
    confidence = estimate_confidence(passages)
    
    ev = format_evidence(passages)
    
    # Modify system prompt if evidence is insufficient
    system_prompt = SYSTEM_PROMPT
    if is_low_evidence:
        system_prompt = "Evidence may be insufficient; produce a cautious draft and explicitly mark 'Insufficient evidence' where needed.\n\n" + SYSTEM_PROMPT
    
    user = f"Query: {query}\n\nEvidence Passages:\n{ev}\n\nProduce:\n1) Executive Summary (3 bullets)\n2) Risk Checklist (table: Item | Severity | Evidence #)\n3) Response Draft (numbered), each point with [Evidence #]."
    
    client = get_client()
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role":"system","content":system_prompt},
            {"role":"user","content":user}
        ],
        temperature=0.2,
        max_tokens=900
    )
    
    answer = (resp.choices[0].message.content or "").strip()
    return answer, is_low_evidence, confidence
