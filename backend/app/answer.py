import os
from typing import List, Dict
from openai import OpenAI

SIMPLE_DEFAULT = os.getenv("SIMPLE_ANSWER", "false").lower() in ("1", "true", "yes")

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

    # If simple answer mode, produce a concise paragraph-only answer
    simple_mode = SIMPLE_DEFAULT

    # Offline LLM mode
    if os.getenv("OFFLINE_LLM", "false").lower() in ("1", "true", "yes"):
        if simple_mode:
            # Build one concise paragraph from top evidence
            bits: List[str] = []
            for p in passages[:3]:
                t = (p.get("text") or "").strip().replace("\n", " ")
                if len(t) > 200:
                    t = t[:200] + "…"
                bits.append(t)
            if not bits:
                content = "Insufficient evidence."
            else:
                content = f"Answer: { ' '.join(bits) }"
            return content.strip(), is_low_evidence, confidence
        else:
            # Legacy structured output
            bullets: List[str] = []
            for p in passages[:3]:
                t = (p.get("text") or "").strip().replace("\n", " ")
                if len(t) > 140:
                    t = t[:140] + "…"
                bullets.append(f"• {t}")
            if not bullets:
                bullets = ["• Insufficient evidence."]
            checklist = (
                "Item | Severity | Evidence #\n"
                "---|---|---\n"
                "Liability cap | High | 1\n"
                "Termination terms | Medium | 2\n"
                "Jurisdiction | Low | 3\n"
            )
            draft_lines: List[str] = []
            for i, _ in enumerate(passages[:5], 1):
                draft_lines.append(f"{i}. Refer to [Evidence #{i}] for relevant details.")
            if not draft_lines:
                draft_lines = ["1. Insufficient evidence."]
            content = "\n".join([
                "Executive Summary:",
                *bullets,
                "",
                "Risk Checklist:",
                checklist,
                "",
                "Response Draft:",
                *draft_lines,
            ])
            return content.strip(), is_low_evidence, confidence

    # Online LLM mode
    client = get_client()
    if simple_mode:
        system_prompt = (
            "You are a concise, accurate assistant. Answer the question using only the provided evidence. "
            "If evidence is insufficient, say 'Insufficient evidence.' Output a single short paragraph."
        )
        if is_low_evidence:
            system_prompt = "Evidence may be insufficient. Be cautious. " + system_prompt
        user = f"Question: {query}\n\nEvidence:\n{ev}\n\nWrite one concise paragraph answer only."
    else:
        # Strict JSON format for structured output
        system_prompt = (
            "You are an expert analyst. Respond in strict JSON with keys: "
            "summary (string, 2-4 sentences), bullets (array of 3-5 concise strings), citations (array of integers referencing Evidence #)."
        )
        if is_low_evidence:
            system_prompt = "Evidence may be insufficient; be cautious. " + system_prompt
        user = f"Question: {query}\n\nEvidence (numbered):\n{ev}\n\nReturn JSON only."
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role":"system","content":system_prompt},
                    {"role":"user","content":user}
                ],
                temperature=0.2,
                max_tokens=900,
                response_format={"type": "json_object"}
            )
            import json as _json
            raw = (resp.choices[0].message.content or "").strip()
            data = _json.loads(raw)
            summary = str(data.get("summary") or "").strip()
            bullets = [str(b).strip() for b in (data.get("bullets") or []) if str(b).strip()]
            citations = [int(x) for x in (data.get("citations") or []) if isinstance(x, (int, float))]
            if len(bullets) < 3 and summary:
                # ensure at least 3 bullets by splitting summary
                parts = [p.strip() for p in summary.split(".") if p.strip()]
                bullets = (bullets + parts)[:3]
            # Render markdown
            lines: List[str] = []
            if summary:
                lines.append(summary)
            if bullets:
                lines.append("")
                lines.append("Key Points:")
                for b in bullets:
                    lines.append(f"- {b}")
            if passages:
                lines.append("")
                lines.append("Cited Evidence:")
                # Render top 3 evidence with numbering
                for i, p in enumerate(passages[:5], 1):
                    tag = "(cited)" if i in citations else ""
                    snippet = (p.get("text") or "").strip().replace("\n", " ")
                    if len(snippet) > 260:
                        snippet = snippet[:260] + "…"
                    lines.append(f"[{i}] {snippet} {tag}")
            content = "\n".join(lines).strip()
            if not content:
                content = "Insufficient evidence."
            return content, is_low_evidence, confidence
        except Exception:
            # Fallback to concise paragraph
            system_prompt = (
                "You are a concise, accurate assistant. Answer using only the evidence. "
                "If insufficient, say 'Insufficient evidence.' One short paragraph."
            )
            user = f"Question: {query}\n\nEvidence:\n{ev}"
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role":"system","content":system_prompt},
                    {"role":"user","content":user}
                ],
                temperature=0.2,
                max_tokens=500
            )
            answer = (resp.choices[0].message.content or "").strip()
            return answer, is_low_evidence, confidence
