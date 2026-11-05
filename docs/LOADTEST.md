# Load test

## Statement of confidence (deployed, Railway, one container)

- **Ship for classroom-scale spikes.** After poll backoff, 300 students joining at once and working through 3 questions had 900/900 graded, 0 lost, 0 duplicated, 0 stuck, and a per-answer p95 of 7.9s. A real-model run on production had 30/30 graded, p95 1.8s, $0.005.
- **It still breaks at about 1,000 simultaneous students per container.** After poll backoff, only 2589/3000 answers were accepted and HTTP accept p99 was 50.1s; the recorded errors (capped at 20) were all join HTTP 502s. Every accepted answer completed (2589/2589), with 0 lost, duplicated, or stuck. Backoff did not improve the 1,000-student limit in this run: the previous run accepted 2946/3000 with accept p99 27.8s. The client sees each error, so nothing is silent.
- **Re-run any time, for free:** `npm run loadtest -- --base https://loadtest-production-1aeb.up.railway.app --n 300 --concurrency 300 --think-ms 3000 --max-p95-s 10` (a mock-mode twin of production). Exit 0 means ship.


`scripts/loadtest.ts` exercises the production HTTP path. It creates and approves a three-question assignment; every seeded student joins with a name and PIN, then submits each question sequentially and waits for its terminal grade. Think-time between questions defaults to 2000ms with a deterministic ±50% jitter. Bounded student concurrency and optional start staggering model a testing-day window rather than an artificial all-at-once burst. Browsers and the harness share the same score polling: 1.5s initial delay, ×1.5 backoff capped at 5s, and ±20% jitter. Browser polling pauses while the document is hidden; both stop at a terminal status.

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

## Deployed runs (Railway, 2026-11-05; client = M1 Mac over the internet)

| Target | Run | Graded | Lost / dup / stuck | Accept p95 / p99 | Per-answer p50 / p95 / p99 | Peak queue | Cost |
|---|---|---|---|---|---|---|---|
| loadtest (mock, 96 workers) | 30 students × 3 q | 90/90 | 0/0/0 | 0.12s / 0.39s | 2.6s / 3.7s / 3.8s | 0 | $0 |
| loadtest (mock, 96 workers) | 300 students × 3 q, all at once | 900/900 | 0/0/0 | 2.1s / 8.8s | 4.0s / 8.6s / 13.4s | 93 | $0 |
| loadtest (mock, 96 workers) | 1000 students × 3 q, all at once | 2946/3000 accepted, 2946 graded | 0/0/0 | 8.1s / 27.8s | 15.2s / 23.3s / 41.5s | 746 | $0 |
| loadtest (mock, 96 workers) | **After poll backoff:** 300 students × 3 q, all at once | 900/900 | 0/0/0 | 0.302s / 17.9s | 4.1s / 7.9s / 22.2s | 44 | $0 |
| loadtest (mock, 96 workers) | **After poll backoff:** 1000 students × 3 q, all at once | 2589/3000 accepted, 2589 graded | 0/0/0 | 14.2s / 50.1s | 7.4s / 40.7s / 60.1s | 106 | $0 |
| **app (real Haiku 5.5)** | 10 students × 3 q | 30/30 | 0/0/0 | – | 1.4s / 1.8s / 2.1s | 0 | **$0.0048** |

The app is at https://app-production-1a4f.up.railway.app. The mock twin is at https://loadtest-production-1aeb.up.railway.app (same image; `LLM_MODE=mock`, `MOCK_LATENCY_MS=2500`).

**Next fixes, in order:** (1) split the API and the workers into separate services, (2) add HTTP admission control/retry tuning for join bursts, (3) Postgres plus a SKIP LOCKED queue so API replicas can scale horizontally. Poll backoff is deployed and did not raise the 1,000-student ceiling. Those come before the 10k row in the scaling table.
