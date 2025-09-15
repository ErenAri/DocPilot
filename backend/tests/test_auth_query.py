import os
import json
import types
from fastapi.testclient import TestClient


def setup_app_monkeypatch(monkeypatch):
    # Import after setting patches/env to avoid side effects using real DB
    from backend.app import main as app_mod

    # Dummy connection object with close()
    class DummyConn:
        def close(self):
            pass

    # Stub DB and embedding/search functions to avoid external deps
    monkeypatch.setattr(app_mod, "get_conn", lambda: DummyConn())
    monkeypatch.setattr(app_mod, "create_session", lambda conn, user_id: None)
    monkeypatch.setattr(app_mod, "get_user_by_credentials", lambda conn, u, p: {"id": "u123456", "username": u})
    monkeypatch.setattr(app_mod, "insert_audit", lambda conn, row: None)
    monkeypatch.setattr(app_mod, "insert_eval_log", lambda conn, row: None)
    monkeypatch.setattr(app_mod, "insert_analytics_event", lambda conn, row: None)
    monkeypatch.setattr(app_mod, "embed_texts", lambda texts: [[0.0, 0.0, 0.0]])
    monkeypatch.setattr(app_mod, "to_vector_literal", lambda vec: "[]")
    monkeypatch.setattr(app_mod, "knn_search", lambda conn, vec, top_k, fc, org=None: [])
    monkeypatch.setattr(app_mod, "hybrid_search", lambda conn, vec, kw, top_k, fc, org=None: [])
    monkeypatch.setattr(app_mod, "hybrid_fusion_search", lambda conn, vec, kw, top_k, fc, org=None: [])

    return app_mod


def test_login_sets_cookie(monkeypatch):
    # Env: production + cross-site to force cookie issuance in cookie mode
    monkeypatch.setenv("BACKEND_ENV", "prod")
    monkeypatch.setenv("CROSS_SITE", "true")
    # Ensure default cookie name is used unless overridden
    monkeypatch.delenv("AUTH_COOKIE_NAME", raising=False)

    app_mod = setup_app_monkeypatch(monkeypatch)
    client = TestClient(app_mod.app)

    resp = client.post("/ap/logn", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 200
    set_cookie = resp.headers.get("set-cookie", "")
    assert "docpilot_auth" in set_cookie  # default AUTH_COOKIE_NAME


def test_query_cookie_flow_with_org_from_jwt(monkeypatch):
    # Require org id, rely on org from JWT claim set at login
    monkeypatch.setenv("BACKEND_ENV", "prod")
    monkeypatch.setenv("REQUIRE_ORG_ID", "true")
    # Cross-site mode shouldn't matter for this test, but keep cookie mode
    monkeypatch.setenv("CROSS_SITE", "true")

    app_mod = setup_app_monkeypatch(monkeypatch)
    client = TestClient(app_mod.app)

    # Login to set cookie
    r1 = client.post("/ap/logn", json={"username": "admin", "password": "admin123"})
    assert r1.status_code == 200
    # Now call a protected route using cookie only (no Authorization header)
    r2 = client.post("/query", json={"query": "test"})
    assert r2.status_code == 200
    # Response model is QueryResp; ensure shape contains passages
    body = r2.json()
    assert isinstance(body, dict)
    assert "passages" in body

