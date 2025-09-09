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