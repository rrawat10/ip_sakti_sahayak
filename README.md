# IP-SAKTI Sahayak

An English/Hindi Ayurveda IP and regulatory research assistant. The frontend defaults to an explicitly labeled demo; live answers require a configured backend and reviewed corpus.

## Run the frontend

From the project root in PowerShell:

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Open the local URL printed by Vite. `npm run dev` works too when PowerShell permits npm's script. MongoDB is not required for frontend demo mode.

## Run the backend

From the project root:

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -e "./backend[test,evaluation]"
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Use `.env.example` as a configuration reference; keep credentials in the ignored root `.env`. Do not overwrite an existing `.env`. Set `VITE_DEMO_MODE=false` in `frontend/.env.local` and restart Vite when the backend and MongoDB are ready. The development proxy forwards `/api` to port 8000.

LangSmith tracing is opt-in, with inputs and outputs hidden by default. Live accounts, Atlas search, Gemini, embeddings and trace delivery have been checked; see [current readiness](docs/readiness.md). The initial active corpus is a small engineering-reviewed WIPO PCT source. Broader Ayurveda coverage and release acceptance remain separate. Landing-page benchmarks show only published evaluation results.

## Checks

```powershell
.venv\Scripts\python.exe -m pytest backend/tests -q
cd frontend
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

Playwright needs its browser installed (`npx.cmd playwright install chromium`) before the first browser test.

See [hackathon deliverables](docs/hackathon-delivery.md) for the presentation, evaluation, limitations, rehearsal, and later public deployment commitments.

## Engineering guides

- [Credentials and where to get them](docs/credentials.md)
- [Answer judging, confidence and benchmark presentation](docs/answer-review.md)
- [Backend and release readiness](docs/readiness.md)
- [Architecture and contracts](docs/architecture.md)
- [Source ingestion and updates](docs/ingestion.md)
- [Evaluation and baseline comparison](evaluation/README.md)
- [Public deployment preparation](docs/deployment.md)
- [Presentation and rehearsal](docs/demo-presentation.md)

Run all credential-free checks with `powershell -ExecutionPolicy Bypass -File scripts/check.ps1 -Browser`. The API browser suite uses an isolated test server and controlled provider outputs, with demo interception disabled. It does not call Atlas or Gemini. Python dependency versions tested on this Windows/Python 3.13 environment are recorded in `backend/requirements-dev.lock`; the minimal deployment installs only core backend dependencies.
