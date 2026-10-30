# Load test

`scripts/loadtest.ts` exercises the production HTTP path with seeded typed-answer submissions. It creates and approves a three-question assignment, bounds submission concurrency, replays a deterministic number of idempotency keys, samples `/api/metrics` every 500ms, and polls with student tokens until terminal or timeout. Teacher-side verification checks for lost, duplicated, nonterminal, and unscored submissions.

## Usage

```sh
npm run loadtest -- --n 5
npm run loadtest -- --n 30 --concurrency 10
npm run loadtest -- --n 300 --concurrency 50 --burst-ms 1000
npm run loadtest -- --n 30 --max-p95-s 60
```

Use `--out PATH` for the JSON result directory. Real-model runs require both `--real` and a server reporting `mode=real`, and are capped at 10 submissions. A nonzero exit indicates lost, duplicated, stuck, mismatched, or unscored work, or an end-to-end p95 above the optional threshold.

## Environment

Measured on 2026-10-30 at git `2b2e8ae2bf9df63116c33faf4fc56f4cc1af7d8c`: Apple M1, 8GB RAM, Darwin arm64, Node 22.19.0. The production Vite build was served by `node --import tsx server/index.ts` on port 3100 with fresh temporary SQLite storage, `LLM_MODE=mock`, `WORKER_CONCURRENCY=8`, `MOCK_LATENCY_MS=300`, and `MOCK_FAIL_RATE=0`. Both runs used seed 42, duplicate rate 0.1, no burst delay, and a 120s timeout. These are local mock measurements, not real-model or hosted benchmarks; queue peaks are based on 500ms samples and can miss shorter activity.

## Results

Both required runs passed all integrity checks, including completed-row scores. Latency percentiles are milliseconds; throughput is completed submissions per second from the first submit to the last observed terminal state.

| Run | Offered | Accepted | Completed | Failed | Stuck | Lost | Duplicated | Dup replays / mismatches | HTTP 429 | Client / server retries | Throughput/s | Accept p50 / p95 / p99 (ms) | E2E p50 / p95 / p99 (ms) | Peak in-flight / queue | LLM cost delta |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---:|
| Mock smoke (`--n 5`) | 5 | 5 | 5 | 0 | 0 | 0 | 0 | 0 / 0 | 0 | 0 / 0 | 9.597 | 8 / 8 / 8 | 268 / 520 / 520 | 0 / 0 | $0.000000 |
| Mock class (`--n 30 --concurrency 10`) | 30 | 30 | 30 | 0 | 0 | 0 | 0 | 3 / 0 | 0 | 0 / 0 | 23.112 | 7 / 14 / 14 | 765 / 1271 / 1272 | 8 / 10 | $0.000000 |
| Burst (`--n 300 --concurrency 50`, seed 1) | 300 | 300 | 300 | 0 | 0 | 0 | 0 | 30 / 0 | 0 | 0 / 0 | 25.99 | 18 / 44 / 56 | 5579 / 10609 / 11108 | 8 / 283 | $0 |
| Failure injection (`MOCK_FAIL_RATE=0.2`, n=100 c=25, seed 2) | 100 | 100 | 99 | 1 | 0 | 0 | 0 | 10 / 0 | 0 | 0 / 25 | 14.30 | 9 / 58 / 79 | 2797 / 4855 / 5827 | 8 / 82 | $0 |
| Scale (`WORKER_CONCURRENCY=64`, n=1000 c=100, seed 3) | 1000 | 1000 | 1000 | 0 | 0 | 0 | 0 | 100 / 0 | 0 | 0 / 0 | 193.3 | 32 / 84 / 339 | 2342 / 4073 / 4515 | 64 / 788 | $0 |
| Crash recovery (`kill -9` at t=4s, restart at t=7s; n=200 c=50, seed 4) | 200 | 200 | 200 | 0 | 0 | 0 | 0 | 20 / 0 | 0 | 0 / 8 | – | – | 7443 / 10658 / 10941 | – | $0 |
| **Real model** (Haiku 5.5, `--real --n 10`, seed 5) | 10 | 10 | 10 | 0 | 0 | 0 | 0 | 1 / 0 | 0 | 0 / 0 | 2.30 | 29 / 44 / 44 | 2554 / 4343 / 4343 | 8 / 2 | **$0.003774** |

Burst, failure injection, scale, crash and real runs were measured by the orchestrator at git `8243d92` (plus the boot-requeue fix) on the same machine with fresh SQLite storage on port 3102.

## Findings

- **Correctness held in every run.** 0 lost, 0 duplicated grades, 0 idempotency mismatches. Every accepted submission reached `completed` or `failed`.
- **Retries work.** At a 20% transient failure rate, there were 25 server retries and 1 submission `failed` visibly after `MAX_ATTEMPTS=3`. That's consistent with 0.2³ ≈ 0.8%. A teacher can retry it.
- **Crash-safe.** The first crash test **found a bug**: 8 jobs that were in `processing` at `kill -9` stayed stuck until their 90s lease expired. The fix: on boot, a single-process server requeues every `processing` row. A rerun gave 200/200 completed and 8 requeued.
- **Throughput = worker slots ÷ model latency.** Mock 300ms × 8 slots ≈ 26/s, and 64 slots ≈ 193/s. SQLite and HTTP weren't the bottleneck at 1,000 submissions; accept p99 was 339ms and RSS about 210MB.
- **Real model:** about 4.4s to grade, $0.0004 per typed submission and about $0.001 per photo (vision read plus grade, measured separately). 0 invalid outputs in 10. Rubric generation takes about 11s and costs $0.001.

## What this supports

On one laptop-class node with real Haiku latency (about 4.5s) and 8 workers, the system grades about 1.8 submissions/s, or about 100/min. A 30-student class burst drains in about 20s, and a 300-submission burst in about 3 min. Raising `WORKER_CONCURRENCY` scales this linearly until OpenRouter rate limits apply, which weren't measured because of cost. Only 10 real calls were run, so real-model quality claims are limited to that sample.

## Scaling path (plan, not measured)

| Students | Change |
|---|---|
| 1k | Current design. Raise `WORKER_CONCURRENCY` to about 32. Add 429-aware adaptive concurrency. Back up SQLite with a volume plus Litestream. |
| 10k | Postgres (Neon or RDS) with `FOR UPDATE SKIP LOCKED` job claims. Put uploads in object storage (S3/R2). Separate API and worker processes. Add metrics and alerts (queue age, failure rate, spend). |
| 100k | Horizontal workers behind a managed queue (SQS or Cloud Tasks) with DLQ. Use a per-school provider key pool and rate limiter. Use a CDN for uploads. Use the batch API for non-urgent regrades. |
| 1M | Partition by school or district. Use multi-provider failover. Measure model routing (cheap text grader for typed answers, vision only when needed) against a labeled eval set. |
