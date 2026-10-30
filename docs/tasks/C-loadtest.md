# Task C: Load test harness, Dockerfile, README

Read `ai-instructions.md`, `docs/API.md`, `docs/PLAN.md` (Load test section), and skim `server/worker.ts` plus `server/routes.ts`. **Only touch `scripts/`, `Dockerfile`, `.dockerignore`, `README.md`, `docs/LOADTEST.md`, and `ai-instructions.md`.** No new deps. Don't git commit. Be token-efficient.

## scripts/loadtest.ts (Node fetch only)
Flags: `--base http://localhost:3000`, `--n 30`, `--concurrency 10`, `--burst-ms 0` (spread submission starts over this window), `--dup-rate 0.1`, `--seed 42`, `--timeout-s 120`, `--out loadtest-results`, `--real` (refuses unless `--n <= 10` and the server reports mode=real), and `--max-p95-s` (optional threshold).
1. Read `/api/health` and print the mode. Create an assignment over HTTP with 3 fixed math questions that have answer keys, then generate and approve the rubric.
2. Use a seeded PRNG (mulberry32) to generate N students with typed answers (a mix of right and wrong). Submit with bounded concurrency. Duplicates (`dup-rate`) re-POST the same idempotencyKey; expect the same submissionId. Retry network errors and 5xx up to 3× with the same key. Count 429s.
3. While running, sample `/api/metrics` every 500ms to get peak inFlight and queueDepth. Poll each accepted submission with its student token until it's terminal or hits the timeout.
4. Verify via the teacher endpoint at the end: the submission count must equal the number of unique accepted submissions (no duplicates, nothing lost), every row must be terminal, and each completed row has a score.
5. Report the following: offered, accepted, dupReplays, dupMismatches, completed, failed, stuck, lost, duplicated, http429, clientRetries, server retries (from metrics delta), throughput (completed/s from first submit to last terminal), p50/p95/p99 for submit-accept latency and submit-to-terminal latency, peakInFlight, peakQueueDepth, the llm cost delta, and the parameters plus seed plus git sha plus timestamp. Write `<out>/<timestamp>-<mode>-n<N>.json` and print a ≤20-line summary table.
6. Exit 1 if lost>0, duplicated>0, stuck>0, dupMismatches>0, or p95 exceeds the threshold. Otherwise exit 0.

## Dockerfile
Use node:22-slim with `npm ci`, `npm run build`, `ENV NODE_ENV=production DATA_DIR=/data`, `EXPOSE 3000`, `CMD npm start`. Add a `.dockerignore`.

## README.md (concise)
Cover what it is, the flow in 6 bullets, the architecture (a small ASCII diagram plus the bias-prevention rule), local setup, a table of env vars (from .env.example), commands (dev, build/start, test, typecheck, loadtest), deploying to Fly.io with a volume at /data (commands only; mark it "not yet deployed" unless it was), the load test usage, and links to DECISIONS.md, docs/PLAN.md, and docs/LOADTEST.md.

## Done when
`npm run typecheck` passes. With the server running in mock mode (`LLM_MODE=mock npm start` after `npm run build`, or `npm run dev:api`), run smoke `--n 5`, then `--n 30 --concurrency 10`. Put the **actual** measured numbers from those runs in `docs/LOADTEST.md` (a template with an Environment and Results table; leave rows for burst/failure-injection/real runs as "TBD by orchestrator"). Stop any server you started, by PID. Update ai-instructions.md, and end with a ≤15-line summary.
