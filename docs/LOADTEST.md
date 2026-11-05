# Load test

`scripts/loadtest.ts` exercises the production HTTP path. It creates and approves a three-question assignment; every seeded student joins with a name and PIN, then submits each question sequentially and waits for its terminal grade. Think-time between questions defaults to 2000ms with a deterministic ±50% jitter. Bounded student concurrency and optional start staggering model a testing-day window rather than an artificial all-at-once burst.

The harness replays question 1 for a seeded subset of students. The natural `(student_id, question_id)` key must return the same submission. It samples `/api/metrics` every 500ms and uses the teacher report for authoritative lost, duplicated, nonterminal, and unscored checks. The JSON report includes every submission's accept and terminal latency as well as aggregate percentiles.

## Usage

```sh
npm run loadtest -- --n 5
npm run loadtest -- --n 30 --concurrency 10
npm run loadtest -- --n 300 --concurrency 50 --burst-ms 1000 --think-ms 3000
npm run loadtest -- --n 30 --max-p95-s 60
```

Use `--think-ms 0` only for pipeline saturation tests; the default is more representative of a class. Use `--out PATH` for the JSON directory. Real-model runs require both `--real` and a server reporting `mode=real`, and are capped at 10 students (30 question grades). A nonzero exit indicates missing accepted work, lost, duplicated, stuck, mismatched, or unscored work, HTTP/client errors, or an end-to-end p95 above the optional threshold.

## Current mock smoke result

Measured on 2026-11-05 at git `fe68a494d3a5`, on the local checkout with Node 22, fresh SQLite storage, `LLM_MODE=mock`, `WORKER_CONCURRENCY=8`, `MOCK_LATENCY_MS=300`, and `MOCK_FAIL_RATE=0`. The exact required command was run against port 3105: `npm run loadtest -- --base http://localhost:3105 --n 30`.

| Students | Questions | Accepted | Completed | Failed | Stuck | Lost | Duplicated | Dup replays / mismatches | Throughput/s | Accept p50 / p95 / p99 | E2E p50 / p95 / p99 | Peak in-flight / queue | Cost |
|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|---|---|---:|
| 30 | 90 | 90 | 90 | 0 | 0 | 0 | 0 | 3 / 0 | 4.969 | 5 / 67 / 320ms | 509 / 604 / 827ms | 8 / 1 | $0 |

All integrity checks passed. Throughput includes student think-time; per-submission E2E latency does not. Queue peaks are 500ms samples and can miss shorter activity. This is a local mock smoke result, not a real-model or hosted benchmark. Earlier whole-assignment results in git history used a different workload and are not comparable.

## Scaling path (plan, not measured)

| Students | Change |
|---|---|
| 1k | Current design. Raise worker concurrency after measuring provider rate limits. Back up SQLite with a volume plus Litestream. |
| 10k | Postgres with `FOR UPDATE SKIP LOCKED` job claims. Put uploads in object storage. Separate API and worker processes. Alert on queue age, failure rate, and spend. |
| 100k | Horizontal workers behind a managed queue with DLQ. Add provider-aware rate limiting and a CDN for uploads. |
| 1M | Partition by school or district, use multi-provider failover, and choose cheap text/vision routing from the labeled accuracy eval. |

## v2: per-question flow with a testing-day spike (current API)

300 students join at once. Each works through 3 questions, with seeded think-time of 3s ±50% between questions. Mock grader latency is set to 2.5s (worse than real Haiku's p50 of 2.2s for one question). 10% of answers are resubmitted as duplicates. Local M1, fresh SQLite, seed 7.

| Workers | Graded | Lost / dup / stuck | Throughput | Time per answer p50 / p95 / p99 | Peak queue |
|---|---|---|---|---|---|
| 16 | 900/900 | 0 / 0 / 0 | 6.4/s | 41.4s / 43.4s / 43.9s | 270 |
| 96 | 900/900 | 0 / 0 / 0 | 27.6/s | 4.1s / 6.5s / 10.1s | 90 |

**Where it slows down:** worker slots. Each slot holds one model call, so throughput ≈ slots ÷ latency. With too few slots, the queue grows and students wait about 40s per score. It never broke: nothing was lost, duplicated, or stuck. The first harness version dropped students on transient client `fetch` errors. The harness now retries them like a real browser would (3–4 retries per run) and counts them.

**Ship/no-ship rule:** ship if `npm run loadtest` exits 0 and the per-answer p95 ≤ 10s at the expected class burst, using `--max-p95-s 10`.

## Accuracy eval (real models, `scripts/eval.ts`, 15 labeled typed answers)

| Model | Exact match | MAE (pts) | Cost per 15 | p50 |
|---|---|---|---|---|
| anthropic/claude-haiku-5.5 (default) | 93.3% | 0.07 | $0.0043 | 2.2s |
| google/gemini-2.5-flash-lite | 80.0% | 0.20 | $0.0016 | 0.8s |
| openai/gpt-5-mini | 86.7% | 0.13 | $0.0248 | 7.8s |

Caveat: the labels were written by the coding agent and haven't been checked by a teacher, and n=15. Treat this as a smoke test of accuracy, not proof.
