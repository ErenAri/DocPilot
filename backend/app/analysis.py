import os
from typing import Dict, Any, List
from .answer import get_client

def analyze_text_with_llm(text: str) -> Dict[str, Any]:
    """
    Analyzes text using an LLM to generate a summary and extract keywords.
    """
    if not text or not isinstance(text, str) or len(text.strip()) < 100:
        return {"summary": "Content too short to summarize.", "keywords": []}

    # Truncate text to avoid excessive token usage for very large docs
    max_len = 15000
    truncated_text = text[:max_len]

    client = get_client()
    model = os.getenv("PRIMARY_MODEL", "gpt-4o")
    
    system_prompt = """
    You are an expert document analyst. Your task is to provide a concise summary and extract relevant keywords from the provided text.
    The text is from a business or legal document.
    
    Respond with a JSON object with two keys:
    1. "summary": A brief summary of the document's purpose and key points (2-4 sentences).
    2. "keywords": An array of 5-10 important keywords or phrases.
    """
    user_prompt = f"Please analyze the following document text:\n\n---\n\n{truncated_text}"

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.1,
            max_tokens=500,
            response_format={"type": "json_object"}
        )
        
        content = response.choices[0].message.content
        if content:
            import json
            result = json.loads(content)
            # Basic validation
            if "summary" in result and "keywords" in result and isinstance(result["keywords"], list):
                return result
    except Exception as e:
        # Fallback in case of API error or invalid JSON
        return {"summary": f"Could not analyze text: {e}", "keywords": []}

    return {"summary": "Analysis failed.", "keywords": []}
