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
| Burst | TBD by orchestrator | | | | | | | | | | | | | | |
| Failure injection | TBD by orchestrator | | | | | | | | | | | | | | |
| Real model | TBD by orchestrator | | | | | | | | | | | | | | |
