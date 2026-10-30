# Implementation plan

## What exists
Nothing. The repo was empty (no commits) and there is no Goblins code, API, schema, or deploy config to reuse. Every "existing Goblins capability" (worksheet library, handwriting API, model gateway, whiteboard) is **unknown**. Each one sits behind a small adapter with a local implementation. Questions for the CTO are below.

## Smallest slice worth shipping
A teacher pastes questions or uploads a PDF → fixes the extracted questions → generates a rubric → edits it → approves it (v1, locked) → shares a 6-char code. A student opens `/s/CODE`, enters a name, types answers and/or uploads photos, and submits. A background worker reads the work, grades it against v1, validates the result, and persists it. The student sees their own grade and feedback. The teacher sees a live class table and can inspect, retry, or override any submission. A load test hits the real HTTP path in mock mode.

## Stack (chosen; nothing to inherit)
- **One Node 22 process**: Hono API + in-process DB-backed worker + Vite/React SPA served as static files. No microservices.
- **SQLite** (`node:sqlite`, WAL mode). It's durable, has zero ops cost, and is enough for one node. The jobs table *is* the queue. Postgres/Redis is the documented next step, not built now.
- **zod** for runtime validation. **Effect** only for the model-call/grading pipeline (timeouts, retry schedule, typed errors, bounded concurrency), where it pays for itself.
- **unpdf** for PDF text. Vision model only for photos of student work.
- Uploads go to local disk (`DATA_DIR/uploads`).
- Deploy: local first (`npm run build && npm start`). Public: one Fly.io/Railway container with a persistent volume (Dockerfile provided).

## Entities
`assignments` 1─* `rubric_versions` (draft|approved, immutable once approved) 1─* `submissions` (pinned to the rubric version current at submit time) 1─0..1 `grades` (UNIQUE submission_id ⇒ retries can't duplicate). There is also an `llm_usage` table for the cost ledger and budget guard.

## Grading flow
1. `POST submission` checks the idempotency key (`UNIQUE(assignment_id, idempotency_key)`), saves the files, inserts a row with `status=queued`, and returns 202.
2. The worker loop claims jobs atomically (`UPDATE … RETURNING`), with a lease and `WORKER_CONCURRENCY` slots.
3. **Reader**: typed answers pass through without a model call. Photos go through one vision call that returns a `Transcription` with per-question `uncertain` flags. PDFs go through unpdf text, or fail clearly if scanned.
4. **Grader**: one text call with (approved rubric + this student's transcription only) → `GraderOutput` → strict validation. Unknown or missing criteria are rejected. `awarded` is clamped to [0, max] and totals are computed in code.
5. Results are persisted with the model id, rubric version, usage, and timestamps. Transient errors back off and retry (`MAX_ATTEMPTS`). After that the submission becomes `failed` with a reason, and the teacher can retry it. Expired leases are requeued on boot and periodically, so no job gets stuck.
6. A rubric edit after approval creates v2. Old grades keep v1. Nothing is silently regraded.

## Model config and budget
- Haiku 5.5 is the default for all three stages ($0.10/$0.50 per M tokens, vision). Each stage's model is configurable.
- `LLM_MODE=mock` is the default and gives deterministic fakes with configurable latency and failure injection.
- `LLM_BUDGET_USD` is a hard guard checked against the summed `usage.cost` that OpenRouter returns. Over the cap, real calls refuse to run.
- Estimated cost: about $0.001 per graded photo submission, so 100 real grades is roughly $0.10. Runtime spend is negligible. **The real cost is the coding agents** (Kimi K3.1 Pro $2/$10 per M, Opus $4/$20 per M), so agent sessions are few and tightly scoped.

## Load test (cheapest reliable)
`scripts/loadtest.ts` (no new deps) runs against any base URL. It sets up an assignment and approves its rubric over HTTP, then fires seeded bursts of typed-answer submissions. About 10% are duplicate replays with the same idempotency key. It polls every submission until it reaches a terminal state or times out. It reports offered/accepted, completed/failed/stuck, duplicates, p50/p95/p99 end-to-end latency, throughput, peak in-flight and queue depth (from `/api/metrics`), and cost. Output is JSON plus a one-screen summary. It exits non-zero if anything is lost, duplicated, or stuck.
Steps: smoke (5) → class (30) → burst (300 at 50 concurrent) → mock with `MOCK_FAIL_RATE=0.2` to prove retries → real-model run capped at 10 submissions (`--real --max 10`).

## Risks (ranked)
1. **Vision transcription of handwriting is the weakest link.** Mitigations: uncertainty flags, teacher inspection and override, and a typed-answer path.
2. **Model JSON validity.** Mitigations: strict zod validation, retry on invalid output, and code-side scoring.
3. **Single-node SQLite limits scale.** It's fine for a classroom demo (writes are tiny), and the scaling path is documented.
4. **Agent budget overrun.** Mitigations: three scoped Kimi sessions, and spend is checked between steps.
5. **Unknown Goblins APIs.** The adapters make swapping cheap.

## Ordered checklist
1. Scaffold, contracts (`shared/schema.ts`, `docs/API.md`), and context docs. *(me)*
2. Backend: DB, routes, worker, mock and real adapters, budget guard, and unit tests. *(Kimi A)*
3. Frontend: teacher wizard, rubric editor, dashboard, and student page. *(Kimi B, in parallel against the contract)*
4. Integration check, then a real-model smoke run on 3 submissions. *(me)*
5. Load-test harness, Dockerfile, README, and results write-up. *(Kimi C)*
6. Run the load tests, check the diff, and write the final handoff. *(me)*

## Questions for the Goblins CTO (non-blocking; defaults in brackets)
**P0**
1. Is this meant to be built from scratch, or should it integrate with real Goblins APIs? If the latter, can you share access or docs? [from scratch, with adapters]
2. Is there a handwriting/whiteboard → text API? What are its endpoint, schema, auth, and latency? [Haiku vision via OpenRouter]
3. Is there a worksheet library API or data model? [PDF upload or paste]
4. Is there an existing model gateway, approved models, or org rate limits? [OpenRouter, Haiku 5.5]
5. Do you have a preferred host or DB (e.g. Postgres/Neon, Fly, Vercel)? [SQLite + one container]
**P1**
6. Can you share sample worksheets and anonymized student work for evaluation? [synthetic]
7. What subjects and grade levels come first? [K-8 math]
8. Should grades go to students immediately, or after teacher release? [immediately, with a "needs teacher review" label]
9. What class sizes and burst patterns should we expect? What latency target? [30/class, 300-submission burst, p95 < 60s real]
10. Are there student-data retention or privacy rules (FERPA/COPPA)? [names only, no PII beyond that]
11. Is the $20 budget for runtime grading only, or does it also cover coding-agent usage? [treated as total]
