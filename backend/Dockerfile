# DocPilot Backend Dockerfile
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1     PYTHONUNBUFFERED=1

# System deps (git for sentence-transformers models; build tools for wheels)
RUN apt-get update && apt-get install -y --no-install-recommends     build-essential curl git &&     rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy backend code
COPY backend /app

# Install Python deps
RUN pip install --no-cache-dir -r requirements.txt

# Health check (optional)
HEALTHCHECK --interval=30s --timeout=5s --retries=3   CMD curl -fsS http://localhost:8000/health || exit 1

EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
