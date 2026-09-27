FROM node:22-alpine AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
RUN npm ci
COPY frontend/ ./
COPY corpus/ /build/corpus/
ENV VITE_DEMO_MODE=false
RUN npm run build && rm -f dist/mockServiceWorker.js

FROM python:3.13-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY backend/ ./backend/
RUN pip install --no-cache-dir -e ./backend
COPY corpus/ ./corpus/
COPY --from=frontend /build/frontend/dist ./frontend/dist/
RUN useradd --create-home sakti && mkdir -p /app/data && chown sakti:sakti /app/data
USER sakti
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health/live', timeout=3)"
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
