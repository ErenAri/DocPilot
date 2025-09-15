import os, json, uuid, datetime, mysql.connector
from dotenv import load_dotenv

load_dotenv()

def get_conn():
    ssl_ca = os.getenv("TIDB_CA_CERT_PATH")
    conn_kwargs = {
        "host": os.getenv("TIDB_HOST"),
        "port": int(os.getenv("TIDB_PORT", "4000")),
        "user": os.getenv("TIDB_USER"),
        "password": os.getenv("TIDB_PASSWORD"),
        "database": os.getenv("TIDB_DATABASE", "docpilot"),
    }
    if ssl_ca:
        conn_kwargs["ssl_ca"] = ssl_ca
    return mysql.connector.connect(**conn_kwargs)

def _embed_dim() -> int:
    # Keep in sync with embeddings.get_embed_dim
    from .embeddings import get_embed_dim
    return int(get_embed_dim())

def get_db_vector_dim(conn) -> int | None:
    cur = conn.cursor()
    try:
        cur.execute("SHOW CREATE TABLE chunks")
        row = cur.fetchone()
        if not row:
            return None
        ddl = row[1] if len(row) > 1 else row[0]
        import re
        m = re.search(r"embedding\s+VECTOR\((\d+)\)", ddl, re.IGNORECASE)
        if m:
            return int(m.group(1))
        return None
    except Exception:
        return None
    finally:
        cur.close()

def ensure_documents_table(conn):
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS documents (
          id CHAR(36) PRIMARY KEY,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          org_id VARCHAR(128) NULL,
          title VARCHAR(512) NOT NULL,
          meta JSON NULL
        )
        """
    )
    try:
        cur.execute("CREATE INDEX idx_documents_org ON documents (org_id)")
        cur.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS user_id VARCHAR(128)")
        conn.commit()
    except Exception:
        conn.rollback()
    finally:
        cur.close()

def count_documents(conn, org_id: str | None) -> int:
    cur = conn.cursor()
    try:
        query = "SELECT COUNT(*) FROM documents WHERE (%s IS NULL OR org_id <=> %s)"
        cur.execute(query, (org_id, org_id))
        result = cur.fetchone()
        return result[0] if result else 0
    finally:
        cur.close()

def list_documents(conn, org_id: str | None, limit: int, offset: int):
    cur = conn.cursor(dictionary=True)
    try:
        query = """
            SELECT id, title, created_at, meta
            FROM documents
            WHERE (%s IS NULL OR org_id <=> %s)
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
        """
        cur.execute(query, (org_id, org_id, limit, offset))
        rows = cur.fetchall()
        return rows
    finally:
        cur.close()

def ensure_chunks_table(conn):
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS chunks (
          id CHAR(36) PRIMARY KEY,
          doc_id CHAR(36) NOT NULL,
          ord INT NOT NULL,
          text TEXT NULL,
          embedding VECTOR(%s) NOT NULL,
          org_id VARCHAR(128) NULL
        )
        """,
        ( _embed_dim(), )
    )
    conn.commit()
    cur.close()

def migrate_chunks_embedding_to_vector(conn):
    cur = conn.cursor()
    try:
        cur.execute(f"ALTER TABLE chunks MODIFY COLUMN embedding VECTOR({_embed_dim()}) NOT NULL")
        conn.commit()
    except Exception:
        conn.rollback()
    finally:
        cur.close()

def ensure_chunks_hnsw_index(conn):
    cur = conn.cursor()
    try:
        # Prefer TiDB syntax
        cur.execute("CREATE INDEX idx_chunks_embedding ON chunks (embedding) USING HNSW")
        conn.commit()
    except Exception:
        conn.rollback()
        try:
            # MySQL-compatible syntax on some distributions
            cur.execute("CREATE INDEX idx_chunks_embedding ON chunks (embedding) ALGORITHM=HNSW")
            conn.commit()
        except Exception:
            conn.rollback()
    finally:
        cur.close()

def ensure_core_vector_schema(conn):
    """Ensure VECTOR schema and HNSW index exist for RAG tables."""
    ensure_documents_table(conn)
    ensure_chunks_table(conn)
    # Attempt migration in case column existed with a different type
    migrate_chunks_embedding_to_vector(conn)
    # Verify dimension matches configured/derived dim
    desired = _embed_dim()
    actual = get_db_vector_dim(conn)
    if actual is not None and actual != desired:
        # Raise with migration hint; caller can catch and present clearly
        raise RuntimeError(
            f"EMBED_DIM mismatch: DB chunks.embedding=VECTOR({actual}) but configured/derived is {desired}. "
            f"Run: ALTER TABLE chunks MODIFY COLUMN embedding VECTOR({desired}) NOT NULL;"
        )
    # Secondary indexes commonly used
    ensure_chunks_secondary_indexes(conn)
    # Ensure TiFlash replica for analytical scans (optional)
    try:
        ensure_tiflash_replica(conn)
    except Exception:
        pass
    # Ensure HNSW approximate vector index
    ensure_chunks_hnsw_index(conn)

def upsert_document(conn, doc_id, title, meta, org_id=None, user_id=None):
    cur = conn.cursor()
    if meta is None:
        if org_id is not None:
            cur.execute(
                "INSERT INTO documents (id, org_id, user_id, title, meta) VALUES (%s,%s,%s,%s,JSON_OBJECT()) "
                "ON DUPLICATE KEY UPDATE title=VALUES(title), org_id=VALUES(org_id), user_id=VALUES(user_id)",
                (doc_id, org_id, user_id, title),
            )
        else:
            cur.execute(
                "INSERT INTO documents (id, user_id, title, meta) VALUES (%s,%s,%s,JSON_OBJECT()) "
                "ON DUPLICATE KEY UPDATE title=VALUES(title), user_id=VALUES(user_id)",
                (doc_id, user_id, title),
            )
    else:
        if org_id is not None:
            cur.execute(
                "INSERT INTO documents (id, org_id, user_id, title, meta) VALUES (%s,%s,%s,%s,%s) "
                "ON DUPLICATE KEY UPDATE title=VALUES(title), meta=VALUES(meta), org_id=VALUES(org_id), user_id=VALUES(user_id)",
                (doc_id, org_id, user_id, title, json.dumps(meta)),
            )
        else:
            cur.execute(
                "INSERT INTO documents (id, user_id, title, meta) VALUES (%s,%s,%s,%s) "
                "ON DUPLICATE KEY UPDATE title=VALUES(title), meta=VALUES(meta), user_id=VALUES(user_id)",
                (doc_id, user_id, title, json.dumps(meta)),
            )
    conn.commit()
    cur.close()

def upsert_chunks(conn, rows, org_id=None):
    # rows: [(chunk_id, doc_id, ord, text, vector_literal_str), ...]
    cur = conn.cursor()
    if org_id is not None:
        rows_with_org = [(rid, did, o, t, e, org_id) for (rid, did, o, t, e) in rows]
        cur.executemany(
            "INSERT INTO chunks (id, doc_id, ord, text, embedding, org_id) "
            "VALUES (%s,%s,%s,%s,%s,%s) "
            "ON DUPLICATE KEY UPDATE text=VALUES(text), embedding=VALUES(embedding), org_id=VALUES(org_id)",
            rows_with_org,
        )
    else:
        cur.executemany(
            "INSERT INTO chunks (id, doc_id, ord, text, embedding) "
            "VALUES (%s,%s,%s,%s,%s) "
            "ON DUPLICATE KEY UPDATE text=VALUES(text), embedding=VALUES(embedding)",
            rows,
        )
    conn.commit()
    cur.close()

def ensure_fulltext_index(conn):
    cur = conn.cursor()
    try:
        cur.execute("ALTER TABLE chunks ADD FULLTEXT(text)")
        conn.commit()
    except Exception:
        # Index may already exist; ignore
        conn.rollback()
    finally:
        cur.close()

def ensure_chunks_secondary_indexes(conn):
    cur = conn.cursor()
    try:
        # Speed up doc ordering and org filters
        cur.execute("CREATE INDEX idx_chunks_doc_ord ON chunks (doc_id, ord)")
        cur.execute("CREATE INDEX idx_chunks_org ON chunks (org_id)")
        conn.commit()
    except Exception:
        conn.rollback()
    finally:
        cur.close()

def ensure_tiflash_replica(conn):
    cur = conn.cursor()
    try:
        cur.execute("ALTER TABLE chunks SET TIFLASH REPLICA 1")
        conn.commit()
    except Exception:
        conn.rollback()
    finally:
        cur.close()

def ensure_analytics_table(conn):
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS analytics_log (
          id CHAR(36) PRIMARY KEY,
          ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          route VARCHAR(32) NOT NULL,
          query TEXT NULL,
          latency_ms INT NULL,
          top_doc_id CHAR(36) NULL,
          org_id VARCHAR(128) NULL,
          user_id VARCHAR(128) NULL,
          retrieved_doc_ids JSON NULL,
          extras JSON NULL
        )
        """
    )
    try:
        cur.execute("CREATE INDEX idx_analytics_ts ON analytics_log (ts)")
        cur.execute("CREATE INDEX idx_analytics_route ON analytics_log (route)")
        cur.execute("CREATE INDEX idx_analytics_topdoc ON analytics_log (top_doc_id)")
        cur.execute("CREATE INDEX idx_analytics_org ON analytics_log (org_id)")
        cur.execute("ALTER TABLE analytics_log ADD COLUMN IF NOT EXISTS user_id VARCHAR(128)")
        cur.execute("ALTER TABLE analytics_log ADD COLUMN IF NOT EXISTS extras JSON")
        conn.commit()
    except Exception:
        conn.rollback()
    finally:
        cur.close()

def insert_analytics_event(conn, row):
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO analytics_log (id, route, query, latency_ms, top_doc_id, org_id, user_id, retrieved_doc_ids, extras)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        (
            row.get("id"), row.get("route"), row.get("query"), row.get("latency_ms"),
            row.get("top_doc_id"), row.get("org_id"), row.get("user_id"), json.dumps(row.get("retrieved_doc_ids")),
            json.dumps(row.get("extras")) if row.get("extras") is not None else None,
        ),
    )
    conn.commit()
    cur.close()

def ensure_users_tables(conn):
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
          id CHAR(36) PRIMARY KEY,
          username VARCHAR(128) UNIQUE NOT NULL,
          password_hash CHAR(64) NOT NULL,
          org_id VARCHAR(128) NULL
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
          token CHAR(36) PRIMARY KEY,
          user_id CHAR(36) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP NULL
        )
        """
    )
    conn.commit()
    cur.close()

def upsert_demo_users(conn):
    users_env = os.getenv("DEMO_USERS_JSON")
    demo = None
    try:
        if users_env:
            demo = json.loads(users_env)
    except Exception:
        demo = None
    if not demo:
        demo = [
            {"username": "admin", "password": "admin123", "org_id": "demo"},
            {"username": "analyst", "password": "analyst123", "org_id": "demo"},
        ]
    cur = conn.cursor()
    for u in demo:
        uid = str(uuid.uuid4())
        import hashlib
        ph = hashlib.sha256((u["password"] or "").encode("utf-8")).hexdigest()
        try:
            cur.execute(
                "INSERT INTO users (id, username, password_hash, org_id) VALUES (%s,%s,%s,%s) ON DUPLICATE KEY UPDATE org_id=VALUES(org_id)",
                (uid, u["username"], ph, u.get("org_id")),
            )
        except Exception:
            conn.rollback()
    conn.commit()
    cur.close()

def get_user_by_credentials(conn, username: str, password: str):
    import hashlib
    ph = hashlib.sha256((password or "").encode("utf-8")).hexdigest()
    cur = conn.cursor(dictionary=True)
    cur.execute("SELECT id, username, org_id FROM users WHERE username=%s AND password_hash=%s", (username, ph))
    row = cur.fetchone()
    cur.close()
    return row

def create_session(conn, user_id: str, ttl_minutes: int = 120) -> str:
    token = str(uuid.uuid4())
    expires = datetime.datetime.utcnow() + datetime.timedelta(minutes=ttl_minutes)
    cur = conn.cursor()
    cur.execute("INSERT INTO sessions (token, user_id, expires_at) VALUES (%s,%s,%s)", (token, user_id, expires))
    conn.commit()
    cur.close()
    return token

def get_user_by_token(conn, token: str):
    cur = conn.cursor(dictionary=True)
    cur.execute("SELECT s.user_id, u.username, u.org_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token=%s AND (s.expires_at IS NULL OR s.expires_at > UTC_TIMESTAMP())", (token,))
    row = cur.fetchone()
    cur.close()
    return row

def fetch_document_text(conn, doc_id: str) -> str:
    cur = conn.cursor()
    cur.execute(
        "SELECT text FROM chunks WHERE doc_id=%s ORDER BY ord ASC",
        (doc_id,)
    )
    parts = [row[0] or "" for row in cur.fetchall()]
    cur.close()
    return "\n".join(parts)

def fetch_chunks_by_ids(conn, ids):
    if not ids:
        return []
    cur = conn.cursor(dictionary=True)
    placeholders = ",".join(["%s"] * len(ids))
    cur.execute(
        f"SELECT id, doc_id, ord, text FROM chunks WHERE id IN ({placeholders})",
        tuple(ids),
    )
    rows = cur.fetchall()
    cur.close()
    return rows

def knn_search(conn, vector_literal, top_k, filter_category=None, org_id=None):
    cur = conn.cursor(dictionary=True)
    if filter_category:
        q = """
        WITH knn AS (
          SELECT id, doc_id, ord, text,
                 VEC_COSINE_DISTANCE(embedding, %s) AS dist
          FROM chunks
          {chunk_org}
          ORDER BY dist ASC
          LIMIT %s
        )
        SELECT k.*
        FROM knn k
        JOIN documents d ON d.id = k.doc_id
        WHERE JSON_UNQUOTE(JSON_EXTRACT(d.meta,'$.category')) = %s
          {doc_org}
        ORDER BY k.dist ASC
        LIMIT %s
        """
        q = q.format(
            chunk_org=("WHERE org_id = %s" if org_id else ""),
            doc_org=("AND d.org_id = %s" if org_id else ""),
        )
        params = [vector_literal]
        if org_id:
            params.append(org_id)
        params.append(top_k * 5)
        params.append(filter_category)
        if org_id:
            params.append(org_id)
        params.append(top_k)
        cur.execute(q, tuple(params))
    else:
        q = """
        SELECT id, doc_id, ord, text,
               VEC_COSINE_DISTANCE(embedding, %s) AS dist
        FROM chunks
        {chunk_org}
        ORDER BY dist ASC
        LIMIT %s
        """
        q = q.format(chunk_org=("WHERE org_id = %s" if org_id else ""))
        params = [vector_literal]
        if org_id:
            params.append(org_id)
        params.append(top_k)
        cur.execute(q, tuple(params))
    rows = cur.fetchall()
    cur.close()
    return rows

# --- Optional/compat fallbacks ---
def hybrid_search(conn, vector_literal, keyword, top_k, filter_category=None, org_id=None):
    """Hybrid search combining BM25/FULLTEXT with vector distance.

    Strategy:
    - If keyword provided, pre-filter with FULLTEXT MATCH AGAINST in BOOLEAN MODE (or LIKE fallback)
    - Compute cosine distance on the filtered set, then order by dist
    - If filter_category is provided, join to documents with JSON category match
    """
    cur = conn.cursor(dictionary=True)
    # Prefer FULLTEXT if available, otherwise fallback to LIKE
    try:
        if filter_category:
            q = """
            WITH ft AS (
              SELECT c.id, c.doc_id, c.ord, c.text
              FROM chunks c
              JOIN documents d ON d.id = c.doc_id
              WHERE MATCH(c.text) AGAINST (%s IN BOOLEAN MODE)
                AND JSON_UNQUOTE(JSON_EXTRACT(d.meta,'$.category')) = %s
                {doc_org}
              LIMIT %s
            )
            SELECT id, doc_id, ord, text,
                   VEC_COSINE_DISTANCE(embedding, %s) AS dist
            FROM chunks
            WHERE id IN (SELECT id FROM ft)
            {chunk_org_and}
            ORDER BY dist ASC
            LIMIT %s
            """
            q = q.format(
                doc_org=("AND d.org_id = %s" if org_id else ""),
                chunk_org_and=("AND org_id = %s" if org_id else ""),
            )
            params = [keyword, filter_category]
            if org_id:
                params.append(org_id)
            params.append(top_k * 10)
            params.append(vector_literal)
            if org_id:
                params.append(org_id)
            params.append(top_k)
            cur.execute(q, tuple(params))
        else:
            q = """
            WITH ft AS (
              SELECT id, doc_id, ord, text
              FROM chunks
              WHERE MATCH(text) AGAINST (%s IN BOOLEAN MODE)
              {chunk_org_where}
              LIMIT %s
            )
            SELECT id, doc_id, ord, text,
                   VEC_COSINE_DISTANCE(embedding, %s) AS dist
            FROM chunks
            WHERE id IN (SELECT id FROM ft)
            {chunk_org_and}
            ORDER BY dist ASC
            LIMIT %s
            """
            q = q.format(
                chunk_org_where=("AND org_id = %s" if org_id else ""),
                chunk_org_and=("AND org_id = %s" if org_id else ""),
            )
            params = [keyword]
            if org_id:
                params.append(org_id)
            params.append(top_k * 10)
            params.append(vector_literal)
            if org_id:
                params.append(org_id)
            params.append(top_k)
            cur.execute(q, tuple(params))
    except Exception:
        # LIKE fallback
        like_kw = f"%{keyword}%"
        if filter_category:
            q = """
            WITH ft AS (
              SELECT c.id
              FROM chunks c
              JOIN documents d ON d.id = c.doc_id
              WHERE c.text LIKE %s
                AND JSON_UNQUOTE(JSON_EXTRACT(d.meta,'$.category')) = %s
                {doc_org}
              LIMIT %s
            )
            SELECT id, doc_id, ord, text,
                   VEC_COSINE_DISTANCE(embedding, %s) AS dist
            FROM chunks
            WHERE id IN (SELECT id FROM ft)
            {chunk_org_and}
            ORDER BY dist ASC
            LIMIT %s
            """
            q = q.format(
                doc_org=("AND d.org_id = %s" if org_id else ""),
                chunk_org_and=("AND org_id = %s" if org_id else ""),
            )
            params = [like_kw, filter_category]
            if org_id:
                params.append(org_id)
            params.append(top_k * 10)
            params.append(vector_literal)
            if org_id:
                params.append(org_id)
            params.append(top_k)
            cur.execute(q, tuple(params))
        else:
            q = """
            WITH ft AS (
              SELECT id
              FROM chunks
              WHERE text LIKE %s
              {chunk_org_where}
              LIMIT %s
            )
            SELECT id, doc_id, ord, text,
                   VEC_COSINE_DISTANCE(embedding, %s) AS dist
            FROM chunks
            WHERE id IN (SELECT id FROM ft)
            {chunk_org_and}
            ORDER BY dist ASC
            LIMIT %s
            """
            q = q.format(
                chunk_org_where=("AND org_id = %s" if org_id else ""),
                chunk_org_and=("AND org_id = %s" if org_id else ""),
            )
            params = [like_kw]
            if org_id:
                params.append(org_id)
            params.append(top_k * 10)
            params.append(vector_literal)
            if org_id:
                params.append(org_id)
            params.append(top_k)
            cur.execute(q, tuple(params))
    rows = cur.fetchall()
    cur.close()
    return rows

def hybrid_fusion_search(conn, vector_literal, keyword, top_k, filter_category=None, org_id=None):
    """Hybrid retrieval with fusion (RRF) combining FULLTEXT and VECTOR candidates.

    Strategy:
    - Get FULLTEXT candidates with a relevance score when possible (NATURAL LANGUAGE MODE),
      falling back to BOOLEAN MODE or LIKE-derived score.
    - Get VECTOR KNN candidates with cosine distance.
    - Compute Reciprocal Rank Fusion (RRF): 1/(k + rank_ft) + 1/(k + rank_vec),
      with k configurable via HYBRID_RRF_K (default 60).
    - Return top_k rows, preserving fields: id, doc_id, ord, text, dist.
    """
    ft_limit = max(10, int(os.getenv("HYBRID_FT_CANDIDATES", "100")))
    vec_limit = max(top_k, int(os.getenv("HYBRID_VEC_CANDIDATES", "100")))
    rrf_k = max(1, int(os.getenv("HYBRID_RRF_K", "60")))

    cur = conn.cursor(dictionary=True)
    # 1) FULLTEXT candidates with score
    ft_rows: list[dict] = []
    try:
        if filter_category:
            q = (
                "SELECT c.id, c.doc_id, c.ord, c.text, "
                "MATCH(c.text) AGAINST (%s) AS ft_score "
                "FROM chunks c JOIN documents d ON d.id = c.doc_id "
                "WHERE (d.org_id <=> %s OR %s IS NULL) AND JSON_UNQUOTE(JSON_EXTRACT(d.meta,'$.category')) = %s "
                "ORDER BY ft_score DESC LIMIT %s"
            )
            cur.execute(q, (keyword, org_id, org_id, filter_category, ft_limit))
        else:
            q = (
                "SELECT id, doc_id, ord, text, MATCH(text) AGAINST (%s) AS ft_score "
                "FROM chunks WHERE (org_id <=> %s OR %s IS NULL) ORDER BY ft_score DESC LIMIT %s"
            )
            cur.execute(q, (keyword, org_id, org_id, ft_limit))
        ft_rows = cur.fetchall() or []
        # Drop rows with NULL ft_score
        ft_rows = [r for r in ft_rows if r.get("ft_score") is not None]
    except Exception:
        # Fallback to LIKE-derived score
        like_kw = f"%{keyword}%"
        try:
            if filter_category:
                q = (
                    "SELECT c.id, c.doc_id, c.ord, c.text, "
                    "(LENGTH(LOWER(c.text)) - LENGTH(REPLACE(LOWER(c.text), LOWER(%s), ''))) / NULLIF(LENGTH(%s),0) AS ft_score "
                    "FROM chunks c JOIN documents d ON d.id = c.doc_id "
                    "WHERE c.text LIKE %s AND (d.org_id <=> %s OR %s IS NULL) AND JSON_UNQUOTE(JSON_EXTRACT(d.meta,'$.category')) = %s "
                    "ORDER BY ft_score DESC LIMIT %s"
                )
                cur.execute(q, (keyword, keyword, like_kw, org_id, org_id, filter_category, ft_limit))
            else:
                q = (
                    "SELECT id, doc_id, ord, text, "
                    "(LENGTH(LOWER(text)) - LENGTH(REPLACE(LOWER(text), LOWER(%s), ''))) / NULLIF(LENGTH(%s),0) AS ft_score "
                    "FROM chunks WHERE text LIKE %s AND (org_id <=> %s OR %s IS NULL) "
                    "ORDER BY ft_score DESC LIMIT %s"
                )
                cur.execute(q, (keyword, keyword, like_kw, org_id, org_id, ft_limit))
            ft_rows = cur.fetchall() or []
        except Exception:
            ft_rows = []

    # 2) VECTOR candidates
    vec_rows = knn_search(conn, vector_literal, vec_limit, filter_category, org_id)
    # 3) Build rank maps
    ft_rank: dict[str, int] = {}
    for idx, r in enumerate(ft_rows):
        try:
            ft_rank[str(r["id"])] = idx + 1
        except Exception:
            continue
    vec_rank: dict[str, int] = {}
    vec_dist: dict[str, float] = {}
    vec_row_map: dict[str, dict] = {}
    for idx, r in enumerate(vec_rows):
        try:
            rid = str(r["id"])
            vec_rank[rid] = idx + 1
            vec_row_map[rid] = r
            vec_dist[rid] = float(r.get("dist") or 0.0)
        except Exception:
            continue
    # 4) RRF fusion
    all_ids = list({*ft_rank.keys(), *vec_rank.keys()})
    def rrf_score(rid: str) -> float:
        rf = 1.0 / (rrf_k + ft_rank[rid]) if rid in ft_rank else 0.0
        rv = 1.0 / (rrf_k + vec_rank[rid]) if rid in vec_rank else 0.0
        return rf + rv
    ranked = sorted(all_ids, key=lambda rid: rrf_score(rid), reverse=True)[:top_k]
    # 5) Build rows with required fields
    results = []
    # Prefer pulling text/doc_id/ord from whichever we have
    ft_map = {str(r["id"]): r for r in ft_rows if r.get("id") is not None}
    for rid in ranked:
        base = vec_row_map.get(rid) or ft_map.get(rid) or {}
        results.append({
            "id": rid,
            "doc_id": base.get("doc_id"),
            "ord": base.get("ord", 0),
            "text": base.get("text", ""),
            "dist": vec_dist.get(rid, 0.0),
        })
    return results

def setup_vector_optimization(conn):
    """Optional optimization setup: ensure FULLTEXT index for hybrid and any other needed hints."""
    ensure_fulltext_index(conn)

def ensure_tenant_columns(conn):
    cur = conn.cursor()
    try:
        cur.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS org_id VARCHAR(128)")
        cur.execute("ALTER TABLE chunks ADD COLUMN IF NOT EXISTS org_id VARCHAR(128)")
        cur.execute("ALTER TABLE eval_logs ADD COLUMN IF NOT EXISTS org_id VARCHAR(128)")
        cur.execute("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS org_id VARCHAR(128)")
        conn.commit()
    except Exception:
        conn.rollback()
    finally:
        cur.close()

# --- Eval logging ---
def ensure_eval_table(conn):
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS eval_logs (
          id CHAR(36) PRIMARY KEY,
          ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          route VARCHAR(32),
          query TEXT,
          keyword VARCHAR(255),
          top_k INT,
          filter_category VARCHAR(255),
          latency_ms INT,
          evidence_ids JSON,
          model VARCHAR(128),
          confidence FLOAT,
          low_evidence BOOLEAN,
          rating TINYINT NULL
        )
        """
    )
    # Add step_ms column if not exists
    try:
        cur.execute("ALTER TABLE eval_logs ADD COLUMN IF NOT EXISTS step_ms JSON")
        conn.commit()
    except Exception:
        conn.rollback()
    conn.commit()
    cur.close()

# --- Audit logs ---
def ensure_audit_table(conn):
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_logs (
          id CHAR(36) PRIMARY KEY,
          ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          user_id VARCHAR(128) NULL,
          route VARCHAR(32) NOT NULL,
          query TEXT NULL,
          evidence_ids JSON NULL,
          request_id VARCHAR(32) NULL
        )
        """
    )
    conn.commit()
    # Add columns if missing
    try:
        cur.execute("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS org_id VARCHAR(128)")
        cur.execute("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS raw_content MEDIUMTEXT")
        conn.commit()
    except Exception:
        conn.rollback()
    cur.close()

def insert_audit(conn, row):
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO audit_logs (id, user_id, route, query, evidence_ids, request_id, org_id, raw_content)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        (
            row.get("id"), row.get("user_id"), row.get("route"), row.get("query"), json.dumps(row.get("evidence_ids")), row.get("request_id"), row.get("org_id"), row.get("raw_content")
        )
    )
    conn.commit()
    cur.close()

def insert_audit_raw(conn, row):
    """Insert audit log with raw_content; fallback to insert_audit if column absent."""
    try:
        insert_audit(conn, row)
    except Exception:
        # Fallback without raw_content for compatibility
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO audit_logs (id, user_id, route, query, evidence_ids, request_id, org_id)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                row.get("id"), row.get("user_id"), row.get("route"), row.get("query"), json.dumps(row.get("evidence_ids")), row.get("request_id"), row.get("org_id")
            )
        )
        conn.commit()
        cur.close()

def insert_eval_log(conn, row):
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO eval_logs
          (id, route, query, keyword, top_k, filter_category, latency_ms, evidence_ids, model, confidence, low_evidence, rating, step_ms, org_id)
        VALUES
          (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        (
            row.get("id"), row.get("route"), row.get("query"), row.get("keyword"), row.get("top_k"),
            row.get("filter_category"), row.get("latency_ms"), json.dumps(row.get("evidence_ids")), row.get("model"),
            row.get("confidence"), row.get("low_evidence"), row.get("rating"), json.dumps(row.get("step_ms")), row.get("org_id"),
        ),
    )
    conn.commit()
    cur.close()

def update_eval_rating(conn, eval_id: str, rating: int | None):
    cur = conn.cursor()
    cur.execute(
        "UPDATE eval_logs SET rating=%s WHERE id=%s",
        (rating, eval_id),
    )
    conn.commit()
    cur.close()

# --- Eval gold & results ---
def ensure_eval_gold_tables(conn):
    cur = conn.cursor()
    # Gold set
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS eval_gold (
          id CHAR(36) PRIMARY KEY,
          query TEXT NOT NULL,
          expected_contains TEXT NULL,
          expected_keywords JSON NULL,
          expected_doc_ids JSON NULL,
          filter_category VARCHAR(255) NULL,
          keyword VARCHAR(255) NULL,
          top_k INT NULL
        )
        """
    )
    # Add new columns if missing
    try:
        cur.execute("ALTER TABLE eval_gold ADD COLUMN IF NOT EXISTS expected_doc_ids JSON")
        conn.commit()
    except Exception:
        conn.rollback()
    # Results
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS eval_results (
          id CHAR(36) PRIMARY KEY,
          ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          gold_id CHAR(36) NOT NULL,
          answer_len INT,
          used_evidence_ids JSON,
          match_score FLOAT,
          passed BOOLEAN,
          model VARCHAR(128) NULL,
          step_ms JSON NULL,
          keyword_recall FLOAT NULL,
          ndcg FLOAT NULL,
          faithfulness FLOAT NULL
        )
        """
    )
    # Add columns if table existed without them
    try:
        cur.execute("ALTER TABLE eval_results ADD COLUMN IF NOT EXISTS keyword_recall FLOAT")
        cur.execute("ALTER TABLE eval_results ADD COLUMN IF NOT EXISTS ndcg FLOAT")
        cur.execute("ALTER TABLE eval_results ADD COLUMN IF NOT EXISTS faithfulness FLOAT")
        conn.commit()
    except Exception:
        conn.rollback()
    conn.commit()
    cur.close()

# --- Share links ---
def ensure_share_links_table(conn):
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS share_links (
          id CHAR(36) PRIMARY KEY,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          org_id VARCHAR(128) NULL,
          query TEXT NOT NULL,
          keyword VARCHAR(255) NULL,
          top_k INT NULL,
          filter_category VARCHAR(255) NULL,
          evidence_ids JSON NULL,
          answer_content MEDIUMTEXT NULL,
          filename VARCHAR(255) NULL,
          expires_at TIMESTAMP NULL,
          vhash CHAR(64) NULL
        )
        """
    )
    conn.commit()
    cur.close()

def insert_share_link(conn, row):
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO share_links (id, org_id, query, keyword, top_k, filter_category, evidence_ids, answer_content, filename, expires_at, vhash)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        (
            row.get("id"), row.get("org_id"), row.get("query"), row.get("keyword"), row.get("top_k"), row.get("filter_category"),
            json.dumps(row.get("evidence_ids")), row.get("answer_content"), row.get("filename"), row.get("expires_at"), row.get("vhash"),
        ),
    )
    conn.commit()
    cur.close()

def get_share_link(conn, share_id):
    cur = conn.cursor(dictionary=True)
    cur.execute("SELECT * FROM share_links WHERE id=%s", (share_id,))
    row = cur.fetchone()
    cur.close()
    return row

def compact_dedup_chunks(conn):
    """Remove duplicate chunks keeping the lowest id per (org_id, doc_id, ord, text)."""
    cur = conn.cursor()
    try:
        cur.execute(
            """
            DELETE c1 FROM chunks c1
            JOIN chunks c2
              ON c1.doc_id = c2.doc_id
             AND c1.ord = c2.ord
             AND (c1.org_id <=> c2.org_id)
             AND c1.text = c2.text
             AND c1.id > c2.id
            """
        )
        deleted = cur.rowcount
        conn.commit()
    except Exception:
        conn.rollback()
        deleted = 0
    finally:
        cur.close()
    return deleted

# --- Eval calibration persistence ---
def ensure_calibration_table(conn):
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS eval_calibration (
          id VARCHAR(64) PRIMARY KEY,
          threshold FLOAT,
          last_run TIMESTAMP NULL
        )
        """
    )
    conn.commit()
    cur.close()

def get_calibration(conn):
    cur = conn.cursor(dictionary=True)
    cur.execute("SELECT threshold, last_run FROM eval_calibration WHERE id=%s", ("default",))
    row = cur.fetchone()
    cur.close()
    return row

def set_calibration(conn, threshold: float, last_run: str | None = None):
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO eval_calibration (id, threshold, last_run)
        VALUES (%s,%s,%s)
        ON DUPLICATE KEY UPDATE threshold=VALUES(threshold), last_run=VALUES(last_run)
        """,
        ("default", threshold, last_run),
    )
    conn.commit()
    cur.close()

def insert_eval_gold(conn, rows):
    cur = conn.cursor()
    cur.executemany(
        """
        INSERT INTO eval_gold (id, query, expected_contains, expected_keywords, expected_doc_ids, filter_category, keyword, top_k)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        ON DUPLICATE KEY UPDATE query=VALUES(query), expected_contains=VALUES(expected_contains), expected_keywords=VALUES(expected_keywords), expected_doc_ids=VALUES(expected_doc_ids), filter_category=VALUES(filter_category), keyword=VALUES(keyword), top_k=VALUES(top_k)
        """,
        [(
            r["id"], r["query"], r.get("expected_contains"), json.dumps(r.get("expected_keywords")) if r.get("expected_keywords") is not None else None,
            json.dumps(r.get("expected_doc_ids")) if r.get("expected_doc_ids") is not None else None,
            r.get("filter_category"), r.get("keyword"), r.get("top_k"),
        ) for r in rows]
    )
    conn.commit()
    cur.close()

def insert_eval_result(conn, row):
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO eval_results (id, gold_id, answer_len, used_evidence_ids, match_score, passed, model, step_ms, keyword_recall, ndcg, faithfulness)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        (
            row.get("id"), row.get("gold_id"), row.get("answer_len"), json.dumps(row.get("used_evidence_ids")),
            row.get("match_score"), row.get("passed"), row.get("model"), json.dumps(row.get("step_ms")),
            row.get("keyword_recall"), row.get("ndcg"), row.get("faithfulness"),
        )
    )
    conn.commit()
    cur.close()

def get_document_chunks(conn, doc_id: str, org_id: str | None):
    cur = conn.cursor(dictionary=True)
    try:
        query = """
            SELECT id, doc_id, ord, text
            FROM chunks
            WHERE doc_id = %s AND (%s IS NULL OR org_id <=> %s)
            ORDER BY ord ASC
        """
        cur.execute(query, (doc_id, org_id, org_id))
        rows = cur.fetchall()
        return rows
    finally:
        cur.close()