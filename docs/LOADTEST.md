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
