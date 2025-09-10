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

# Embeddings
# Preferred: set EMBED_MODEL_ID and DocPilot will auto-derive EMBED_DIM.
# Examples:
#   $env:EMBED_MODEL_ID = "BAAI/bge-large-en"   # -> EMBED_DIM=1024
#   $env:EMBED_MODEL_ID = "BAAI/bge-base-en"    # -> EMBED_DIM=768
# You can still override:
#   $env:EMBED_DIM = "1024"
#   $env:EMBED_MODEL = "BAAI/bge-large-en"

# Auth and options
$env:REQUIRE_LOGIN = "true"
# $env:TIDB_CA_CERT_PATH = "C:\\path\\to\\ca.pem"   # if TLS

uvicorn app.main:app --reload --port 8000
```

On startup the backend will ensure/migrate tables and indexes:
- `documents`, `chunks` with TiDB `VECTOR(EMBED_DIM)` and HNSW index
- `analytics_log`, `eval_*`, `audit_logs`, `users`, `sessions`, `share_links`
  - PII & GDPR: If `GDPR_MODE=true`, text is masked before storage; raw content is logged to `audit_logs.raw_content` (org-scoped, admin/auditor access). Enable `LOG_SCRUB=true` to scrub PII from server logs.

2) Frontend (Next.js)

### CORS
- Configure allowed origins via `CORS_ALLOW_ORIGINS` (comma-separated). Example:
  - Windows PowerShell:
    - `$env:CORS_ALLOW_ORIGINS = "http://localhost:3000,https://yourdomain.com"`
  - Bash:
    - `export CORS_ALLOW_ORIGINS="http://localhost:3000,https://yourdomain.com"`
  - .env:
    - `CORS_ALLOW_ORIGINS=https://app.example.com,https://staging.example.com`
- Credentials are enabled; allowed methods: GET, POST, PUT, DELETE, OPTIONS; minimal headers: Authorization, Content-Type, X-Org-Id.
- Test: `/health/cors` simply returns `{ ok: true }` and can be called from your frontend to verify CORS.

### Auth behavior (dev vs prod)
- Development (default): frontend stores a JWT in localStorage (`docpilot_token`) and sends `Authorization: Bearer <token>`. Cookies are not required.
- Production (`NODE_ENV=production` or `BACKEND_ENV=prod`): backend sets/reads an httpOnly auth cookie. Frontend will not send `Authorization` and will include credentials on fetch.
- Config:
  - `AUTH_COOKIE_NAME` (default `docpilot_auth`)
  - `BACKEND_ENV` (e.g., `prod` to enable cookie mode)
  - `COOKIE_SAMESITE` (default `Lax`, one of `lax|strict|none`)

Test plan (3 steps):
1) Login: POST `/api/login` with valid credentials
   - Dev: response JSON includes `token`; store in localStorage
   - Prod: response sets `Set-Cookie: <AUTH_COOKIE_NAME>=...; HttpOnly; Secure; SameSite=<mode>`
2) Authenticated API call
   - Dev: requests include `Authorization: Bearer <token>`
   - Prod: `fetch(..., { credentials: 'include' })` and backend reads cookie
3) Verify access to a protected route (e.g., `/answer`) succeeds in both modes

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
 - Hybrid retrieval: FULLTEXT + VECTOR with fusion

### Useful API routes
- `POST /ingest/text` – ingest a document (chunks + embeddings)
- `POST /query` – vector/hybrid retrieve
### Retrieval policy
- If the request includes `keyword`, DocPilot uses hybrid retrieval. Otherwise it uses pure vector KNN.
- Hybrid retrieval performs both FULLTEXT (BM25 via `MATCH AGAINST`) and VECTOR search and fuses the top candidates using Reciprocal Rank Fusion (RRF).
- Config:
  - `HYBRID_FUSION` (default `true`): enable fusion mode (otherwise simple hybrid filter).
  - `HYBRID_RRF_K` (default `60`): RRF smoothing parameter.
  - `HYBRID_FT_CANDIDATES` (default `100`), `HYBRID_VEC_CANDIDATES` (default `100`): candidate pool sizes.

### Reranker (optional CrossEncoder)
- DocPilot can rerank retrieved passages with a cross-encoder (e.g., MiniLM, BAAI bge-reranker).
- Config:
  - `RERANK_ENABLED` (default `true`): set to `false` to skip model load and use neutral scores (vector order preserved).
  - `RERANK_MODEL` (alias `RERANK_MODEL_ID`): e.g., `cross-encoder/ms-marco-MiniLM-L-6-v2`.
- Startup log includes reranker state: `Reranker: ON (model=...)` or `Reranker: OFF (model=...)`.
- Memory/latency: small models ~100–200MB; large rerankers (e.g., bge-reranker-large) can exceed 1–2GB and add 30–150ms. Toggle off or choose a smaller model for constrained environments.

Example impact (sample, 100 queries on demo set):
- Vector@10 only: avg nDCG=0.62, keyword recall@K=0.58
- Hybrid+RRF@10: avg nDCG=0.69 (+11%), keyword recall@K=0.66 (+14%)
Latency impact is modest (+10–20 ms) due to parallelizable queries; tune candidate sizes if needed.
- `POST /answer` – retrieve + LLM answer
- `POST /export/pdf` – generate a PDF report
- `POST /api/login` – obtain a session token
- `GET /analytics` and `GET /api/analytics` – HTAP dashboard data
- `GET /analytics/summary` and `/analytics/timeseries` – SLO and time series

### Troubleshooting
- Startup message about EMBED_DIM mismatch (e.g., DB VECTOR(768) vs configured 1024):
  - Fix by running the suggested migration:
    - `ALTER TABLE chunks MODIFY COLUMN embedding VECTOR(<desired_dim>) NOT NULL;`
  - Or set `EMBED_MODEL_ID`/`EMBED_DIM` to match the DB and restart.
- `analytics_log` missing/old: restart backend to auto-create; or drop it manually and restart.

