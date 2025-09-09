import os, io, uuid, json, logging, time
from contextvars import ContextVar
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pypdf import PdfReader
from typing import List, Dict, Any, cast, Optional, Sequence, Mapping
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from .schemas import IngestText, IngestFileResp, QueryReq, QueryResp, Passage, AnswerResp
from .chunk import make_chunks
from .embeddings import embed_texts, to_vector_literal, score_pairs, redact_pii
from .db import get_conn, upsert_document, upsert_chunks, knn_search, hybrid_search, setup_vector_optimization, ensure_eval_table, insert_eval_log, update_eval_rating, ensure_eval_gold_tables, insert_eval_gold, insert_eval_result, ensure_audit_table, insert_audit, ensure_tenant_columns, fetch_document_text, ensure_share_links_table, insert_share_link, get_share_link, fetch_chunks_by_ids, ensure_calibration_table, get_calibration, set_calibration, ensure_chunks_secondary_indexes, compact_dedup_chunks, ensure_tiflash_replica, ensure_core_vector_schema, ensure_analytics_table, insert_analytics_event, ensure_users_tables, upsert_demo_users, get_user_by_credentials, create_session, get_user_by_token
from .answer import answer_with_evidence, get_client
from .export import build_pdf
from .integrations import create_jira_ticket, publish_notion_page, IntegrationError, create_linear_issue, publish_confluence_page
import hmac, hashlib, base64, asyncio
import boto3
def compute_share_hash(data: dict) -> str:
    secret = os.getenv("SHARE_HASH_SECRET", "docpilot")
    payload = json.dumps({
        "q": data.get("query"),
        "ids": data.get("evidence_ids"),
        "org": data.get("org_id"),
        "fn": data.get("filename"),
    }, sort_keys=True)
    return hashlib.sha256((secret + "|" + payload).encode("utf-8")).hexdigest()


# Configure structured logging
logger = logging.getLogger("docpilot")
request_id_var: ContextVar[str] = ContextVar("request_id", default="")
org_id_var: ContextVar[str] = ContextVar("org_id", default="")
user_id_var: ContextVar[str] = ContextVar("user_id", default="")
role_var: ContextVar[str] = ContextVar("role", default="viewer")

# In-memory metrics
metrics = {
    "ingest_total": 0,
    "query_total": 0,
    "answer_total": 0,
    "errors_total": 0
}

app = FastAPI(title="DocPilot API")
# OpenTelemetry setup (optional via env OTEL_EXPORTER_OTLP_ENDPOINT)
otel_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
if otel_endpoint:
    resource = Resource.create({"service.name": "docpilot-backend"})
    provider = TracerProvider(resource=resource)
    span_exporter = OTLPSpanExporter(endpoint=otel_endpoint)
    provider.add_span_processor(BatchSpanProcessor(span_exporter))
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app)
tracer = trace.get_tracer("docpilot")
# Simple route-based policy map (used by MCP and ops)
POLICY_REQUIRED_ROLES = {
    "mcp.tools": ["viewer", "analyst", "editor", "admin"],
    "mcp.invoke": ["viewer", "analyst", "editor", "admin"],
    "ops.calibration.get": ["viewer", "analyst", "editor", "admin"],
}

# Optional path-based policy guards (checked in middleware)
POLICY_PATH_ROLES: Dict[str, list[str]] = {
    "/ingest/text": ["editor", "admin"],
    "/ingest/file": ["editor", "admin"],
    "/ingest/s3": ["editor", "admin"],
    "/upload/presign": ["editor", "admin"],
    "/answer": ["viewer", "analyst", "editor", "admin"],
    "/answer/stream": ["viewer", "analyst", "editor", "admin"],
    "/query": ["viewer", "analyst", "editor", "admin"],
    "/export/pdf": ["viewer", "analyst", "editor", "admin"],
    "/ops/": ["viewer", "analyst", "editor", "admin"],
    "/analytics/": ["viewer", "analyst", "editor", "admin"],
    "/actions/": ["editor", "admin"],
    "/mcp/tools": ["viewer", "analyst", "editor", "admin"],
    "/mcp/invoke": ["viewer", "analyst", "editor", "admin"],
    "/debug/": ["editor", "admin"],
}

# --- Offline-first spool settings ---
SPOOL_DIR = os.getenv("OFFLINE_SPOOL_DIR", "spool")
SPOOL_DRAIN_SECS = int(os.getenv("OFFLINE_DRAIN_SECS", "10"))

def _ensure_spool_dir():
    try:
        os.makedirs(SPOOL_DIR, exist_ok=True)
    except Exception:
        pass

def _spool_write(record: Dict[str, Any]):
    try:
        _ensure_spool_dir()
        fname = f"{uuid.uuid4()}.json"
        path = os.path.join(SPOOL_DIR, fname)
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False))
    except Exception as e:
        logger.warning(f"Spool write failed: {e}")

def _spool_list():
    try:
        _ensure_spool_dir()
        for fn in os.listdir(SPOOL_DIR):
            if fn.endswith(".json"):
                yield os.path.join(SPOOL_DIR, fn)
    except Exception:
        return

def _spool_read(path: str) -> Dict[str, Any] | None:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return cast(Dict[str, Any], json.loads(f.read() or "{}"))
    except Exception:
        return None

def _spool_delete(path: str):
    try:
        os.remove(path)
    except Exception:
        pass

async def _spool_drain_loop():
    while True:
        try:
            drained = 0
            for path in list(_spool_list() or []):
                rec = _spool_read(path)
                if not rec:
                    _spool_delete(path)
                    continue
                rtype = rec.get("type")
                try:
                    if rtype == "ingest":
                        conn = get_conn()
                        upsert_document(conn, rec["doc_id"], rec["title"], rec.get("meta"), rec.get("org_id"))
                        upsert_chunks(conn, rec["rows"], rec.get("org_id"))
                        conn.close()
                        _spool_delete(path)
                        drained += 1
                    elif rtype == "eval_log":
                        conn = get_conn()
                        insert_eval_log(conn, rec["row"])
                        conn.close()
                        _spool_delete(path)
                        drained += 1
                    elif rtype == "audit_log":
                        conn = get_conn()
                        insert_audit(conn, rec["row"])
                        conn.close()
                        _spool_delete(path)
                        drained += 1
                    else:
                        # Unknown type -> drop
                        _spool_delete(path)
                except Exception:
                    # Keep file for next attempt
                    continue
            if drained:
                logger.info(f"Spool drained: {drained}")
        except Exception as e:
            logger.warning(f"Spool drain loop error: {e}")
        await asyncio.sleep(SPOOL_DRAIN_SECS)

# --- Simple in-memory rate limiter (sliding window) for MCP ---
from collections import deque
_RL_BUCKETS: Dict[str, deque] = {}
MCP_MAX_PER_MIN = int(os.getenv("MCP_RL_PER_MIN", "60"))

def _rate_limit_allow(key: str, now: float | None = None) -> bool:
    if now is None:
        now = time.time()
    window = 60.0
    q = _RL_BUCKETS.get(key)
    if q is None:
        q = deque()
        _RL_BUCKETS[key] = q
    # Drop old
    while q and (now - q[0]) > window:
        q.popleft()
    if len(q) >= MCP_MAX_PER_MIN:
        return False
    q.append(now)
    return True

# --- Background compaction loop (optional) ---
COMPACT_SECS = int(os.getenv("COMPACT_INTERVAL_SECS", "0"))

async def _compact_loop():
    if COMPACT_SECS <= 0:
        return
    while True:
        try:
            conn = get_conn()
            deleted = compact_dedup_chunks(conn)
            conn.close()
            if deleted:
                logger.info(f"Compact loop deleted={deleted}")
        except Exception as e:
            logger.warning(f"Compact loop error: {e}")
        await asyncio.sleep(COMPACT_SECS)


# CORS: allow all origins, methods, and headers
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request ID and structured logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    request_id = str(uuid.uuid4())[:8]
    request_id_var.set(request_id)
    # Basic API key + org scoping
    api_key_required = os.getenv("APP_API_KEY")
    client_key = request.headers.get("X-Api-Key")
    if api_key_required and client_key != api_key_required:
        return JSONResponse(status_code=401, content={"error": "unauthorized", "request_id": request_id})
    # Session token auth
    token = request.headers.get("Authorization")
    if token and token.lower().startswith("bearer "):
        token = token.split(" ", 1)[1]
    user_row = None
    if token:
        try:
            conn = get_conn()
            user_row = get_user_by_token(conn, token)
            conn.close()
        except Exception:
            user_row = None

    if isinstance(user_row, dict):
        try:
            org_id_header = str((user_row.get("org_id"))) if user_row.get("org_id") is not None else ""
        except Exception:
            org_id_header = ""
        try:
            user_id_header = str((user_row.get("user_id"))) if user_row.get("user_id") is not None else ""
        except Exception:
            user_id_header = ""
    else:
        org_id_header = request.headers.get("X-Org-Id") or ""
        user_id_header = request.headers.get("X-User-Id") or ""
    role_header = (request.headers.get("X-Role") or "viewer").lower()
    org_id_var.set(org_id_header)
    user_id_var.set(user_id_header)
    role_var.set(role_header)
    if os.getenv("REQUIRE_ORG_ID", "false").lower() in ("1", "true", "yes") and not org_id_header:
        return JSONResponse(status_code=400, content={"error": "missing X-Org-Id", "request_id": request_id})
    
    start_time = time.time()
    extra = {
        "request_id": request_id,
        "method": request.method,
        "path": request.url.path,
        "client": request.client.host if request.client else None,
    }
    
    logger.info("Request started", extra=extra)
    
    try:
        # Enforce login for protected paths if required
        try:
            require_login = os.getenv("REQUIRE_LOGIN", "true").lower() in ("1","true","yes")
            path = request.url.path
            public_paths = {"/api/login", "/health", "/health/db", "/metrics"}
            if require_login and (path not in public_paths) and not isinstance(user_row, dict):
                return JSONResponse(status_code=401, content={"error": "auth_required", "request_id": request_id})
        except Exception:
            pass
        # Policy check (path-based allow list)
        try:
            path = request.url.path
            for prefix, roles in POLICY_PATH_ROLES.items():
                if path.startswith(prefix):
                    current_role = role_var.get("viewer") or "viewer"
                    if current_role not in roles and current_role != "admin":
                        return JSONResponse(status_code=403, content={"error": "forbidden", "request_id": request_id})
                    break
        except Exception:
            pass
        response = await call_next(request)
        duration = time.time() - start_time
        extra_success = {**extra, "status_code": response.status_code, "duration": f"{duration:.3f}s"}
        logger.info("Request completed", extra=extra_success)
        
        # Add request_id to response headers
        response.headers["X-Request-ID"] = request_id
        return response
    except Exception as e:
        metrics["errors_total"] += 1
        duration = time.time() - start_time
        extra_error = {**extra, "error": str(e), "duration": f"{duration:.3f}s"}
        logger.exception("Request failed", extra=extra_error)
        
        # Return structured error response
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "request_id": request_id},
            headers={"X-Request-ID": request_id}
        )

def log_with_request_id(message: str, level: str = "info", **kwargs):
    """Helper to log with request_id context"""
    extra = {"request_id": request_id_var.get("")}
    extra.update(kwargs)
    getattr(logger, level)(message, extra=extra)

def is_allowed(allowed_roles: list[str]) -> bool:
    role = role_var.get("viewer") or "viewer"
    return role in allowed_roles or role == "admin"

def audit_event(route: str, *, query: str | None = None, evidence_ids: list[str] | None = None):
    try:
        conn = get_conn()
        insert_audit(conn, {
            "id": str(uuid.uuid4()),
            "user_id": user_id_var.get(""),
            "route": route,
            "query": query,
            "evidence_ids": evidence_ids or [],
            "request_id": request_id_var.get(""),
            "org_id": org_id_var.get(""),
        })
        conn.close()
    except Exception as e:
        logger.warning(f"Audit insert failed: {e}")

def standardized_error_response(error: Exception) -> JSONResponse:
    """Return standardized error response with request_id"""
    request_id = request_id_var.get("")
    metrics["errors_total"] += 1
    log_with_request_id(f"Endpoint error: {str(error)}", "error")
    return JSONResponse(
        status_code=500,
        content={"error": str(error), "request_id": request_id},
        headers={"X-Request-ID": request_id}
    )

@app.on_event("startup")
async def startup_validation():
    """Validate configuration and log system info on startup"""
    logger.info("=== DocPilot Backend Starting ===")
    
    # Check required environment variables
    required_envs = ["TIDB_HOST", "TIDB_USER", "TIDB_PASSWORD", "TIDB_DATABASE", "OPENAI_API_KEY"]
    missing_envs = [env for env in required_envs if not os.getenv(env)]
    if missing_envs:
        logger.error(f"Missing required environment variables: {missing_envs}")
        raise RuntimeError(f"Missing required environment variables: {missing_envs}")
    
    # Test database connectivity
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.fetchone()
        cur.close()
        conn.close()
        logger.info("Database connectivity check: OK")
    except Exception as e:
        logger.error(f"Database connectivity check failed: {e}")
        raise
    
    # Log model configuration
    embed_model = os.getenv("EMBED_MODEL", "BAAI/bge-large-en")
    primary_model = os.getenv("PRIMARY_MODEL", "gpt-4o")
    logger.info(f"Embedding model: {embed_model}")
    logger.info(f"Primary LLM model: {primary_model}")
    
    # Test embedding model and log dimensions
    try:
        test_embed = embed_texts(["test"])
        embed_dim = test_embed.shape[1] if test_embed.ndim > 1 else test_embed.shape[0]
        logger.info(f"Embedding dimensions: {embed_dim}")
        if embed_dim != 1024:
            logger.warning(f"Expected 1024 dimensions, got {embed_dim}")
    except Exception as e:
        logger.error(f"Embedding model test failed: {e}")
        raise
    
    # Attempt vector schema and optimization setup (VECTOR, HNSW, FULLTEXT)
    try:
        conn = get_conn()
        ensure_core_vector_schema(conn)
        ensure_analytics_table(conn)
        ensure_users_tables(conn)
        upsert_demo_users(conn)
        setup_vector_optimization(conn)
        ensure_chunks_secondary_indexes(conn)
        ensure_tiflash_replica(conn)
        ensure_eval_table(conn)
        ensure_eval_gold_tables(conn)
        ensure_audit_table(conn)
        ensure_tenant_columns(conn)
        ensure_share_links_table(conn)
        ensure_calibration_table(conn)
        conn.close()
    except Exception as e:
        logger.warning(f"Vector schema/optimization setup encountered issues: {e}")
        # Don't raise - this is optional optimization
    
    # Start spool drain loop if enabled
    try:
        if os.getenv("OFFLINE_SPOOL_ENABLED", "true").lower() in ("1", "true", "yes"):
            asyncio.create_task(_spool_drain_loop())
            logger.info("Offline spool drain loop started")
        if COMPACT_SECS > 0:
            asyncio.create_task(_compact_loop())
            logger.info("Background compact loop started")
    except Exception as e:
        logger.warning(f"Failed to start spool drain: {e}")
    logger.info("=== DocPilot Backend Ready ===")

class AnswerReq(QueryReq):
    template: str | None = "contract_response"

def rerank_passages(query: str, passages: List[Dict]) -> List[Dict]:
    """Apply reranking to passages"""
    if not passages:
        return passages
    
    texts = [p["text"] for p in passages]
    scores = score_pairs(query, texts)
    
    # Add rerank scores and sort by them
    for i, passage in enumerate(passages):
        passage["rerank_score"] = float(scores[i]) if i < len(scores) else 0.0
    
    # Sort by rerank score (desc), tie-break with distance (asc)
    passages.sort(key=lambda x: (-x.get("rerank_score", 0), x.get("dist", 0)))
    return passages

@app.post("/answer", response_model=AnswerResp)
def answer(payload: AnswerReq, request: Request):
    try:
        if not is_allowed(["editor", "analyst", "viewer"]):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        log_with_request_id("Processing answer request", "info", query=payload.query[:50])
        metrics["answer_total"] += 1
        
        t0 = time.time(); step = {}
        with tracer.start_as_current_span("embed.query"):
            vec = embed_texts([payload.query])[0]
        vector_literal = to_vector_literal(vec)
        step['embed_ms'] = int((time.time() - t0) * 1000)
        conn = get_conn(); t1 = time.time()
        
        # Use hybrid search if keyword provided
        if hasattr(payload, 'keyword') and payload.keyword:
            with tracer.start_as_current_span("db.search.hybrid"):
                rows = cast(List[Dict[str, Any]], hybrid_search(conn, vector_literal, payload.keyword, payload.top_k or 10, payload.filter_category, request.headers.get("X-Org-Id")))
            log_with_request_id("Used hybrid search", "debug", keyword=payload.keyword)
        else:
            with tracer.start_as_current_span("db.search.knn"):
                rows = cast(List[Dict[str, Any]], knn_search(conn, vector_literal, payload.top_k or 10, payload.filter_category, request.headers.get("X-Org-Id")))
            log_with_request_id("Used vector search", "debug")
        
        conn.close(); step['search_ms'] = int((time.time() - t1) * 1000)
        
        # Apply reranking to top results
        rows = rerank_passages(payload.query, rows)
        
        # Take final top_k after reranking
        final_top_k = payload.top_k or 10
        if hasattr(payload, 'keyword') and payload.keyword:
            final_top_k = min(10, len(rows))  # Limit to 10 for reranking
        rows = rows[:final_top_k]
        
        passages = [{"id":r["id"],"doc_id":r["doc_id"],"ord":r["ord"],"text":r["text"],"dist":float(r["dist"])} for r in rows]
        model = os.getenv("PRIMARY_MODEL","gpt-4o")
        t2 = time.time()
        with tracer.start_as_current_span("llm.answer"):
            content, is_low_evidence, confidence = answer_with_evidence(payload.query, passages, model)
        step['llm_ms'] = int((time.time() - t2) * 1000)
        latency_ms = int((time.time() - t0) * 1000)
        eval_id = str(uuid.uuid4())
        org_id = request.headers.get("X-Org-Id")
        try:
            conn2 = get_conn()
            insert_eval_log(conn2, {
                "id": eval_id,
                "route": "answer",
                "query": payload.query,
                "keyword": getattr(payload, 'keyword', None),
                "top_k": payload.top_k or 10,
                "filter_category": payload.filter_category,
                "latency_ms": latency_ms,
                "evidence_ids": [p["id"] for p in passages],
                "model": model,
                "confidence": confidence,
                "low_evidence": is_low_evidence,
                "rating": None,
                "step_ms": step,
                "org_id": org_id,
            })
            conn2.close()
        except Exception as e:
            logger.warning(f"Eval log insert failed: {e}")
            _spool_write({"type": "eval_log", "row": {
                "id": eval_id,
                "route": "answer",
                "query": payload.query,
                "keyword": getattr(payload, 'keyword', None),
                "top_k": payload.top_k or 10,
                "filter_category": payload.filter_category,
                "latency_ms": latency_ms,
                "evidence_ids": [p["id"] for p in passages],
                "model": model,
                "confidence": confidence,
                "low_evidence": is_low_evidence,
                "rating": None,
                "step_ms": step,
                "org_id": org_id,
            }})
        # Analytics log (HTAP demo)
        try:
            conn3 = get_conn()
            insert_analytics_event(conn3, {
                "id": str(uuid.uuid4()),
                "route": "answer",
                "query": payload.query,
                "latency_ms": latency_ms,
                "top_doc_id": passages[0]["doc_id"] if passages else None,
                "org_id": org_id,
                "user_id": user_id_var.get(""),
                "retrieved_doc_ids": [p["doc_id"] for p in passages],
            })
            conn3.close()
        except Exception:
            pass
        audit_event("answer", query=payload.query, evidence_ids=[p["id"] for p in passages])
        
        log_with_request_id("Answer generated successfully", "info", passage_count=len(passages), low_evidence=is_low_evidence, confidence=confidence)
        return {"answer": content, "evidence": passages, "low_evidence": is_low_evidence, "confidence": confidence, "eval_id": eval_id}
    except Exception as e:
        return standardized_error_response(e)

@app.post("/answer/stream")
def answer_stream(payload: AnswerReq, request: Request):
    try:
        # Retrieval same as /answer
        vec = embed_texts([payload.query])[0]
        vector_literal = to_vector_literal(vec)
        conn = get_conn()
        if hasattr(payload, 'keyword') and payload.keyword:
            rows = cast(List[Dict[str, Any]], hybrid_search(conn, vector_literal, payload.keyword, payload.top_k or 10, payload.filter_category, request.headers.get("X-Org-Id")))
        else:
            rows = cast(List[Dict[str, Any]], knn_search(conn, vector_literal, payload.top_k or 10, payload.filter_category, request.headers.get("X-Org-Id")))
        conn.close()
        rows = rerank_passages(payload.query, rows)
        rows = rows[: (payload.top_k or 10)]
        passages = [{"id": r["id"], "doc_id": r["doc_id"], "ord": r["ord"], "text": r["text"], "dist": float(r["dist"]) } for r in rows]
        # Build prompt inline (mirror answer.py)
        from .answer import SYSTEM_PROMPT, format_evidence, assess_evidence_sufficiency
        is_low = assess_evidence_sufficiency(passages)
        system_prompt = ("Evidence may be insufficient; produce a cautious draft and explicitly mark 'Insufficient evidence' where needed.\n\n" + SYSTEM_PROMPT) if is_low else SYSTEM_PROMPT
        ev = format_evidence(passages)
        user = f"Query: {payload.query}\n\nEvidence Passages:\n{ev}\n\nProduce:\n1) Executive Summary (3 bullets)\n2) Risk Checklist (table: Item | Severity | Evidence #)\n3) Response Draft (numbered), each point with [Evidence #]."
        client = get_client()
        model = os.getenv("PRIMARY_MODEL","gpt-4o")
        def gen():
            try:
                stream = client.chat.completions.create(
                    model=model,
                    messages=[{"role":"system","content":system_prompt},{"role":"user","content":user}],
                    temperature=0.2,
                    max_tokens=900,
                    stream=True,
                )
                for chunk in stream:
                    delta = chunk.choices[0].delta.content or ""
                    if delta:
                        yield delta
            except Exception as e:
                yield f"\n[stream_error: {str(e)}]"
            
        audit_event("answer_stream", query=payload.query, evidence_ids=[p["id"] for p in passages])
        return StreamingResponse(gen(), media_type="text/plain; charset=utf-8")
    except Exception as e:
        return standardized_error_response(e)

@app.post("/ingest/text", response_model=IngestFileResp)
def ingest_text(payload: IngestText, request: Request):
    try:
        if not is_allowed(["editor", "admin"]):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        log_with_request_id("Processing text ingestion", "info", title=payload.title)
        metrics["ingest_total"] += 1
        
        doc_id = str(uuid.uuid4())
        conn = get_conn()
        org_id = request.headers.get("X-Org-Id") if request else None
        upsert_document(conn, doc_id, payload.title, payload.meta, org_id, user_id_var.get(""))
        # DLP redaction before chunking
        redacted_text = redact_pii(payload.text)
        chunks = make_chunks(redacted_text, payload.chunk_size, payload.chunk_overlap)
        
        log_with_request_id("Generated chunks", "debug", chunk_count=len(chunks))
        embeds = embed_texts(chunks)
        
        rows = []
        for i, (ch, ev) in enumerate(zip(chunks, embeds)):
            chunk_id = str(uuid.uuid4())
            rows.append((chunk_id, doc_id, i, ch, to_vector_literal(ev)))
        
        try:
            upsert_chunks(conn, rows, org_id)
            conn.close()
        except Exception as e:
            try:
                conn.close()
            except Exception:
                pass
            _spool_write({
                "type": "ingest",
                "doc_id": doc_id,
                "title": payload.title,
                "meta": payload.meta,
                "org_id": org_id,
                "rows": rows,
            })
        
        log_with_request_id("Text ingestion completed", "info", doc_id=doc_id, chunk_count=len(rows))
        audit_event("ingest_text", query=payload.title)
        return IngestFileResp(doc_id=doc_id, chunk_count=len(rows))
    except Exception as e:
        return standardized_error_response(e)

@app.post("/ingest/file", response_model=IngestFileResp)
async def ingest_file(request: Request, file: UploadFile = File(...), title: str = Form(None), meta: str = Form(None)):
    try:
        if not is_allowed(["editor", "admin"]):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        log_with_request_id("Processing file ingestion", "info", filename=file.filename)
        content = await file.read()
        reader = PdfReader(io.BytesIO(content))
        text = "\n".join([p.extract_text() or "" for p in reader.pages])
        text = redact_pii(text)
        
        meta_obj = None
        if meta:
            try:
                meta_obj = json.loads(meta)
            except Exception:
                meta_obj = {"raw": meta}
        
        payload = IngestText(title=title or file.filename or "Untitled", text=text, meta=meta_obj)
        resp = ingest_text(payload, request)
        try:
            audit_event("ingest_file", query=payload.title)
        except Exception:
            pass
        return resp
    except Exception as e:
        return standardized_error_response(e)

@app.post("/query", response_model=QueryResp)
def query(payload: QueryReq, request: Request):
    try:
        if not is_allowed(["analyst", "viewer", "editor"]):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        log_with_request_id("Processing query request", "info", query=payload.query[:50])
        metrics["query_total"] += 1
        
        t0 = time.time(); step = {}
        vec = embed_texts([payload.query])[0]
        vector_literal = to_vector_literal(vec)
        step['embed_ms'] = int((time.time() - t0) * 1000)
        conn = get_conn(); t1 = time.time()
        
        # Use hybrid search if keyword provided
        if payload.keyword:
            with tracer.start_as_current_span("db.search.hybrid"):
                rows = cast(List[Dict[str, Any]], hybrid_search(conn, vector_literal, payload.keyword, payload.top_k, payload.filter_category, request.headers.get("X-Org-Id")))
            log_with_request_id("Used hybrid search", "debug", keyword=payload.keyword)
        else:
            # Prefer TiFlash for large scans (optimizer hint)
            with tracer.start_as_current_span("db.search.knn"):
                rows = cast(List[Dict[str, Any]], knn_search(conn, vector_literal, payload.top_k, payload.filter_category, request.headers.get("X-Org-Id")))
            log_with_request_id("Used vector search", "debug")
        
        conn.close(); step['search_ms'] = int((time.time() - t1) * 1000)
        
        # Apply reranking to top results
        rows = rerank_passages(payload.query, rows)
        
        # Take final top_k after reranking
        final_top_k = payload.top_k
        if payload.keyword:
            final_top_k = min(10, len(rows))  # Limit to 10 for reranking
        rows = rows[:final_top_k]
        
        passages = [Passage(
            id=str(r["id"]), 
            doc_id=str(r["doc_id"]), 
            ord=int(r["ord"]), 
            text=str(r["text"]), 
            dist=float(r["dist"]),
            rerank_score=r.get("rerank_score")
        ) for r in rows]
        
        log_with_request_id("Query completed successfully", "info", result_count=len(passages))
        latency_ms = int((time.time() - t0) * 1000)
        try:
            conn2 = get_conn()
            insert_eval_log(conn2, {
                "id": str(uuid.uuid4()),
                "route": "query",
                "query": payload.query,
                "keyword": payload.keyword,
                "top_k": payload.top_k,
                "filter_category": payload.filter_category,
                "latency_ms": latency_ms,
                "evidence_ids": [p.id for p in passages],
                "model": None,
                "confidence": None,
                "low_evidence": None,
                "rating": None,
                "step_ms": step,
                "org_id": request.headers.get("X-Org-Id"),
            })
            conn2.close()
        except Exception as e:
            logger.warning(f"Eval log insert failed: {e}")
            _spool_write({"type": "eval_log", "row": {
                "id": str(uuid.uuid4()),
                "route": "query",
                "query": payload.query,
                "keyword": payload.keyword,
                "top_k": payload.top_k,
                "filter_category": payload.filter_category,
                "latency_ms": latency_ms,
                "evidence_ids": [p.id for p in passages],
                "model": None,
                "confidence": None,
                "low_evidence": None,
                "rating": None,
                "step_ms": step,
                "org_id": request.headers.get("X-Org-Id"),
            }})
        # Analytics log (HTAP demo)
        try:
            conn3 = get_conn()
            insert_analytics_event(conn3, {
                "id": str(uuid.uuid4()),
                "route": "query",
                "query": payload.query,
                "latency_ms": latency_ms,
                "top_doc_id": passages[0].doc_id if passages else None,
                "org_id": request.headers.get("X-Org-Id"),
                "user_id": user_id_var.get(""),
                "retrieved_doc_ids": [p.doc_id for p in passages],
            })
            conn3.close()
        except Exception:
            pass
        audit_event("query", query=payload.query, evidence_ids=[p.id for p in passages])
        return QueryResp(passages=passages)
    except Exception as e:
        return standardized_error_response(e)

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/metrics")
def get_metrics():
    """Get simple in-memory metrics"""
    try:
        return {
            "status": "ok",
            "metrics": metrics,
            "request_id": request_id_var.get("")
        }
    except Exception as e:
        return standardized_error_response(e)

@app.get("/ops/spool")
def ops_spool():
    try:
        if not is_allowed(["viewer", "analyst", "editor", "admin"]):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        files = []
        try:
            for p in list(_spool_list() or []):
                files.append({"file": os.path.basename(p)})
        except Exception:
            pass
        return {"status": "ok", "count": len(files), "files": files}
    except Exception as e:
        return standardized_error_response(e)

@app.get("/ops/slo")
def ops_slo():
    try:
        if not is_allowed(["analyst", "viewer", "editor", "admin"]):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        conn = get_conn()
        cur = conn.cursor(dictionary=True)
        cur.execute(
            """
            SELECT 
              COUNT(*) AS total,
              AVG(latency_ms) AS avg_latency,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency,
              AVG(CASE WHEN low_evidence IS TRUE THEN 1 ELSE 0 END) AS low_evidence_rate
            FROM eval_logs
            WHERE ts >= NOW() - INTERVAL 24 HOUR
            """
        )
        slo = cur.fetchone() or {}
        cur.close(); conn.close()
        try:
            audit_event("ops_slo")
        except Exception:
            pass
        return {"status": "ok", "slo": slo}
    except Exception as e:
        return standardized_error_response(e)

@app.get("/ops/status")
def ops_status():
    try:
        if not is_allowed(["analyst", "viewer", "editor", "admin"]):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        status = {
            "otel_endpoint": bool(os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")),
            "s3_configured": bool(os.getenv("S3_BUCKET") and os.getenv("AWS_REGION")),
            "api_key_required": bool(os.getenv("APP_API_KEY")),
            "require_org_id": os.getenv("REQUIRE_ORG_ID", "false").lower() in ("1","true","yes"),
            "spool_enabled": os.getenv("OFFLINE_SPOOL_ENABLED", "true").lower() in ("1","true","yes"),
            "spool_dir": SPOOL_DIR,
        }
        try:
            audit_event("ops_status")
        except Exception:
            pass
        return {"status": "ok", "ops": status}
    except Exception as e:
        return standardized_error_response(e)

@app.post("/ops/self-heal")
def ops_self_heal():
    try:
        if not is_allowed(["editor", "admin"]):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        conn = get_conn()
        try:
            setup_vector_optimization(conn)
            ensure_eval_table(conn)
            ensure_eval_gold_tables(conn)
            ensure_audit_table(conn)
            ensure_tenant_columns(conn)
            ensure_chunks_secondary_indexes(conn)
            conn.close()
        except Exception as e:
            conn.close()
            raise e
        try:
            audit_event("ops_self_heal")
        except Exception:
            pass
        return {"status": "ok", "message": "Self-heal routines executed"}
    except Exception as e:
        return standardized_error_response(e)

@app.post("/ops/compact")
def ops_compact():
    try:
        if not is_allowed(["editor", "admin"]):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        conn = get_conn()
        deleted = compact_dedup_chunks(conn)
        conn.close()
        audit_event("ops_compact", query=f"deleted={deleted}")
        return {"status": "ok", "deleted": deleted}
    except Exception as e:
        return standardized_error_response(e)

# --- Nightly eval calibration (env gated) ---
_calibration_state: Dict[str, Any] = {"last_run": None, "status": "idle", "threshold": 0.6}

async def _run_calibration_task():
    try:
        _calibration_state["status"] = "running"
        # Here we'd compute new thresholds from recent eval_logs; keep simple
        new_thr = 0.6
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        _calibration_state["threshold"] = new_thr
        _calibration_state["last_run"] = ts
        try:
            conn = get_conn()
            set_calibration(conn, new_thr, ts)
            conn.close()
        except Exception:
            pass
        _calibration_state["status"] = "ok"
    except Exception as e:
        _calibration_state["status"] = f"error: {e}"

@app.post("/ops/calibration/run")
async def ops_calibration_run():
    try:
        if not is_allowed(["editor", "admin"]):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        asyncio.create_task(_run_calibration_task())
        return {"status": "started"}
    except Exception as e:
        return standardized_error_response(e)

@app.get("/ops/calibration")
def ops_calibration_get():
    try:
        if not is_allowed(POLICY_REQUIRED_ROLES.get("ops.calibration.get", ["admin"])):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        # Load from DB if present
        try:
            conn = get_conn()
            row_any = get_calibration(conn)
            conn.close()
            if row_any:
                row = cast(Dict[str, Any], row_any)
                thr_val = row.get("threshold")
                try:
                    if thr_val is not None:
                        _calibration_state["threshold"] = float(thr_val)
                except Exception:
                    pass
                lr_val = row.get("last_run")
                if lr_val is not None:
                    try:
                        _calibration_state["last_run"] = str(lr_val)
                    except Exception:
                        pass
        except Exception:
            pass
        return {"status": "ok", "calibration": _calibration_state}
    except Exception as e:
        return standardized_error_response(e)

@app.get("/analytics/summary")
def analytics_summary():
    try:
        if not is_allowed(["analyst", "viewer", "editor", "admin"]):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        conn = get_conn()
        cur = conn.cursor(dictionary=True)
        cur.execute(
            """
            SELECT 
              COUNT(*) AS total,
              SUM(route='query') AS query_count,
              SUM(route='answer') AS answer_count,
              SUM(route='export_pdf') AS export_count,
              AVG(latency_ms) AS avg_latency,
              MAX(latency_ms) AS max_latency,
              SUM(low_evidence IS TRUE) AS low_evidence_count
            FROM eval_logs
            """
        )
        summary = cur.fetchone() or {}
        cur.close()
        conn.close()
        try:
            audit_event("analytics_summary")
        except Exception:
            pass
        return {"status": "ok", "summary": summary}
    except Exception as e:
        return standardized_error_response(e)

@app.get("/analytics")
def analytics_dashboard():
    try:
        if not is_allowed(["analyst", "viewer", "editor", "admin"]):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        conn = get_conn()
        cur = conn.cursor(dictionary=True)
        # Top 5 most frequent queries (by normalized text)
        cur.execute(
            """
            SELECT LOWER(TRIM(query)) AS q, COUNT(*) AS cnt
            FROM analytics_log
            WHERE query IS NOT NULL AND query <> ''
            GROUP BY q
            ORDER BY cnt DESC
            LIMIT 5
            """
        )
        top_queries = cur.fetchall()
        # Average response time
        cur.execute("SELECT AVG(latency_ms) AS avg_latency_ms FROM analytics_log")
        avg_latency_row = cur.fetchone()
        avg_latency_ms = None
        try:
            if isinstance(avg_latency_row, dict):
                avg_latency_ms = avg_latency_row.get("avg_latency_ms")
            elif isinstance(avg_latency_row, (list, tuple)) and len(avg_latency_row) >= 1:
                avg_latency_ms = avg_latency_row[0]
        except Exception:
            avg_latency_ms = None
        # Most frequently retrieved documents
        cur.execute(
            """
            SELECT top_doc_id AS doc_id, COUNT(*) AS cnt
            FROM analytics_log
            WHERE top_doc_id IS NOT NULL
            GROUP BY top_doc_id
            ORDER BY cnt DESC
            LIMIT 5
            """
        )
        top_docs = cur.fetchall()
        cur.close(); conn.close()
        try:
            audit_event("analytics_dashboard")
        except Exception:
            pass
        return {
            "status": "ok",
            "top_queries": top_queries,
            "avg_latency_ms": avg_latency_ms,
            "top_docs": top_docs,
        }
    except Exception as e:
        return standardized_error_response(e)
@app.get("/api/analytics")
def analytics_dashboard_alias():
    return analytics_dashboard()

@app.get("/analytics/timeseries")
def analytics_timeseries():
    try:
        if not is_allowed(["analyst", "viewer", "editor", "admin"]):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        conn = get_conn()
        cur = conn.cursor(dictionary=True)
        cur.execute(
            """
            SELECT DATE_FORMAT(ts, '%Y-%m-%d %H:%i') AS bucket,
                   COUNT(*) AS total,
                   AVG(latency_ms) AS avg_latency
            FROM eval_logs
            WHERE ts >= NOW() - INTERVAL 24 HOUR
            GROUP BY bucket
            ORDER BY bucket ASC
            """
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()
        try:
            audit_event("analytics_timeseries")
        except Exception:
            pass
        return {"status": "ok", "rows": rows}
    except Exception as e:
        return standardized_error_response(e)

class GoldSeedBody(BaseModel):
    items: List[Dict[str, Any]]

def compute_recall_at_k(expected_doc_ids: Optional[List[Any]], retrieved_doc_ids: List[Any]) -> Optional[float]:
    try:
        if not expected_doc_ids:
            return None
        expected_set = set(str(x) for x in expected_doc_ids)
        retrieved_set = set(str(x) for x in retrieved_doc_ids)
        inter = len(expected_set & retrieved_set)
        denom = len(expected_set) or 1
        return round(inter / denom, 3)
    except Exception:
        return None

def compute_ndcg(expected_doc_ids: Optional[List[Any]], retrieved_doc_ids: List[Any]) -> Optional[float]:
    try:
        if not expected_doc_ids:
            return None
        expected_set = set(str(x) for x in expected_doc_ids)
        relevances = [1 if str(doc_id) in expected_set else 0 for doc_id in retrieved_doc_ids]
        import math
        def dcg(rels: List[int]) -> float:
            s = 0.0
            for i, r in enumerate(rels):
                if r > 0:
                    s += (2 ** r - 1) / math.log2(i + 2)
            return s
        dcg_val = dcg(relevances)
        ideal_len = min(len(expected_set), len(retrieved_doc_ids))
        ideal_rels = [1] * ideal_len
        idcg_val = dcg(ideal_rels)
        if idcg_val == 0:
            return 0.0
        return round(dcg_val / idcg_val, 3)
    except Exception:
        return None

def compute_faithfulness(content: str, passages: List[Dict[str, Any]], expected_doc_ids: Optional[List[Any]]) -> Optional[float]:
    try:
        content_lower = (content or "").lower()
        import re
        refs = re.findall(r"\[\s*evidence\s*#(\d+)\s*\]", content_lower)
        valid = 0
        for ref in refs:
            try:
                idx = int(ref)
                if 1 <= idx <= len(passages):
                    valid += 1
            except Exception:
                continue
        citation_ratio = (valid / len(refs)) if refs else None
        overlap_ratio = None
        if expected_doc_ids:
            used_doc_ids = [str(p.get("doc_id")) for p in passages]
            exp_set = set(str(x) for x in expected_doc_ids)
            overlap = len(set(used_doc_ids) & exp_set)
            overlap_ratio = overlap / max(1, len(exp_set))
        if citation_ratio is not None and overlap_ratio is not None:
            return round(0.5 * citation_ratio + 0.5 * overlap_ratio, 3)
        if citation_ratio is not None:
            return round(citation_ratio, 3)
        if overlap_ratio is not None:
            return round(overlap_ratio, 3)
        return None
    except Exception:
        return None

@app.post("/analytics/seed-gold")
def seed_gold(body: GoldSeedBody):
    try:
        if not is_allowed(["analyst", "editor", "admin"]):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        conn = get_conn()
        rows = []
        for it in body.items:
            rows.append({
                "id": str(uuid.uuid4()),
                "query": it.get("query"),
                "expected_contains": it.get("expected_contains"),
                "expected_keywords": it.get("expected_keywords"),
                "filter_category": it.get("filter_category"),
                "keyword": it.get("keyword"),
                "top_k": it.get("top_k"),
            })
        insert_eval_gold(conn, rows)
        conn.close()
        try:
            audit_event("seed_gold", query=f"count={len(rows)}")
        except Exception:
            pass
        return {"status": "ok", "count": len(rows)}
    except Exception as e:
        return standardized_error_response(e)

@app.post("/analytics/run-gold")
def run_gold():
    try:
        if not is_allowed(["analyst", "editor", "admin"]):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        conn = get_conn()
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT * FROM eval_gold")
        golds = cur.fetchall()
        cur.close()
        for g_row in golds:
            g = cast(Dict[str, Any], g_row)
            query_str = str(g.get("query") or "")
            try:
                top_k_val = g.get("top_k")
                top_k = int(top_k_val) if top_k_val is not None else 10
            except Exception:
                top_k = 10
            filter_cat_val = g.get("filter_category")
            filter_cat = str(filter_cat_val) if filter_cat_val is not None else None
            keyword_val = g.get("keyword")
            keyword = str(keyword_val) if keyword_val is not None else None
            payload = QueryReq(query=query_str, top_k=top_k, filter_category=filter_cat, keyword=keyword)
            # Reuse answer flow
            t0 = time.time(); step = {}
            vec = embed_texts([payload.query])[0]
            vector_literal = to_vector_literal(vec)
            step['embed_ms'] = int((time.time() - t0) * 1000)
            c = get_conn(); t1 = time.time()
            if keyword:
                rows = cast(List[Dict[str, Any]], hybrid_search(c, vector_literal, keyword, payload.top_k, payload.filter_category))
            else:
                rows = cast(List[Dict[str, Any]], knn_search(c, vector_literal, payload.top_k, payload.filter_category))
            c.close(); step['search_ms'] = int((time.time() - t1) * 1000)
            passages = [{"id":r["id"],"doc_id":r["doc_id"],"ord":r["ord"],"text":r["text"],"dist":float(r["dist"])} for r in rows]
            model = os.getenv("PRIMARY_MODEL","gpt-4o")
            t2 = time.time()
            content, _, _ = answer_with_evidence(payload.query, passages, model)
            step['llm_ms'] = int((time.time() - t2) * 1000)
            # Enhanced metrics
            exp_doc_ids = g.get("expected_doc_ids")
            try:
                if isinstance(exp_doc_ids, str):
                    exp_doc_ids = json.loads(exp_doc_ids)
            except Exception:
                exp_doc_ids = None
            used_ids = [p["doc_id"] for p in passages]
            keyword_recall = compute_recall_at_k(exp_doc_ids, used_ids)
            ndcg = compute_ndcg(exp_doc_ids, used_ids)
            faithfulness = compute_faithfulness(content, passages, exp_doc_ids)
            # Simple pass rule based on combined metrics
            score_parts = [x for x in [keyword_recall, ndcg, faithfulness] if isinstance(x, (int, float))]
            score = round(sum(score_parts) / len(score_parts), 3) if score_parts else 0.0
            passed = score >= 0.6
            insert_eval_result(conn, {
                "id": str(uuid.uuid4()),
                "gold_id": str(g.get("id")),
                "answer_len": len(content),
                "used_evidence_ids": [p["id"] for p in passages],
                "match_score": round(score, 3),
                "passed": passed,
                "model": model,
                "step_ms": step,
                "keyword_recall": round(keyword_recall, 3) if keyword_recall is not None else None,
                "ndcg": ndcg,
                "faithfulness": faithfulness,
            })
        conn.close()
        try:
            audit_event("run_gold", query=f"count={len(golds)}")
        except Exception:
            pass
        return {"status": "ok", "count": len(golds)}
    except Exception as e:
        return standardized_error_response(e)

@app.get("/analytics/gold/summary")
def gold_summary():
    try:
        if not is_allowed(["analyst", "viewer", "editor", "admin"]):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        conn = get_conn()
        cur = conn.cursor(dictionary=True)
        cur.execute(
            """
            SELECT COUNT(*) AS total,
                   SUM(passed IS TRUE) AS passed,
                   AVG(match_score) AS avg_score
            FROM eval_results
            """
        )
        row = cur.fetchone() or {}
        cur.close()
        conn.close()
        try:
            audit_event("gold_summary")
        except Exception:
            pass
        return {"status": "ok", "summary": row}
    except Exception as e:
        return standardized_error_response(e)

@app.get("/analytics/gold/latest")
def gold_latest():
    try:
        if not is_allowed(["analyst", "viewer", "editor", "admin"]):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        conn = get_conn()
        cur = conn.cursor(dictionary=True)
        cur.execute(
            """
            SELECT r.ts, r.match_score, r.passed, g.query
            FROM eval_results r
            JOIN eval_gold g ON g.id = r.gold_id
            ORDER BY r.ts DESC
            LIMIT 20
            """
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()
        try:
            audit_event("gold_latest")
        except Exception:
            pass
        return {"status": "ok", "rows": rows}
    except Exception as e:
        return standardized_error_response(e)

class FeedbackBody(BaseModel):
    eval_id: str
    rating: int | None

class LoginBody(BaseModel):
    username: str
    password: str

class LoginResp(BaseModel):
    token: str
    user_id: str
    username: str
    org_id: str | None = None

@app.post("/feedback")
def submit_feedback(body: FeedbackBody):
    try:
        conn = get_conn()
        update_eval_rating(conn, body.eval_id, body.rating)
        conn.close()
        return {"status": "ok"}
    except Exception as e:
        return standardized_error_response(e)

@app.post("/api/login", response_model=LoginResp)
def api_login(body: LoginBody):
    try:
        conn = get_conn()
        row = get_user_by_credentials(conn, body.username, body.password)
        if not row:
            conn.close()
            return JSONResponse(status_code=401, content={"error": "invalid_credentials"})
        user_id_value = None
        username_value = None
        org_id_value = None
        try:
            user_id_value = str(row["id"]) if isinstance(row, dict) else str(row[0])
        except Exception:
            user_id_value = None
        try:
            username_value = str(row["username"]) if isinstance(row, dict) else str(row[1])
        except Exception:
            username_value = body.username
        try:
            org_id_value = (row.get("org_id") if isinstance(row, dict) else None)
        except Exception:
            org_id_value = None
        token = create_session(conn, user_id_value or "")
        conn.close()
        return LoginResp(token=token, user_id=user_id_value or "", username=username_value or body.username, org_id=str(org_id_value) if org_id_value is not None else None)
    except Exception as e:
        return standardized_error_response(e)

# --- Slack slash command integration ---
class SlackSlashBody(BaseModel):
    token: Optional[str] = None
    team_id: Optional[str] = None
    team_domain: Optional[str] = None
    channel_id: Optional[str] = None
    channel_name: Optional[str] = None
    user_id: Optional[str] = None
    user_name: Optional[str] = None
    command: Optional[str] = None
    text: Optional[str] = None
    response_url: Optional[str] = None

def verify_slack_signature(request: Request, body_bytes: bytes) -> bool:
    signing_secret = os.getenv("SLACK_SIGNING_SECRET")
    if not signing_secret:
        return True
    ts = request.headers.get("X-Slack-Request-Timestamp", "")
    sig = request.headers.get("X-Slack-Signature", "")
    base = f"v0:{ts}:{body_bytes.decode('utf-8', errors='ignore')}"
    digest = hmac.new(signing_secret.encode(), base.encode(), hashlib.sha256).hexdigest()
    expected = f"v0={digest}"
    try:
        return hmac.compare_digest(expected, sig)
    except Exception:
        return False

@app.post("/slack/command")
async def slack_command(request: Request):
    try:
        body_bytes = await request.body()
        if not verify_slack_signature(request, body_bytes):
            return JSONResponse(status_code=401, content={"error": "invalid signature"})
        # Parse application/x-www-form-urlencoded safely
        from urllib.parse import parse_qs
        parsed = parse_qs(body_bytes.decode('utf-8', errors='ignore'))
        text = (parsed.get('text', [""])[0] or "").strip()
        if not text:
            return {"response_type": "ephemeral", "text": "Usage: /docpilot ask <your question>"}
        # Quick ack
        ack = {
            "response_type": "ephemeral",
            "text": f"Searching and drafting answer for: '{text[:120]}'..."
        }
        # Synchronous small run (simple path)
        vec = embed_texts([text])[0]
        vector_literal = to_vector_literal(vec)
        conn = get_conn()
        rows = cast(List[Dict[str, Any]], knn_search(conn, vector_literal, 5, None))
        conn.close()
        passages = [{"id":r["id"],"doc_id":r["doc_id"],"ord":r["ord"],"text":r["text"],"dist":float(r["dist"])} for r in rows]
        model = os.getenv("PRIMARY_MODEL","gpt-4o")
        content, is_low, conf = answer_with_evidence(text, passages, model)
        short = (content[:600] + "…") if len(content) > 600 else content
        evidence_lines = [f"• {p['doc_id']} (ord {p['ord']}, dist {p['dist']:.3f})" for p in passages[:3]]
        final = "\n".join([
            "*DocPilot Answer*",
            short,
            "",
            "*Top Evidence*",
            *evidence_lines,
            f"Confidence: {int(conf*100)}%" + (" (Low evidence)" if is_low else "")
        ])
        try:
            audit_event("slack_command", query=text, evidence_ids=[p['id'] for p in passages])
        except Exception:
            pass
        return {"response_type": "in_channel", "text": final}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

# --- Compliance Co-Pilot: clause/entity extraction & risk heuristics ---
class AnalyzeDocBody(BaseModel):
    doc_id: str
    org_id: Optional[str] = None

@app.post("/analyze/doc")
def analyze_doc(body: AnalyzeDocBody):
    try:
        conn = get_conn()
        text = fetch_document_text(conn, body.doc_id)
        conn.close()
        if not text:
            return JSONResponse(status_code=404, content={"error": "Document not found or empty"})
        # Simple heuristic extraction (can replace with LLM later)
        import re
        clauses = {
            "liability_cap": bool(re.search(r"liabilit(y|ies).*\bcap\b|limited\s+to\s+the\s+fees", text, re.IGNORECASE)),
            "uptime_sla": bool(re.search(r"\b99\.9%|uptime|SLA", text, re.IGNORECASE)),
            "termination": bool(re.search(r"\btermination|terminate\b|\b30\s+days\b", text, re.IGNORECASE)),
            "jurisdiction": bool(re.search(r"\bjurisdiction|governing\s+law\b|california|new\s+york", text, re.IGNORECASE)),
            "data_protection": bool(re.search(r"\bGDPR|data\s+processing|confidentialit(y|ies)", text, re.IGNORECASE)),
        }
        risks = []
        if not clauses["liability_cap"]:
            risks.append({"item": "Liability cap missing", "severity": "High"})
        if not clauses["uptime_sla"]:
            risks.append({"item": "Uptime SLA missing", "severity": "Medium"})
        if not clauses["termination"]:
            risks.append({"item": "Termination terms missing", "severity": "Medium"})
        if not clauses["jurisdiction"]:
            risks.append({"item": "Jurisdiction unspecified", "severity": "Low"})
        if not clauses["data_protection"]:
            risks.append({"item": "Data protection terms missing", "severity": "High"})
        return {"doc_id": body.doc_id, "clauses": clauses, "risks": risks}
    except Exception as e:
        return standardized_error_response(e)

# --- S3 pre-signed upload scaffolding ---
class PresignBody(BaseModel):
    filename: str
    content_type: Optional[str] = None

@app.post("/upload/presign")
def presign_upload(body: PresignBody):
    try:
        bucket = os.getenv("S3_BUCKET")
        region = os.getenv("AWS_REGION")
        if not bucket or not region:
            return JSONResponse(status_code=400, content={"error": "S3_BUCKET and AWS_REGION must be set"})
        s3 = boto3.client("s3", region_name=region)
        key = f"uploads/{uuid.uuid4()}-{body.filename}"
        params = {
            "Bucket": bucket,
            "Key": key,
            "ContentType": body.content_type or "application/octet-stream",
        }
        url = s3.generate_presigned_url(
            ClientMethod="put_object",
            Params=params,
            ExpiresIn=3600,
        )
        return {"url": url, "key": key, "bucket": bucket}
    except Exception as e:
        return standardized_error_response(e)

# --- Dashboard insights: intents, categories, hit-rate, confidence heatmap ---
def classify_intent(query: str) -> str:
    q = (query or "").lower()
    if any(k in q for k in ["liability", "cap", "limit of liability"]):
        return "liability"
    if any(k in q for k in ["sla", "uptime", "availability"]):
        return "sla"
    if any(k in q for k in ["terminate", "termination", "notice"]):
        return "termination"
    if any(k in q for k in ["jurisdiction", "governing law", "venue"]):
        return "jurisdiction"
    if any(k in q for k in ["gdpr", "privacy", "data", "security"]):
        return "data_protection"
    return "general"

@app.get("/analytics/insights")
def analytics_insights():
    try:
        if not is_allowed(["analyst", "viewer", "editor", "admin"]):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        conn = get_conn()
        cur = conn.cursor(dictionary=True)
        # Categories from documents
        cur.execute(
            """
            SELECT JSON_UNQUOTE(JSON_EXTRACT(meta,'$.category')) AS category, COUNT(*) AS count
            FROM documents
            GROUP BY category
            ORDER BY count DESC
            """
        )
        categories_rows = cur.fetchall()
        categories = [cast(Dict[str, Any], r) for r in categories_rows]
        # Intents from eval_logs (last 7d)
        cur.execute(
            """
            SELECT query FROM eval_logs
            WHERE route='answer' AND ts >= NOW() - INTERVAL 7 DAY AND query IS NOT NULL
            LIMIT 2000
            """
        )
        qrows = cur.fetchall()
        intents_map = {}
        for r in qrows:
            row = cast(Dict[str, Any], r)
            intent = classify_intent(str(row.get('query') or ''))
            intents_map[intent] = intents_map.get(intent, 0) + 1
        intents = [{"intent": k, "count": v} for k, v in sorted(intents_map.items(), key=lambda x: -x[1])]
        # Hit rate (confidence>=0.6 and not low_evidence)
        cur.execute(
            """
            SELECT AVG(CASE WHEN confidence >= 0.6 AND (low_evidence IS NULL OR low_evidence = 0) THEN 1 ELSE 0 END) AS hit_rate
            FROM eval_logs
            WHERE route='answer' AND ts >= NOW() - INTERVAL 7 DAY
            """
        )
        hit_rate_row = cur.fetchone() or {"hit_rate": None}
        # Confidence heatmap (hourly, last 24h)
        cur.execute(
            """
            SELECT DATE_FORMAT(ts, '%Y-%m-%d %H:00') AS bucket, AVG(confidence) AS avg_conf
            FROM eval_logs
            WHERE confidence IS NOT NULL AND ts >= NOW() - INTERVAL 24 HOUR
            GROUP BY bucket
            ORDER BY bucket ASC
            """
        )
        heatmap_rows = cur.fetchall()
        heatmap = [cast(Dict[str, Any], r) for r in heatmap_rows]
        cur.close(); conn.close()
        try:
            audit_event("analytics_insights")
        except Exception:
            pass
        return {"status": "ok", "categories": categories, "intents": intents, "hit_rate": cast(Dict[str, Any], hit_rate_row).get('hit_rate'), "confidence_heatmap": heatmap}
    except Exception as e:
        return standardized_error_response(e)

# --- Ingest from S3 key ---
class IngestS3Body(BaseModel):
    key: str
    bucket: Optional[str] = None
    title: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None

@app.post("/ingest/s3", response_model=IngestFileResp)
def ingest_s3(body: IngestS3Body, request: Request):
    try:
        if not is_allowed(["editor", "admin"]):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        bucket = body.bucket or os.getenv("S3_BUCKET")
        region = os.getenv("AWS_REGION")
        if not bucket or not region:
            return JSONResponse(status_code=400, content={"error": "S3_BUCKET and AWS_REGION must be set or provided"})
        s3 = boto3.client("s3", region_name=region)
        obj = s3.get_object(Bucket=bucket, Key=body.key)
        data = obj["Body"].read()
        reader = PdfReader(io.BytesIO(data))
        text = "\n".join([p.extract_text() or "" for p in reader.pages])
        text = redact_pii(text)
        payload = IngestText(title=body.title or body.key.split("/")[-1], text=text, meta=body.meta)
        resp = ingest_text(payload, request)
        try:
            audit_event("ingest_s3", query=body.key)
        except Exception:
            pass
        return resp
    except Exception as e:
        return standardized_error_response(e)

# --- Actions: create Jira ticket and Notion page
class CreateTicketBody(BaseModel):
    summary: str
    description: str

@app.post("/actions/jira")
def create_jira(body: CreateTicketBody):
    try:
        res = create_jira_ticket(body.summary, body.description)
        return {"status": "ok", "ticket": res}
    except IntegrationError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    except Exception as e:
        return standardized_error_response(e)

class PublishNotionBody(BaseModel):
    title: str
    content: str

@app.post("/actions/notion")
def publish_notion(body: PublishNotionBody):
    try:
        res = publish_notion_page(body.title, body.content)
        return {"status": "ok", "page": res}
    except IntegrationError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    except Exception as e:
        return standardized_error_response(e)

class CreateLinearBody(BaseModel):
    title: str
    description: str

@app.post("/actions/linear")
def create_linear(body: CreateLinearBody):
    try:
        res = create_linear_issue(body.title, body.description)
        return {"status": "ok", "issue": res}
    except IntegrationError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    except Exception as e:
        return standardized_error_response(e)

class PublishConfluenceBody(BaseModel):
    space_key: str
    title: str
    content_html: str

@app.post("/actions/confluence")
def publish_confluence(body: PublishConfluenceBody):
    try:
        page = publish_confluence_page(body.space_key, body.title, body.content_html)
        return {"status": "ok", "page": page}
    except IntegrationError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    except Exception as e:
        return standardized_error_response(e)

@app.get("/health/db")
def health_db():
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT 1")
        result = cur.fetchone()
        cur.close()
        conn.close()
        # Robustly handle tuple/list or dict row types without unsafe casts
        ok = False
        if isinstance(result, Sequence) and not isinstance(result, (str, bytes)):
            try:
                first = result[0]  # type: ignore[index]
                ok = (first == 1) or (first == 1.0) or (str(first) == "1")
            except Exception:
                ok = False
        elif isinstance(result, Mapping):
            try:
                first_value = next(iter(result.values()))
                ok = (first_value == 1) or (first_value == 1.0) or (str(first_value) == "1")
            except Exception:
                ok = False
        if ok:
            return {"ok": True}
        raise Exception(f"Unexpected SELECT 1 result: {result}")
    except Exception as e:
        return standardized_error_response(e)

@app.post("/export/pdf")
def export_pdf(payload: QueryReq, request: Request):
    try:
        if not is_allowed(["analyst", "editor", "viewer"]):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        log_with_request_id("Processing PDF export", "info", query=payload.query[:50])
        
        t0 = time.time(); step = {}
        # Reuse answer logic
        with tracer.start_as_current_span("embed.query"):
            vec = embed_texts([payload.query])[0]
        vector_literal = to_vector_literal(vec)
        step['embed_ms'] = int((time.time() - t0) * 1000)
        conn = get_conn(); t1 = time.time()
        with tracer.start_as_current_span("db.search.knn"):
            rows = cast(List[Dict[str, Any]], knn_search(conn, vector_literal, payload.top_k, payload.filter_category, request.headers.get("X-Org-Id")))
        conn.close(); step['search_ms'] = int((time.time() - t1) * 1000)
        passages = [{"id":r["id"],"doc_id":r["doc_id"],"ord":r["ord"],"text":r["text"],"dist":float(r["dist"])} for r in rows]
        model = os.getenv("PRIMARY_MODEL","gpt-4o")
        t2 = time.time()
        with tracer.start_as_current_span("llm.answer"):
            content, _, confidence = answer_with_evidence(payload.query, passages, model)
        step['llm_ms'] = int((time.time() - t2) * 1000)

        pdf_bytes = build_pdf(content, passages)
        log_with_request_id("PDF export completed", "info")
        try:
            conn2 = get_conn()
            insert_eval_log(conn2, {
                "id": str(uuid.uuid4()),
                "route": "export_pdf",
                "query": payload.query,
                "keyword": payload.keyword,
                "top_k": payload.top_k,
                "filter_category": payload.filter_category,
                "latency_ms": int((time.time() - t0) * 1000),
                "evidence_ids": [p["id"] for p in passages],
                "model": model,
                "confidence": confidence,
                "low_evidence": None,
                "rating": None,
                "step_ms": step,
                "org_id": request.headers.get("X-Org-Id"),
            })
            conn2.close()
        except Exception as e:
            logger.warning(f"Eval log insert failed: {e}")
        audit_event("export_pdf", query=payload.query, evidence_ids=[p["id"] for p in passages])
        # Analytics log (HTAP demo)
        try:
            conn3 = get_conn()
            insert_analytics_event(conn3, {
                "id": str(uuid.uuid4()),
                "route": "export_pdf",
                "query": payload.query,
                "latency_ms": int((time.time() - t0) * 1000),
                "top_doc_id": passages[0]["doc_id"] if passages else None,
                "org_id": request.headers.get("X-Org-Id"),
                "user_id": user_id_var.get(""),
                "retrieved_doc_ids": [p["doc_id"] for p in passages],
            })
            conn3.close()
        except Exception:
            pass
        return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf", headers={
            "Content-Disposition": "attachment; filename=docpilot_report.pdf"
        })
    except Exception as e:
        return standardized_error_response(e)

class CreateShareBody(BaseModel):
    query: str
    top_k: Optional[int] = None
    filter_category: Optional[str] = None
    keyword: Optional[str] = None
    filename: Optional[str] = None

@app.post("/share/pdf")
def share_pdf(body: CreateShareBody, request: Request):
    try:
        if not is_allowed(["analyst", "editor", "viewer"]):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        # Re-run retrieval + answer quickly to capture stable content
        vec = embed_texts([body.query])[0]
        vector_literal = to_vector_literal(vec)
        conn = get_conn()
        if body.keyword:
            rows = cast(List[Dict[str, Any]], hybrid_search(conn, vector_literal, body.keyword, body.top_k or 10, body.filter_category, request.headers.get("X-Org-Id")))
        else:
            rows = cast(List[Dict[str, Any]], knn_search(conn, vector_literal, body.top_k or 10, body.filter_category, request.headers.get("X-Org-Id")))
        conn.close()
        passages = [{"id":r["id"],"doc_id":r["doc_id"],"ord":r["ord"],"text":r["text"],"dist":float(r["dist"])} for r in rows]
        model = os.getenv("PRIMARY_MODEL","gpt-4o")
        content, _, _ = answer_with_evidence(body.query, passages, model)
        share_id = str(uuid.uuid4())
        conn2 = get_conn()
        share_row = {
            "id": share_id,
            "org_id": request.headers.get("X-Org-Id"),
            "query": body.query,
            "keyword": body.keyword,
            "top_k": body.top_k or 10,
            "filter_category": body.filter_category,
            "evidence_ids": [p["id"] for p in passages],
            "answer_content": content,
            "filename": body.filename or "docpilot_report.pdf",
            "expires_at": None,
        }
        share_row["vhash"] = compute_share_hash(share_row)
        insert_share_link(conn2, share_row)
        conn2.close()
        audit_event("share_pdf", query=body.query, evidence_ids=[p["id"] for p in passages])
        return {"status": "ok", "share_id": share_id, "vhash": share_row["vhash"]}
    except Exception as e:
        return standardized_error_response(e)

@app.get("/share/pdf/{share_id}")
def get_shared_pdf(share_id: str, request: Request):
    try:
        # Publicly accessible; optionally enforce org match if configured
        row_any = get_share_link(get_conn(), share_id)
        row = cast(Dict[str, Any], row_any) if row_any else None
        if not row:
            return JSONResponse(status_code=404, content={"error": "not found"})
        # Validate hash if provided
        vhash = request.headers.get("X-Share-Hash") or request.query_params.get("vhash")
        expected = compute_share_hash(row)
        if vhash and vhash != expected:
            return JSONResponse(status_code=403, content={"error": "invalid share hash"})
        # Rebuild PDF from stored content + evidence text
        conn = get_conn()
        evid_any = row.get("evidence_ids")
        evid: Optional[List[str]] = None
        try:
            if isinstance(evid_any, str):
                evid = json.loads(evid_any)
            elif isinstance(evid_any, list):
                evid = [str(x) for x in evid_any]
            else:
                evid = []
        except Exception:
            evid = []
        chunks = fetch_chunks_by_ids(conn, evid or [])
        conn.close()
        passages = [{"id":cast(Dict[str, Any], c)["id"],"doc_id":cast(Dict[str, Any], c)["doc_id"],"ord":cast(Dict[str, Any], c)["ord"],"text":cast(Dict[str, Any], c)["text"],"dist":0.0} for c in chunks]
        answer_content = cast(str, row.get("answer_content") or "")
        pdf_bytes = build_pdf(answer_content, passages)
        audit_event("share_pdf_get", query=str(share_id), evidence_ids=evid or [])
        return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf", headers={
            "Content-Disposition": f"attachment; filename={cast(str, row.get('filename') or 'docpilot_report.pdf')}"
        })
    except Exception as e:
        return standardized_error_response(e)

# --- MCP tool endpoints ---
@app.get("/mcp/tools")
def mcp_tools():
    try:
        if not is_allowed(POLICY_REQUIRED_ROLES.get("mcp.tools", ["admin"])):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        tools = [
            {"name": "ingest_text", "params": ["title", "text"], "returns": "doc_id, chunk_count"},
            {"name": "ingest_file_presigned", "params": ["key", "bucket?"], "returns": "doc_id, chunk_count"},
            {"name": "search", "params": ["query", "top_k?", "filter_category?", "keyword?"], "returns": "passages"},
            {"name": "answer", "params": ["query", "top_k?", "filter_category?", "keyword?"], "returns": "answer, evidence"},
            {"name": "export_pdf", "params": ["query", "top_k?", "filter_category?"], "returns": "pdf_stream"},
            {"name": "share_pdf", "params": ["query", "top_k?", "filter_category?", "keyword?", "filename?"], "returns": "share_id, vhash"},
            {"name": "linear_create", "params": ["title", "description"], "returns": "issue"},
            {"name": "confluence_publish", "params": ["space_key", "title", "content_html"], "returns": "page"},
        ]
        audit_event("mcp_tools")
        return {"tools": tools}
    except Exception as e:
        return standardized_error_response(e)

class McpInvokeBody(BaseModel):
    tool: str
    args: Dict[str, Any] = {}

@app.post("/mcp/invoke")
def mcp_invoke(body: McpInvokeBody, request: Request):
    try:
        if not is_allowed(POLICY_REQUIRED_ROLES.get("mcp.invoke", ["admin"])):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        t = (body.tool or "").strip()
        # Rate limit per (org_id or ip, tool)
        client_host = request.client.host if request.client else "unknown"
        rl_key = f"{request.headers.get('X-Org-Id') or client_host}:{t}"
        if not _rate_limit_allow(rl_key):
            return JSONResponse(status_code=429, content={"error": "rate_limited"})
        try:
            audit_event("mcp_invoke", query=f"tool={t}")
        except Exception:
            pass
        # Minimal dispatcher to existing endpoints
        if t == "search":
            payload = QueryReq(query=str(body.args.get("query") or ""), top_k=int(body.args.get("top_k") or 10), filter_category=body.args.get("filter_category"), keyword=body.args.get("keyword"))
            return query(payload, request)
        if t == "answer":
            payload = AnswerReq(query=str(body.args.get("query") or ""), top_k=int(body.args.get("top_k") or 10), filter_category=body.args.get("filter_category"), keyword=body.args.get("keyword"))
            return answer(payload, request)
        if t == "export_pdf":
            payload = QueryReq(query=str(body.args.get("query") or ""), top_k=int(body.args.get("top_k") or 10), filter_category=body.args.get("filter_category"))
            return export_pdf(payload, request)
        if t == "share_pdf":
            payload = CreateShareBody(query=str(body.args.get("query") or ""), top_k=int(body.args.get("top_k") or 10), filter_category=body.args.get("filter_category"), keyword=body.args.get("keyword"), filename=body.args.get("filename"))
            return share_pdf(payload, request)
        if t == "ingest_text":
            pay = IngestText(title=str(body.args.get("title") or "Untitled"), text=str(body.args.get("text") or ""))
            return ingest_text(pay, request)
        if t == "linear_create":
            return create_linear(CreateLinearBody(title=str(body.args.get("title") or "Untitled"), description=str(body.args.get("description") or "")))
        if t == "confluence_publish":
            return publish_confluence(PublishConfluenceBody(space_key=str(body.args.get("space_key") or ""), title=str(body.args.get("title") or "Untitled"), content_html=str(body.args.get("content_html") or "")))
        return JSONResponse(status_code=400, content={"error": f"unknown tool: {t}"})
    except Exception as e:
        return standardized_error_response(e)

@app.get("/debug/schema")
def debug_schema():
    try:
        if not is_allowed(["analyst", "viewer", "editor", "admin"]):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        conn = get_conn()
        cur = conn.cursor(dictionary=True)
        cur.execute("DESCRIBE chunks")
        columns = cur.fetchall()
        cur.execute("SHOW INDEX FROM chunks")
        indexes = cur.fetchall()
        cur.close()
        conn.close()
        try:
            audit_event("debug_schema")
        except Exception:
            pass
        return {"chunks_schema": columns, "indexes": indexes}
    except Exception as e:
        logging.exception("Schema debug failed")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/debug/add-fulltext")
def add_fulltext_index():
    try:
        if not is_allowed(["editor", "admin"]):
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        conn = get_conn()
        cur = conn.cursor()
        # Try to add FULLTEXT index on text column
        cur.execute("ALTER TABLE chunks ADD FULLTEXT(text)")
        conn.commit()
        cur.close()
        conn.close()
        try:
            audit_event("debug_add_fulltext")
        except Exception:
            pass
        return {"status": "FULLTEXT index added successfully"}
    except Exception as e:
        logging.exception("Failed to add FULLTEXT index")
        return {"status": "failed", "error": str(e), "note": "Will use LIKE fallback"}

@app.post("/demo/seed")
def demo_seed():
    try:
        conn = get_conn()
        doc_id = str(uuid.uuid4())
        upsert_document(conn, doc_id, "Demo Contract", {"category": "demo"})
        sample_text = """
        This Service Agreement includes an SLA with 99.9% uptime. Liability cap is limited to the fees paid in the last 12 months. Termination can occur with 30 days written notice. Jurisdiction is California. Data processing complies with GDPR.
        """.strip()
        chunks = make_chunks(sample_text, 400, 20)
        embeds = embed_texts(chunks)
        rows = []
        for i, (ch, ev) in enumerate(zip(chunks, embeds)):
            chunk_id = str(uuid.uuid4())
            rows.append((chunk_id, doc_id, i, ch, to_vector_literal(ev)))
        upsert_chunks(conn, rows)
        conn.close()
        return {"status": "ok", "doc_id": doc_id, "chunks": len(rows)}
    except Exception as e:
        return standardized_error_response(e)

@app.post("/demo/seed/batch")
def demo_seed_batch():
    try:
        samples = [
            ("Demo Contract A", "This Agreement sets an SLA of 99.9% availability. Liability is capped to 12 months of fees. Jurisdiction is California."),
            ("Demo Contract B", "Termination may occur with 30 days notice. GDPR-compliant data processing terms are included."),
            ("Demo Policy", "Service has 99.9% uptime. Liability cap applies. Data protection is handled according to GDPR."),
        ]
        total_chunks = 0
        conn = get_conn()
        for title, txt in samples:
            doc_id = str(uuid.uuid4())
            upsert_document(conn, doc_id, title, {"category": "demo"})
            chunks = make_chunks(txt, 400, 20)
            embeds = embed_texts(chunks)
            rows = []
            for i, (ch, ev) in enumerate(zip(chunks, embeds)):
                chunk_id = str(uuid.uuid4())
                rows.append((chunk_id, doc_id, i, ch, to_vector_literal(ev)))
            upsert_chunks(conn, rows)
            total_chunks += len(rows)
        conn.close()
        return {"status": "ok", "docs": len(samples), "chunks": total_chunks}
    except Exception as e:
        return standardized_error_response(e)
