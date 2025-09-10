import os, numpy as np, logging, re, hashlib
from sentence_transformers import SentenceTransformer, CrossEncoder
from typing import List, Sequence

_model = None
_reranker = None
_rerank_enabled_env = os.getenv("RERANK_ENABLED", "true").lower() in ("1", "true", "yes")
_warned_rerank_disabled = False

# Known model dimension map (extendable)
_MODEL_DIM_MAP = {
    # BGE
    "BAAI/bge-base-en": 768,
    "bge-base-en": 768,
    "BAAI/bge-large-en": 1024,
    "bge-large-en": 1024,
    # MiniLM-based (typical 384)
    "sentence-transformers/all-MiniLM-L6-v2": 384,
    # OpenAI embeddings (for reference; not used by SentenceTransformer)
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
}

def get_embed_model_id() -> str | None:
    mid = os.getenv("EMBED_MODEL_ID") or os.getenv("EMBED_MODEL")
    return mid

def get_embed_dim() -> int:
    # 1) Explicit override
    env_dim = os.getenv("EMBED_DIM")
    if env_dim:
        try:
            return int(env_dim)
        except Exception:
            pass
    # 2) Derive from model id
    mid = get_embed_model_id() or ""
    if mid:
        # exact match or by tail key
        if mid in _MODEL_DIM_MAP:
            return _MODEL_DIM_MAP[mid]
        tail = mid.split("/")[-1]
        if tail in _MODEL_DIM_MAP:
            return _MODEL_DIM_MAP[tail]
    # 3) Fallback
    return 768

def get_model():
    global _model
    if _model is None:
        name = get_embed_model_id() or os.getenv("EMBED_MODEL","BAAI/bge-base-en")
        _model = SentenceTransformer(name)
    return _model

def _deterministic_embed_text(text: str, dim: int | None = None) -> np.ndarray:
    """Offline fallback: deterministic, normalized vector per text (no model).

    Uses SHA-256 of the text to seed a RNG and generate a stable vector.
    """
    if dim is None:
        dim = get_embed_dim()
    digest = hashlib.sha256((text or "").encode("utf-8")).digest()
    # Use first 8 bytes for seed; PCG64 expects 64-bit seed
    seed = int.from_bytes(digest[:8], byteorder="little", signed=False)
    rng = np.random.default_rng(seed)
    vec = rng.standard_normal(dim).astype(np.float32)
    # L2 normalize
    norm = np.linalg.norm(vec) or 1.0
    vec = vec / norm
    return vec

def embed_texts(texts: Sequence[str]):
    # Allow forcing offline fallback via env
    force_offline = os.getenv("OFFLINE_EMBED_FALLBACK", "false").lower() in ("1", "true", "yes")
    if not force_offline:
        try:
            m = get_model()
            v = np.asarray(m.encode(list(texts), normalize_embeddings=True, convert_to_numpy=True))
            target = get_embed_dim()
            # Adjust dimensions if model output differs from target
            if v.ndim == 1:
                cur = v.shape[0]
                if cur == target:
                    return v
                elif cur > target:
                    return v[:target]
                else:
                    pad = np.zeros((target - cur,), dtype=v.dtype)
                    return np.concatenate([v, pad], axis=0)
            else:
                cur = v.shape[1]
                if cur == target:
                    return v
                elif cur > target:
                    return v[:, :target]
                else:
                    pad = np.zeros((v.shape[0], target - cur), dtype=v.dtype)
                    return np.concatenate([v, pad], axis=1)
        except Exception as e:
            logger = logging.getLogger("docpilot.embeddings")
            logger.warning(f"Primary embed model failed, using offline fallback: {e}")
    # Fallback path
    dim = get_embed_dim()
    arr = np.stack([_deterministic_embed_text(t, dim=dim) for t in texts], axis=0)
    return arr

def to_vector_literal(vec):
    # Convert numpy vector to TiDB VECTOR literal string
    vec_array = np.array(vec).astype(np.float32)
    arr = ",".join([f"{float(x):.8f}" for x in vec_array.tolist()])
    return f"[{arr}]"

def get_reranker():
    """Get cross-encoder reranker model if enabled; otherwise None."""
    global _reranker, _warned_rerank_disabled
    if not _rerank_enabled_env:
        if not _warned_rerank_disabled:
            logging.getLogger("docpilot.embeddings").info("Reranker OFF (RERANK_ENABLED=false); using neutral scores.")
            _warned_rerank_disabled = True
        return None
    if _reranker is None:
        try:
            # Model id from env with compatibility alias
            reranker_name = os.getenv("RERANK_MODEL_ID") or os.getenv("RERANK_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2")
            if "bge-reranker" in (reranker_name or ""):
                reranker_name = "BAAI/bge-reranker-large"
            logger = logging.getLogger("docpilot.embeddings")
            logger.info(f"Loading reranker model: {reranker_name}")
            _reranker = CrossEncoder(reranker_name)
            logger.info(f"Successfully loaded reranker model: {reranker_name}")
        except Exception as e:
            logger = logging.getLogger("docpilot.embeddings")
            logger.warning(f"Failed to load reranker model: {e}. Reranking will be disabled.")
            _reranker = None
    return _reranker

def score_pairs(query: str, passages: List[str]) -> List[float]:
    """Score query-passage pairs using cross-encoder reranker"""
    logger = logging.getLogger("docpilot.embeddings")
    reranker = get_reranker()
    if reranker is None:
        # Fallback: return neutral scores without repeated warnings
        return [0.0] * len(passages)
    
    try:
        logger.debug(f"Reranking {len(passages)} passages")
        pairs: List[List[str]] = [[query, passage] for passage in passages]
        scores = reranker.predict(pairs)
        # Normalize to a list of floats for typing consistency
        scores_array = np.asarray(scores, dtype=np.float32).reshape(-1)
        result = [float(x) for x in scores_array.tolist()]
        logger.debug(f"Reranking completed, score range: {min(result):.3f} to {max(result):.3f}")
        return result
    except Exception as e:
        logger.error(f"Reranking failed: {e}")
        return [0.0] * len(passages)

# --- Simple DLP redaction helpers ---
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE_RE = re.compile(r"\b(?:\+\d{1,3}[ -]?)?(?:\(?\d{3}\)?[ -]?\d{3}[ -]?\d{4})\b")
_SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
# Basic national ID patterns (extend as needed)
_NATIONAL_ID_RE = re.compile(r"\b(?:[A-Z]{2}\d{6}|[A-Z]{1}\d{7}|\d{9})\b")
_TCKN_RE = re.compile(r"\b[1-9]\d{10}\b")  # TR national ID (approximate: 11 digits, no leading zero)
_TR_IBAN_RE = re.compile(r"\bTR\s?\d{2}(?:\s?\d){22}\b", re.IGNORECASE)  # TR IBAN (approx length check, allow spaces)

def redact_pii(text: str) -> str:
    if not text:
        return text
    t = _EMAIL_RE.sub("[REDACTED_EMAIL]", text)
    t = _PHONE_RE.sub("[REDACTED_PHONE]", t)
    t = _SSN_RE.sub("[REDACTED_SSN]", t)
    t = _NATIONAL_ID_RE.sub("[REDACTED_ID]", t)
    t = _TCKN_RE.sub("[REDACTED_TCKN]", t)
    t = _TR_IBAN_RE.sub("[REDACTED_TR_IBAN]", t)
    return t
