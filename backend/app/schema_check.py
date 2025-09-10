import os
import sys

def main() -> int:
    # Derive desired EMBED_DIM from env/model
    try:
        from .embeddings import get_embed_dim, get_embed_model_id
    except Exception as e:
        print(f"SCHEMA_CHECK: ERROR cannot import embeddings: {e}")
        return 1
    desired = int(get_embed_dim())
    model_id = get_embed_model_id() or os.getenv("EMBED_MODEL") or ""

    # Skip if DB not configured
    required_env = ["TIDB_HOST", "TIDB_USER", "TIDB_DATABASE"]
    if any(not os.getenv(k) for k in required_env):
        print("SCHEMA_CHECK: SKIP (missing DB env: TIDB_HOST/TIDB_USER/TIDB_DATABASE)")
        return 0

    try:
        from .db import get_conn, get_db_vector_dim
    except Exception as e:
        print(f"SCHEMA_CHECK: ERROR cannot import db helpers: {e}")
        return 1

    try:
        conn = get_conn()
    except Exception as e:
        print(f"SCHEMA_CHECK: SKIP (DB connect failed: {e})")
        return 0

    try:
        actual = get_db_vector_dim(conn)
        conn.close()
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        print(f"SCHEMA_CHECK: ERROR failed to read DB schema: {e}")
        return 1

    if actual is None:
        print("SCHEMA_CHECK: SKIP (no chunks table or VECTOR column not detected)")
        return 0

    if int(actual) != int(desired):
        print(
            "SCHEMA_CHECK: FAIL - DB VECTOR size does not match configured/derived EMBED_DIM\n"
            f"  DB VECTOR size: {actual}\n  Derived EMBED_DIM: {desired}\n  Model: {model_id}\n"
            f"  Migration: ALTER TABLE chunks MODIFY COLUMN embedding VECTOR({desired}) NOT NULL;"
        )
        return 1

    print(f"SCHEMA_CHECK: OK - DB VECTOR({actual}) matches EMBED_DIM={desired} (model={model_id})")
    return 0


if __name__ == "__main__":
    sys.exit(main())


