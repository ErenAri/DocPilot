## DocPilot

DocPilot is a full-stack document assistant:
- Backend: FastAPI
- Frontend: Next.js (App Router, Tailwind)
- Features: ingest PDFs/text, list & preview, compliance analysis, Q&A, export to PDF

### Prerequisites
- Python 3.11+
- Node.js 20+
- GitHub CLI (optional, for CI/dev flows)

### Backend (FastAPI)

```powershell
cd backend
python -m venv venv
./venv/Scripts/Activate.ps1
pip install -r requirements.txt

# Run API
env \ $env:UVICORN_PORT=8000
uvicorn app.main:app --reload --port 8000
```

Health: GET http://localhost:8000/health → `{ ok: true }`

### Frontend (Next.js)

```powershell
cd frontend
npm install

# Create .env.local
'@"
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_ORG_ID=demo
NEXT_PUBLIC_ROLE=viewer
"@' | Out-File -Encoding utf8 .env.local

npm run dev
# open http://localhost:3000/documents
```

Notes
- Required headers are added automatically: `X-Org-Id`, `X-Role`
- For print-to-PDF export, use the "Export PDF" button in the Q&A panel

### Useful endpoints
- GET `/documents?limit&offset`
- GET `/documents/{doc_id}`
- POST `/ingest/file` (multipart)
- POST `/analyze/doc` { doc_id }
- POST `/answer` { query, keyword? }

### E2E tests (Playwright)

```powershell
cd frontend
npm run pw:install
npm run dev # in another terminal
npm run test:e2e
```

### Dev tips
- Health check is validated on page load; a red banner indicates issues (CORS/headers)
- Infinite-scroll list supports category/tag/date filters and bulk analysis with CSV export
- Actions are strictly typed and return `Result<T,E>` from `lib/actions.ts`
