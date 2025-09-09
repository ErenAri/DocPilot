import os, io, tempfile, logging
from typing import List, Tuple, Dict, Any
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib import colors
from reportlab.lib.units import inch


def parse_answer_sections(answer: str) -> Dict[str, Any]:
    """Parse the LLM answer into sections.

    Returns keys: summary_bullets (List[str]), risks (List[List[str]]), response_lines (List[str]).
    - summary_bullets: take first 3 bullet-like lines (starting with '-', '*', or '•')
    - risks: attempt to parse a markdown-like table from the answer; if none, empty list
    - response_lines: lines starting with a number like '1.'
    """
    lines = [l.rstrip() for l in answer.splitlines()]

    # Executive summary: first 3 bullet lines
    summary_bullets: List[str] = []
    for l in lines:
        trimmed = l.strip()
        if trimmed.startswith(('-', '*', '•')) and len(summary_bullets) < 3:
            summary_bullets.append(trimmed.lstrip('-*• ').strip())
        if len(summary_bullets) >= 3:
            break

    # Risk checklist: parse markdown table between any header/sep rows
    risks: List[List[str]] = []
    in_table = False
    for l in lines:
        if '|' in l:
            parts = [c.strip() for c in l.strip().strip('|').split('|')]
            # detect separator row like |---|---|
            if all(set(p) <= set('-: ') and len(p) > 0 for p in parts):
                in_table = True
                continue
            if in_table:
                risks.append(parts)
        else:
            if in_table:
                break

    # Response draft: numbered list lines
    response_lines: List[str] = []
    for l in lines:
        stripped = l.strip()
        if len(stripped) >= 3 and stripped[0].isdigit() and stripped[1] in {'.', ')'}:
            # '1. something' or '1) something'
            response_lines.append(stripped)

    return {
        "summary_bullets": summary_bullets,
        "risks": risks,
        "response_lines": response_lines,
    }


def build_pdf(answer: str, evidence: List[Dict[str, Any]]) -> bytes:
    """Render a PDF with reportlab and return its bytes."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=LETTER, title="DocPilot – Evidence-Based Report")
    styles = getSampleStyleSheet()

    story: List[Any] = []

    # Title page header
    story.append(Paragraph("DocPilot – Evidence-Based Report", styles['Title']))
    story.append(Spacer(1, 0.25 * inch))

    sections = parse_answer_sections(answer)

    # Section 1: Executive Summary
    story.append(Paragraph("Section 1: Executive Summary", styles['Heading2']))
    bullets = sections.get('summary_bullets', [])
    if bullets:
        for b in bullets:
            story.append(Paragraph(f"• {b}", styles['Normal']))
    else:
        story.append(Paragraph("No bullet summary detected.", styles['Italic']))
    story.append(Spacer(1, 0.2 * inch))

    # Section 2: Risk Checklist (table)
    story.append(Paragraph("Section 2: Risk Checklist", styles['Heading2']))
    risks: List[List[str]] = sections.get('risks', [])
    if risks:
        table_data = risks
        table = Table(table_data, repeatRows=1, hAlign='LEFT')
        table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.lightgrey),
            ('GRID', (0,0), (-1,-1), 0.5, colors.grey),
            ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ]))
        story.append(table)
    else:
        story.append(Paragraph("No risk table detected.", styles['Italic']))
    story.append(Spacer(1, 0.2 * inch))

    # Section 3: Response Draft
    story.append(Paragraph("Section 3: Response Draft", styles['Heading2']))
    resp_lines: List[str] = sections.get('response_lines', [])
    if resp_lines:
        for line in resp_lines:
            story.append(Paragraph(line, styles['Normal']))
    else:
        story.append(Paragraph("No numbered response draft detected.", styles['Italic']))
    story.append(Spacer(1, 0.2 * inch))

    # Section 4: Evidence Map
    story.append(Paragraph("Section 4: Evidence Map", styles['Heading2']))
    table_rows: List[List[str]] = [["#", "doc_id", "ord", "snippet"]]
    for i, ev in enumerate(evidence, start=1):
        doc_id = str(ev.get('doc_id', ''))
        ord_val = str(ev.get('ord', ''))
        text = str(ev.get('text', ''))
        snippet = (text[:160] + '…') if len(text) > 160 else text
        table_rows.append([str(i), doc_id, ord_val, snippet])
    table = Table(table_rows, repeatRows=1, hAlign='LEFT', colWidths=[0.4*inch, 2.5*inch, 0.6*inch, 3.5*inch])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.lightgrey),
        ('GRID', (0,0), (-1,-1), 0.5, colors.grey),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
    ]))
    story.append(table)

    # Appendix if parsing failed
    if not sections.get('summary_bullets') and not sections.get('response_lines'):
        story.append(Spacer(1, 0.3 * inch))
        story.append(Paragraph("Appendix: Raw Answer", styles['Heading2']))
        story.append(Paragraph(answer.replace('\n', '<br/>'), styles['Normal']))

    doc.build(story)
    return buf.getvalue()


