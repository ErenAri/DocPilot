# DocPilot Demo (≤ 4 minutes)

1) Startup
- Show backend run with debug logs and OTEL endpoint exported (optional).
- Show frontend `/` and `/ask` pages.

2) Seed Demo
- Click Seed Demo on `/ask` (or curl `/demo/seed/batch`).
- Mention TiDB as the single source for vectors + metadata.

3) Ingest
- Drag a PDF or use "Upload via S3" to demonstrate presign + ingest.
- Show success toast with `doc_id` and `chunk_count`.

4) Search & Answer
- In `/ask`, enter: "What is the liability cap and uptime SLA?"
- Click Search: show passages, hover preview.
- Click Stream Answer: watch content stream in.
- Highlight Evidence badges and confidence bar; low-evidence banner if applicable.

5) Export
- Click Export PDF and open the generated report with sections & evidence map.

6) Compliance Co‑Pilot
- In Analyze Doc, paste a `doc_id` and run.
- Show detected clauses and risks.

7) Analytics
- Show Insights card (hit rate, intents, confidence trend) and Analytics card.
- Mention eval gold runner and metrics (recall proxy, nDCG proxy, faithfulness proxy).

8) Slack
- Run a slash command request to `/slack/command` and show compact answer with evidence.

9) Close
- Summarize: Hybrid retrieval (FULLTEXT + vector) over TiDB, agentic pipeline, observability, uploads, and governance.

