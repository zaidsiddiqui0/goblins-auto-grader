**Live app:** https://app-production-1a4f.up.railway.app

# Goblins Auto-Grader

A small, deployable auto-grader for K-12 assignments. A teacher locks a rubric before students join; students show their work one question at a time on a whiteboard, by typing, or with a photo.

## Flow

1. A teacher pastes questions and answer keys, or uploads a worksheet PDF.
2. The server generates a draft rubric from assignment content only. The teacher edits and approves it, locking that version.
3. The teacher shares the class code and bookmarks the private teacher link. The link restores the class on another device.
4. Each student joins with the class code, name, and a 4-digit PIN they choose. The same details restore progress on another device.
5. For each question, the student draws on the responsive whiteboard (pen, eraser, undo, clear, three colours), optionally types, or uploads a photo instead.
6. The student submits that question and waits for its score and feedback before continuing. Whiteboard PNGs are capped at 1000px on the long side. Photos and whiteboards use vision; typed-only answers skip the reader model.
7. The worker grades against the pinned one-question rubric slice. Code validates criterion awards and computes scores.
8. The student finishes with a score summary. The teacher gets a per-student question grid and can open, retry, or override any grade.

Approved rubrics are immutable: editing one creates a new draft version, and existing grades keep their original version. Rubric generation never receives student names or work. Uploaded content is delimited and treated as data, not instructions.

## Architecture

```text
React SPA ──HTTP──> Hono API ──> SQLite (data + durable per-question jobs)
                        │               │
                        │               └──> in-process worker
                        │                     ├── typed reader (no model call)
                        │                     └── vision reader + one-question grader
                        └──> local uploads (/data/uploads)
```

## Decisions and deferrals

- Rubrics are approved before student work is read; immutable versions prevent bias and silent regrading.
- Per-question flow, a whiteboard, and PIN rejoin give fast feedback, natural work capture, and cross-device progress.
- Mock mode is the default so deterministic load tests are free and need no provider capacity.
- One Node process, SQLite, and a DB-backed queue minimize operations while retaining durable retries.
- Effect is confined to the model pipeline for typed timeout, retry, and budget handling without app-wide abstraction.
- Haiku was the cheap default from the start; the labeled eval confirmed it: 100% exact match at $0.0041 for 15 answers, with the small tuned-set caveat documented.
- Email auth and LMS sync are deferred to keep scope on grading; PINs and private teacher links cover return access.
- Postgres, SSE, and off-site backups are deferred until scale or recovery needs justify more services; the migration path is documented.

## Local setup

Requires Node 22.13+.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open `http://localhost:5173` (the API runs on port 3000). Mock mode is the default and needs no API key. For production locally:

```sh
npm run build
npm start
```

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `LLM_MODE` | `mock` | `mock` for deterministic free grading; `real` for OpenRouter |
| `OPENROUTER_API_KEY` | empty | Server-side OpenRouter key, required in real mode |
| `RUBRIC_MODEL` | `anthropic/claude-haiku-5.5` | Rubric-generation model |
| `READER_MODEL` | `anthropic/claude-haiku-5.5` | Whiteboard/photo transcription model |
| `GRADER_MODEL` | `anthropic/claude-haiku-5.5` | One-question grading model |
| `LLM_BUDGET_USD` | `2` | Hard runtime model-spend cap |
| `LLM_TIMEOUT_MS` | `45000` | Timeout for each model call |
| `WORKER_CONCURRENCY` | `8` | Maximum concurrent grading jobs |
| `MAX_ATTEMPTS` | `3` | Maximum worker attempts per submission |
| `MOCK_LATENCY_MS` | `300` | Base mock-grader latency |
| `MOCK_FAIL_RATE` | `0` | Mock transient-failure rate from 0 to 1 |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | SQLite database and uploads directory |

## Commands

| Command | Action |
|---|---|
| `npm run dev` | Run API and Vite development servers |
| `npm run build && npm start` | Build and serve the production app |
| `npm test` | Run server tests |
| `npm run typecheck` | Typecheck server, web, shared code, and scripts |
| `npm run loadtest -- --help` | Show load-test options |
| `npm run eval -- --help` | Show accuracy-eval options |

## Load test

The harness uses the real HTTP API. Every simulated student joins, then submits three questions sequentially and waits for each grade. Seeded think-time between questions defaults to 2000ms ±50%; student concurrency creates a realistic testing-day window. It also replays selected `(student, question)` submissions and verifies lost, duplicated, stuck, and missing-score counts.

```sh
npm run loadtest -- --n 5
npm run loadtest -- --n 30 --concurrency 10
npm run loadtest -- --n 300 --concurrency 50 --burst-ms 1000 --think-ms 3000
npm run loadtest -- --n 30 --max-p95-s 60
# Only against an explicitly real-mode server; capped at 10 students:
npm run loadtest -- --real --n 3 --max-p95-s 60
```

JSON reports include per-submission accept/end-to-end latency, aggregate percentiles, throughput, queue peaks, retries, integrity checks, and LLM cost delta.
See [load-test confidence, results, and ship rule](docs/LOADTEST.md); the same page holds the accuracy table and the **Built for setup → at scale** plan.
It covers database, queue, server, uploads, score updates, PIN checks, model calls, backups, and monitoring, with the limit each change removes.

## Accuracy eval

`scripts/eval-set.json` contains three teacher-keyed questions, fixed hand-written rubrics, and 15 human-checked labeled typed answers (correct, partial, wrong, and alternative methods). The evaluator calls the real grader directly—no rubric generation or HTTP—and compares models on exact-match rate, mean absolute error, cost, and p50 latency.

```sh
LLM_MODE=real npm run eval -- \
  --model anthropic/claude-haiku-5.5 \
  --model another/openrouter-model
```

It refuses to run unless `LLM_MODE=real` and writes detailed JSON to `loadtest-results/`. Latest results are in docs/LOADTEST.md.

## Deploy (Railway)

**Live:** https://app-production-1a4f.up.railway.app (real model, `LLM_BUDGET_USD=3` guard). The load-test twin is https://loadtest-production-1aeb.up.railway.app (mock).

```sh
npx -y @railway/cli login
npx -y @railway/cli init -n goblins-auto-grader
npx -y @railway/cli add --service app
npx -y @railway/cli volume add -m /data
npx -y @railway/cli variables -s app --set LLM_MODE=real --set DATA_DIR=/data --set WORKER_CONCURRENCY=48
printf %s "$OPENROUTER_API_KEY" | npx -y @railway/cli variables -s app --set-from-stdin OPENROUTER_API_KEY
npx -y @railway/cli up -s app && npx -y @railway/cli domain -s app
```

## More documentation

- [HTTP API](docs/API.md)
- [Decisions](DECISIONS.md)
- [Implementation plan and risks](docs/PLAN.md)
- [Load-test methodology and results](docs/LOADTEST.md)
