# backend/scripts/schema_check.py
import os, re, sys
import pymysql  # ensure PyMySQL driver is available for SQLAlchemy
from typing import Optional

# ---- Config / expected dim
# Prefer explicit EMBED_DIM; otherwise infer from EMBED_MODEL_ID (basic map)
MODEL_DIM_MAP = {
    "BAAI/bge-large-en": 1024,
    "bge-large-en": 1024,
    "BAAI/bge-base-en": 768,
    "bge-base-en": 768,
    "text-embedding-3-large": 3072,
    "text-embedding-3-small": 1536,
}

def expected_dim() -> Optional[int]:
    raw_dim = os.getenv("EMBED_DIM")
    if raw_dim is not None:
        try:
            return int(raw_dim)
        except (ValueError, TypeError):
            pass
    mid = os.getenv("EMBED_MODEL_ID") or os.getenv("EMBED_MODEL") or os.getenv("EMBED_MODEL_NAME")
    if mid and mid in MODEL_DIM_MAP:
        return MODEL_DIM_MAP[mid]
    return None  # unknown → we will only do connectivity check

def normalize_to_pymysql(url: str) -> str:
    """Force mysql+pymysql dialect; warn if coercing from mysql://."""
    if url.startswith("mysql://"):
        coerced = "mysql+pymysql://" + url[len("mysql://"):]
        print("Schema-check: WARNING: coercing DB_URL mysql:// -> mysql+pymysql://", file=sys.stderr)
        return coerced
    return url

def db_url_with_ca(url: str) -> str:
    # append ssl-ca if local CA exists and not already provided
    ca_path = "./ca.pem"
    if "ssl-ca=" not in url and os.path.exists(ca_path):
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}ssl-ca={ca_path}"
    return url

def get_db_url() -> str:
    url = os.getenv("DB_URL")
    if not url:
        # Try to compose from TiDB envs
        host = os.getenv("TIDB_HOST")
        user = os.getenv("TIDB_USER")
        pwd  = os.getenv("TIDB_PASSWORD")
        port = os.getenv("TIDB_PORT", "4000")
        db   = os.getenv("TIDB_DATABASE", "docpilot")
        if not (host and user and pwd):
            print("Schema-check: DB_URL not set and TiDB envs missing; skipping.", file=sys.stderr)
            sys.exit(0)
        url = f"mysql+pymysql://{user}:{pwd}@{host}:{port}/{db}"
    url = normalize_to_pymysql(url)
    url = db_url_with_ca(url)
    # Log effective dialect and ssl-ca presence
    dialect = url.split("://", 1)[0] if "://" in url else "unknown"
    ssl_on = ("ssl-ca=" in url)
    print(f"Schema-check: using dialect={dialect} ssl-ca={'on' if ssl_on else 'off'}", file=sys.stderr)
    return url

def main():
    url = get_db_url()
    exp = expected_dim()

    # Use SQLAlchemy for MySQL/TiDB
    try:
        from sqlalchemy import create_engine, text
    except Exception as e:
        print("Schema-check: sqlalchemy not installed. Add 'SQLAlchemy' to backend/requirements.txt.", file=sys.stderr)
        sys.exit(2)

    engine = create_engine(url, pool_pre_ping=True, pool_recycle=180)
    # Quick connectivity check
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        print(f"Schema-check: DB connectivity failed: {e}", file=sys.stderr)
        sys.exit(1)

    # If we don't know expected dim, pass after connectivity
    if exp is None:
        print("Schema-check: connectivity OK; no expected EMBED_DIM → skipping dim check.")
        sys.exit(0)

    # Try to read VECTOR(dim) from chunks table
    ddl = None
    try:
        with engine.connect() as conn:
            # SHOW CREATE TABLE works on TiDB; fallback to information_schema if needed
            res = conn.execute(text("SHOW CREATE TABLE chunks"))
            row = res.fetchone()
            ddl = row[1] if row and len(row) > 1 else None
    except Exception as e:
        print(f"Schema-check: could not read table DDL (chunks): {e}", file=sys.stderr)
        sys.exit(0)  # don't fail hard on missing table in CI

    if not ddl:
        print("Schema-check: chunks table not found; skipping dim check.")
        sys.exit(0)

    m = re.search(r"VECTOR\((\d+)\)", ddl, re.IGNORECASE)
    if not m:
        print("Schema-check: VECTOR() type not detected in DDL; skipping.", file=sys.stderr)
        sys.exit(0)

    db_dim = int(m.group(1))
    if db_dim != exp:
        print(f"Schema-check: mismatch. DB VECTOR({db_dim}) vs expected EMBED_DIM({exp}).", file=sys.stderr)
        print(f"Migration hint:\n  ALTER TABLE chunks MODIFY COLUMN embedding VECTOR({exp}) NOT NULL;")
        sys.exit(1)

    print(f"Schema-check: OK. DB VECTOR({db_dim}) matches expected {exp}.")
    sys.exit(0)

if __name__ == "__main__":
    main()
