import re

def normalize_text(s: str) -> str:
    s = s.replace("\r\n","\n").replace("\r","\n")
    s = re.sub(r"[ \t]+"," ",s)
    s = re.sub(r"\n{3,}","\n\n",s)
    return s.strip()

def make_chunks(text: str, chunk_size: int = 800, overlap: int = 80):
    text = normalize_text(text)
    tokens = text.split()
    res = []
    i = 0
    while i < len(tokens):
        j = min(len(tokens), i + chunk_size)
        chunk = " ".join(tokens[i:j])
        res.append(chunk)
        if j == len(tokens):
            break
        i = max(i + chunk_size - overlap, j)
    return res
