## Backend Setup (FastAPI + TiDB)

### 1) Create and activate a virtual environment (Windows PowerShell)

```powershell
python -m venv venv
./venv/Scripts/Activate.ps1
```

### 2) Install dependencies

```powershell
pip install -r backend/requirements.txt
```

### 3) Configure environment (TiDB + Embeddings + Auth)

Set the following env vars (example):

```powershell
$env:TIDB_HOST = "127.0.0.1"
$env:TIDB_PORT = "4000"
$env:TIDB_USER = "root"
$env:TIDB_PASSWORD = ""
$env:TIDB_DATABASE = "docpilot"
# Optional TLS
# $env:TIDB_CA_CERT_PATH = "C:\\path\\to\\ca.pem"

# Embeddings (match your chunks.embedding VECTOR)
# If VECTOR(1024):
$env:EMBED_DIM = "1024"
$env:EMBED_MODEL = "BAAI/bge-large-en"
# If VECTOR(768):
# $env:EMBED_DIM = "768"
# $env:EMBED_MODEL = "BAAI/bge-base-en"

# Auth
$env:REQUIRE_LOGIN = "true"
```

### 4) Run the API server

```powershell
uvicorn backend.app.main:app --reload --port 8000 --log-level debug
```

### 5) Example requests

Replace localhost and payloads as needed.

```bash
# Health
curl -s http://localhost:8000/health | jq
curl -s http://localhost:8000/health/db | jq

# Ingest text
curl -s -X POST http://localhost:8000/ingest/text \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Sample Doc",
    "text": "This is a sample document body.",
    "meta": {"category": "demo"},
    "chunk_size": 800,
    "chunk_overlap": 80
  }' | jq

# Query
curl -s -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "sample question",
    "top_k": 5,
    "filter_category": "demo"
  }' | jq

# Answer (uses same fields as QueryReq plus optional template)
curl -s -X POST http://localhost:8000/answer \
  -H "Content-Type: application/json" \
  -d '{
    "query": "summarize the sample",
    "top_k": 5,
    "filter_category": "demo",
    "template": "contract_response"
  }' | jq

# Streamed answer (plain text)
curl -s -X POST http://localhost:8000/answer/stream \
  -H "Content-Type: application/json" \
  -d '{"query":"summarize the sample"}'

# Export PDF
curl -s -X POST http://localhost:8000/export/pdf \
  -H "Content-Type: application/json" \
  -d '{"query":"summarize the sample"}' -o report.pdf

# Demo seed (single) and batch
curl -s -X POST http://localhost:8000/demo/seed | jq
curl -s -X POST http://localhost:8000/demo/seed/batch | jq

# Analytics
curl -s http://localhost:8000/analytics/summary | jq
curl -s http://localhost:8000/analytics/timeseries | jq
curl -s http://localhost:8000/analytics/insights | jq

# Slack slash command (local test)
curl -s -X POST http://localhost:8000/slack/command \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "text=what is the liability cap?" | jq

# S3 presign + ingest
curl -s -X POST http://localhost:8000/upload/presign \
  -H "Content-Type: application/json" \
  -d '{"filename":"doc.pdf","content_type":"application/pdf"}' | jq
curl -s -X POST http://localhost:8000/ingest/s3 \
  -H "Content-Type: application/json" \
  -d '{"key":"uploads/your-key-from-presign","title":"My Doc"}' | jq
```

### OTEL Tracing
- Set `OTEL_EXPORTER_OTLP_ENDPOINT` (e.g., `http://localhost:4318/v1/traces`) and install deps (`pip install -r backend/requirements.txt`).
- Spans: `embed.query`, `db.search.*`, `llm.answer`.

### Slack
- Set `SLACK_SIGNING_SECRET` (optional verification).
- Register slash command to POST to `/slack/command`.

### S3
- Set `S3_BUCKET` and `AWS_REGION` for presigned uploads and S3 ingest.


