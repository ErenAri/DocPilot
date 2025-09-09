## DocPilot (TiDB Vector + HTAP)

DocPilot is a RAG application showcasing TiDB's native Vector Search and HTAP analytics.

### Quickstart

1) Backend (FastAPI)

```powershell
cd backend
python -m venv venv
./venv/Scripts/Activate.ps1
pip install -r requirements.txt

# Required env (adjust to your TiDB instance)
$env:TIDB_HOST = "127.0.0.1"
$env:TIDB_PORT = "4000"
$env:TIDB_USER = "root"
$env:TIDB_PASSWORD = ""
$env:TIDB_DATABASE = "docpilot"

# Embeddings (choose one to match your DB schema)
# If your chunks.embedding is VECTOR(1024):
$env:EMBED_DIM = "1024"
$env:EMBED_MODEL = "BAAI/bge-large-en"
# Or for VECTOR(768):
# $env:EMBED_DIM = "768"
# $env:EMBED_MODEL = "BAAI/bge-base-en"

# Auth and options
$env:REQUIRE_LOGIN = "true"
# $env:TIDB_CA_CERT_PATH = "C:\\path\\to\\ca.pem"   # if TLS

uvicorn app.main:app --reload --port 8000
```

On startup the backend will ensure/migrate tables and indexes:
- `documents`, `chunks` with TiDB `VECTOR(EMBED_DIM)` and HNSW index
- `analytics_log`, `eval_*`, `audit_logs`, `users`, `sessions`, `share_links`

2) Frontend (Next.js)

```bash
cd frontend
npm install
set NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev
```

Open http://localhost:3000. Use the Login link; demo users are created on backend startup (e.g. `admin/admin123`). The token is stored in `localStorage` under `docpilot_token` and is sent as `Authorization: Bearer <token>`.

### What this demo highlights
- TiDB native vector search with `VECTOR` and `VEC_COSINE_DISTANCE`
- HNSW approximate index on embeddings
- HTAP analytics: real-time inserts + analytical queries on the same TiDB cluster

### Useful API routes
- `POST /ingest/text` – ingest a document (chunks + embeddings)
- `POST /query` – vector/hybrid retrieve
- `POST /answer` – retrieve + LLM answer
- `POST /export/pdf` – generate a PDF report
- `POST /api/login` – obtain a session token
- `GET /analytics` and `GET /api/analytics` – HTAP dashboard data
- `GET /analytics/summary` and `/analytics/timeseries` – SLO and time series

### Troubleshooting
- Startup message "Expected 1024, got 768": set `EMBED_DIM` to match your `chunks.embedding` VECTOR size, or alter the column to the target size and restart.
- `analytics_log` missing/old: restart backend to auto-create; or drop it manually and restart.

