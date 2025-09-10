### Contributing to DocPilot

Thanks for contributing! This guide covers branch naming, commit style, and a minimal dev environment setup to get you productive quickly.

## Branch naming
- Use short, kebab-case names prefixed by a category:
  - feature/, fix/, chore/, docs/, refactor/, perf/, test/
- Examples:
  - feature/ingest-pipeline
  - fix/vector-dim-mismatch
  - docs/update-readme-quickstart

## Commit style (Conventional Commits)
- Format: `type(scope): short description`
- Common types: feat, fix, docs, chore, refactor, perf, test, build, ci
- Examples:
  - feat(api): add /answer/stream endpoint
  - fix(db): ensure HNSW index creation retries
  - docs(contributing): add branch rules and env examples

Keep body wrapped at ~72 chars. Reference issues like `Fixes #123` when applicable.

## Dev environment

DocPilot loads backend environment via python-dotenv when you run the API. Place a `.env` file at the repo root. For the frontend, use `frontend/.env.local`.

Minimal examples:

Backend `.env` (repo root):
```env
# TiDB connection
TIDB_HOST=127.0.0.1
TIDB_PORT=4000
TIDB_USER=root
TIDB_PASSWORD=
TIDB_DATABASE=docpilot

# Embeddings (match your DB VECTOR column size)
# Backend reads EMBED_MODEL. EMBED_MODEL_ID is an alias for docs consistency.
EMBED_DIM=1024
EMBED_MODEL=BAAI/bge-large-en
# Optional alias (not required by code):
# EMBED_MODEL_ID=BAAI/bge-large-en

# Optional toggles (not all wired end-to-end yet)
GDPR_MODE=false
DEMO_MODE=true
```

Frontend `frontend/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### Makefile tasks
After installing a `make` utility, you can use these helpers (defined in the project `Makefile`):
- `make dev-up` — create venv, install deps, and start API + UI in the background
- `make dev-down` — stop background dev processes
- `make api-tests` — smoke test API health endpoints
- `make ui-dev` — run only the Next.js dev server

See `README.md` and `README_backend.md` for more details.


