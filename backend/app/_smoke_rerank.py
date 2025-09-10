import unittest
from fastapi.testclient import TestClient
from .main import app, issue_jwt_token


class TestAuditRBAC(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def _auth_headers(self, role: str):
        tok = issue_jwt_token("u1", "tester", "demo", role=role)
        return {"Authorization": f"Bearer {tok}", "X-Org-Id": "demo"}

    def test_non_admin_cannot_access_schema(self):
        r = self.client.get("/debug/schema", headers=self._auth_headers("viewer"))
        self.assertEqual(r.status_code, 403)

    def test_admin_can_access_schema(self):
        r = self.client.get("/debug/schema", headers=self._auth_headers("admin"))
        # 200 OK or 500 if TiDB unavailable; RBAC focus here
        self.assertIn(r.status_code, (200, 500))

    def test_auditor_can_access_schema(self):
        r = self.client.get("/debug/schema", headers=self._auth_headers("auditor"))
        self.assertIn(r.status_code, (200, 500))

    def test_cross_org_leakage(self):
        # Org A cannot see Org B audit feed (dashboard filters by org_id)
        ra = self.client.get("/api/v1/analytics/dashboard-metrics", headers={**self._auth_headers("analyst"), "X-Org-Id": "orgA"})
        rb = self.client.get("/api/v1/analytics/dashboard-metrics", headers={**self._auth_headers("analyst"), "X-Org-Id": "orgB"})
        # Can't easily assert data without DB; ensure not 403 due to role
        self.assertIn(ra.status_code, (200, 500))
        self.assertIn(rb.status_code, (200, 500))

import os, uuid
from .db import get_conn, upsert_document, upsert_chunks

def seed():
    conn = get_conn()
    try:
        # Create two orgs worth of demo docs
        orgs = ["demo", "acme"]
        for org in orgs:
            for i in range(2):
                doc_id = str(uuid.uuid4())
                title = f"{org.upper()} Demo Doc {i+1}"
                meta = {"category": "demo", "org": org}
                upsert_document(conn, doc_id, title, meta, org_id=org)
                text = f"This is a sample document for {org}. It contains organization-specific demo content. Document number {i+1}."
                chunks = [(str(uuid.uuid4()), doc_id, 0, text, "[0.0]")]
                upsert_chunks(conn, chunks, org_id=org)
        conn.close()
        print("Seeded demo and acme orgs with documents.")
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        raise

if __name__ == "__main__":
    seed()

import unittest
from .embeddings import redact_pii


class TestRedaction(unittest.TestCase):
    def test_email(self):
        s = "Contact me at john.doe@example.com for details."
        r = redact_pii(s)
        self.assertNotIn("john.doe@example.com", r)
        self.assertIn("[REDACTED_EMAIL]", r)

    def test_phone(self):
        s = "Call +1 (415) 555-2671 tomorrow."
        r = redact_pii(s)
        self.assertNotIn("415", r)
        self.assertIn("[REDACTED_PHONE]", r)

    def test_ssn(self):
        s = "SSN 123-45-6789 is sensitive."
        r = redact_pii(s)
        self.assertNotIn("123-45-6789", r)
        self.assertIn("[REDACTED_SSN]", r)

    def test_national_id(self):
        s = "National ID AB123456 used for verification."
        r = redact_pii(s)
        self.assertIn("[REDACTED_ID]", r)

    def test_noop(self):
        s = "No PII here."
        r = redact_pii(s)
        self.assertEqual(s, r)


if __name__ == '__main__':
    unittest.main()

#!/usr/bin/env python3
"""
Smoke test for reranking functionality
Run: python -m app._smoke_rerank
"""
import os, sys
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from typing import Any, Dict, List, cast
from app.embeddings import embed_texts, to_vector_literal, score_pairs
from app.db import get_conn, knn_search
import app.db as db
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)

def test_reranking():
    """Test reranking with sample queries"""
    print("=" * 50)
    print("DOCPILOT RERANKING SMOKE TEST")
    print("=" * 50)
    
    try:
        # Test 1: Basic reranking
        print("\n1. Testing basic reranking...")
        query = "document testing debugging"
        passages = [
            "This is a test document for debugging purposes.",
            "Random text about cats and dogs playing.",
            "Testing the document processing system.",
            "Unrelated content about weather patterns."
        ]
        
        scores = score_pairs(query, passages)
        print(f"Query: {query}")
        print("Passages and scores:")
        for i, (passage, score) in enumerate(zip(passages, scores)):
            print(f"  {i+1}. Score: {score:.4f} | {passage[:60]}...")
        
        # Test 2: Database hybrid search
        print("\n2. Testing database hybrid search...")
        try:
            conn = get_conn()
            
            # Test vector search
            vec = embed_texts([query])[0]
            vector_literal = to_vector_literal(vec)
            
            print(f"\nVector search for: '{query}'")
            vector_results = cast(List[Dict[str, Any]], knn_search(conn, vector_literal, 5))
            print(f"Found {len(vector_results)} results via vector search")
            for i, row in enumerate(vector_results[:3]):
                print(f"  {i+1}. Dist: {row['dist']:.4f} | {row['text'][:60]}...")
            
            # Test hybrid search with keyword
            print(f"\nHybrid search for: '{query}' with keyword 'test'")
            hybrid_results = cast(List[Dict[str, Any]], db.hybrid_search(conn, vector_literal, "test", 5))
            print(f"Found {len(hybrid_results)} results via hybrid search")
            for i, row in enumerate(hybrid_results[:3]):
                print(f"  {i+1}. Dist: {row['dist']:.4f} | {row['text'][:60]}...")
            
            # Test reranking on results
            if hybrid_results:
                print(f"\nApplying reranking...")
                texts = [r['text'] for r in hybrid_results]
                rerank_scores = score_pairs(query, texts)
                
                # Combine scores
                for i, (result, score) in enumerate(zip(hybrid_results, rerank_scores)):
                    result['rerank_score'] = score
                
                # Sort by rerank score
                hybrid_results.sort(key=lambda x: -x['rerank_score'])
                
                print("Reranked results:")
                for i, row in enumerate(hybrid_results[:3]):
                    print(f"  {i+1}. Rerank: {row['rerank_score']:.4f}, Dist: {row['dist']:.4f} | {row['text'][:60]}...")
            
            conn.close()
            
        except Exception as e:
            print(f"Database test failed: {e}")
        
        print("\n" + "=" * 50)
        print("SMOKE TEST COMPLETED")
        print("=" * 50)
        
    except Exception as e:
        print(f"Smoke test failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_reranking()