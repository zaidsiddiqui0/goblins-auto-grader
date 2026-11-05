# Load test

## Confidence (Railway, one container)

- **300 students: ship.** After async scrypt, 900/900 answers were graded with 0 lost, duplicated, or stuck; accept p95 was 2.907s and per-answer E2E p95 was 8.284s.
- **1,000 students: improved, not clean.** Async scrypt raised accepted/graded answers from 2589/3000 to 2967/3000 and cut accept p95 from 14.167s to 8.185s; 11 residual join HTTP 502s remained, with 0 lost, duplicated, or stuck among accepted work. All 1,000 joins started in the same second; the next lever is join rate limiting/spreading or more CPU.
- **Real Haiku smoke:** 30/30 graded, 0 lost/duplicated/stuck, E2E p95 1.8s, $0.0048. Mock results do not prove provider capacity.

Re-run: `npm run loadtest -- --base https://loadtest-production-1aeb.up.railway.app --n 300 --concurrency 300 --think-ms 3000 --max-p95-s 10`. **Ship only if it exits 0 and E2E p95 ≤10s at the expected class burst.**

## Deployed runs (2026-11-05; M1 client; times in seconds)

| Run | Accepted | Graded | Lost/dup/stuck | Accept p95/p99 | E2E p50/p95/p99 | Cost |
|---|---:|---:|---|---|---|---:|
| 300, before async scrypt | 900 | 900 | 0/0/0 | 0.302/17.932 | 4.050/7.893/22.196 | $0 |
| 1000, before async scrypt | 2589 | 2589 | 0/0/0 | 14.167/50.108 | 7.389/40.745/60.110 | $0 |
| 300, after async scrypt | 900 | 900 | 0/0/0 | 2.907/5.418 | 4.306/8.284/12.574 | $0 |
| 1000, after async scrypt | 2967 | 2967 | 0/0/0 | 8.185/25.312 | 17.425/25.738/42.619 | $0 |
| Real Haiku 5.5, 10 students | 30 | 30 | 0/0/0 | – | 1.4/1.8/2.1 | $0.0048 |

Before/after refers only to async scrypt. Mock runs used 96 workers, 3 questions/student, and 3s think-time; the 1,000-student after run recorded 11 join 502s and 2 client retries.

## Accuracy eval (15 labeled typed answers)

Human-checked labels (2026-11-05) changed q2-b 4→3 and q2-e 2→1; the q2 rubric now requires the rule and cm². Run `LLM_MODE=real npm run eval -- --model M`.

| Model | Exact match | MAE (pts) | Cost per 15 | p50 |
|---|---|---|---|---|
| anthropic/claude-haiku-5.5 (default) | 86.7% | 0.13 | $0.0043 | 2.0s |
| google/gemini-2.5-flash-lite | 86.7% | 0.13 | $0.0017 | 0.9s |
| openai/gpt-5-mini | 93.3% | 0.07 | $0.0268 | 9.2s |

Remaining misses: all three give `2 + 2 = 4` 2/3, not 3/3 (is an equation “reasoning”?), and Haiku gives `2/6 = 1/3` 1 point, not 0. Before the rubric was tightened, Haiku scored 73.3%; it followed a rubric that did not match the labels.
That is the case for teacher review and rubric editing before approval. Caveat: n=15, so one answer is worth 6.7 points; treat this as a smoke test, not proof.

## Built for setup → at scale

| Area | Built for setup | At scale | Limit removed |
|---|---|---|---|
| Database | SQLite on one volume | Postgres with `SKIP LOCKED` claims | Single-writer, single-volume database ceiling |
| Queue | DB table, in-process worker | Separate worker service, then managed queue + DLQ | In-process worker capacity; isolated retries and poison-job handling |
| Server | One Node process | Split API/workers, then replicas behind a load balancer | Single-process CPU and single-node HTTP ceiling |
| Uploads | Local disk | Object storage + CDN | Local disk capacity and app bandwidth |
| Score updates | Polling with backoff | SSE | Poll request volume and update latency |
| PIN check | Async scrypt | Auth service + join rate limits | API CPU saturation, join bursts, and PIN abuse |
| Model calls | One provider, fixed workers | Per-provider rate limits, failover, cheap model per answer type | Provider quotas/outages and unnecessary model cost |
| Backups | Railway volume | Continuous off-site replication / managed Postgres | Single-volume loss and slow recovery |
| Monitoring | `/api/metrics` | Alerts on queue age, failure rate, spend | Silent backlogs, failures, and overspend |
