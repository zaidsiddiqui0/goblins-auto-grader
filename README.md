# Goblins Auto-Grader

A small, deployable auto-grader for K-12 assignments. A teacher locks a rubric before students submit; an asynchronous worker grades typed answers or photos and returns scores and feedback.

## Flow

1. A teacher pastes questions and answer keys, or uploads a worksheet PDF.
2. The server generates a draft rubric from assignment content only.
3. The teacher edits and approves the rubric, locking that version.
4. Students use an access code to submit typed answers and/or files.
5. The worker transcribes and grades against the approved rubric; code validates awards and computes totals.
6. Students see their result, and teachers inspect, retry, or override grades.

## Architecture

```text
React SPA ──HTTP──> Hono API ──> SQLite (data + durable jobs)
                        │               │
                        │               └──> in-process worker
                        │                     ├── typed/PDF reader
                        │                     └── vision reader + grader
                        └──> local uploads (/data/uploads)
```

**Bias prevention:** rubric generation receives only questions and teacher answer keys—never submissions, student names, or student work. Uploaded content is delimited and treated as data, not instructions.

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
| `READER_MODEL` | `anthropic/claude-haiku-5.5` | Photo-transcription model |
| `GRADER_MODEL` | `anthropic/claude-haiku-5.5` | Grading model |
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

## Deploy to Fly.io

**Not yet deployed.**

```sh
fly launch --no-deploy
fly volumes create goblins_data --size 1
printf '\n[mounts]\n  source = "goblins_data"\n  destination = "/data"\n' >> fly.toml
fly secrets set LLM_MODE=real OPENROUTER_API_KEY='your-key' LLM_BUDGET_USD=2
fly deploy
```

## Load test

The harness uses the real HTTP API, creates and approves an assignment, sends seeded typed submissions and idempotency replays, polls to terminal states, and verifies the teacher's submission list.

```sh
npm run loadtest -- --n 5
npm run loadtest -- --n 30 --concurrency 10
npm run loadtest -- --n 300 --concurrency 50 --burst-ms 1000
npm run loadtest -- --n 30 --max-p95-s 60
# Only against an explicitly real-mode server; capped at 10 submissions:
npm run loadtest -- --real --n 3 --max-p95-s 60
```

JSON results include latency percentiles, throughput, queue peaks, retries, integrity checks, and LLM cost delta. See [measured results](docs/LOADTEST.md).

A real-model smoke run on Haiku 5.5 measured rubric generation at 11s/$0.0012, photo reading at 2.6s/$0.0003, and grading at about 4.4s/$0.0007: about $0.001 per graded photo submission. Handwriting was read correctly.

## More documentation

- [Decisions](DECISIONS.md)
- [Implementation plan and risks](docs/PLAN.md)
- [Load-test methodology and results](docs/LOADTEST.md)
