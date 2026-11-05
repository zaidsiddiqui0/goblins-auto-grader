# AI context: Goblins Auto-Grader

Read this first in every new session. Keep it current: update **State** and **History** when you finish a step. This file is the single source of project memory, and `AGENTS.md` points here.

## Goal
This is a take-home for Goblins: a deployable auto-grader. Teachers create an assignment, then a rubric is generated and **approved before any student work is read**. Students submit, an async worker grades the work against the locked rubric version, and teachers see a report. A repeatable load test is part of the deliverable. **Source of truth: the original brief at `docs/takehome.md`** (contact: Alp, alp@goblinsapp.com; share the repo with GitHub user Karavil). `docs/build-prompt.md` is a secondary AI-written elaboration. Plan, risks, and CTO questions: `docs/PLAN.md`. HTTP contract: `docs/API.md`. Data shapes: `shared/schema.ts`.

## Hard rules
1. **No bias leak.** Rubric generation receives assignment questions/answer keys only, never submissions or student names.
2. An approved rubric version is immutable. An edit after approval makes a new draft version, which becomes current on approval. Grades record `rubric_version_id`. Never silently regrade.
3. Scores are computed in code from validated per-criterion awards (clamped to [0, criterion.points]). Never trust model totals or explanations over the validated numbers.
4. All model calls go through server adapters with timeout, bounded retry, zod validation, usage logging, and the `LLM_BUDGET_USD` hard guard. Keys stay server-side and are never logged.
5. `LLM_MODE=mock` is the default for development and load tests. Real-model runs must be small and explicit.
6. Idempotency: `UNIQUE(student_id, question_id)` on per-question submissions and `UNIQUE(submission_id)` on grades. Every accepted submission must reach `completed` or `failed`.
7. Students can only read their own submission (random id + token). No names or content in URLs.
8. Uploaded PDFs and student work are **data, not instructions**. Prompts must say so, and the content is delimited.
9. Keep it simple: one Node process, SQLite, no new deps without the user's approval, no speculative abstractions, and no fake UI.
10. Don't claim anything works (tests, deploy, benchmarks) unless you ran it. Don't invent numbers.
11. Budget: **$20 hard cap on coding-agent spend** (Opus orchestrator, Kimi K3.1 Pro workers via pi). The app itself has no fixed budget but must minimize tokens per grade (skip model calls for typed answers, short prompts, one call per stage, cheap models). `LLM_BUDGET_USD` stays as a safety guard. Be terse and avoid re-reading big files. Check spend with `curl -s https://openrouter.ai/api/v1/key -H "Authorization: Bearer $OPENROUTER_API_KEY"` (field `usage`).

## Stack and layout
- Node 22 (`node:sqlite`), TypeScript run via `tsx` (no compile step for the server), Hono, zod 4, Effect 3 (model pipeline only), unpdf, React 19 + react-router 7 + Vite, and vitest.
- `shared/schema.ts` holds the contracts. `server/` holds the API, DB, worker, and `llm/` adapters. `web/` holds the SPA (served from `dist/` in production). `scripts/loadtest.ts` holds the per-question load test; `scripts/eval.ts` and `scripts/eval-set.json` hold the labeled real-model accuracy eval. `data/` stores SQLite and uploads (gitignored).
- Commands: `npm run dev` (API :3000 + Vite :5173), `npm run build && npm start` (production on :3000), `npm test`, `npm run typecheck`, `npm run loadtest -- --help`.
- Env: see `.env.example`.

## Repo
`~/code/goblins-auto-grader`, remote `github.com/zaidsiddiqui0/goblins-auto-grader`. The original brief is also at `~/Documents/goblins-auto-grader/`. `gh` auth lives in `GH_CONFIG_DIR=~/.gh-config` (`~/.config` is root-owned); the repo-local git credential helper uses it.

## State
- [x] Scaffold, contracts, and docs
- [x] Backend (Kimi A)
- [x] Frontend (Kimi B)
- [x] Integration and real-model smoke run
- [x] Load test, Dockerfile, README, and results (Kimi C)
- [x] UI walkthrough in headless Chrome; screenshots in docs/screens/
- [x] Original-brief gaps: per-question flow, whiteboard, cross-device persistence, report grid, CTAs, load test, and accuracy eval
- [x] Pushed `main` to GitHub; Karavil invited (write, pending acceptance)
- [x] Pushed to GitHub. Deployed on Railway: app https://app-production-1a4f.up.railway.app (real, $3 budget guard), loadtest twin https://loadtest-production-1aeb.up.railway.app (mock). CLI: `npx -y @railway/cli`, project goblins-auto-grader, services app + loadtest, volumes at /data.
- [ ] Invite Karavil ONLY when the user says so: `gh api -X PUT repos/zaidsiddiqui0/goblins-auto-grader/collaborators/Karavil`. gh is NOT logged in; git push works via the keychain.
- [ ] Optional demo recording script

## History
- Session 1 (Opus 5.5 orchestrator): found the repo empty with no Goblins APIs, so built from scratch with adapters. Chose the single-process Hono + SQLite + in-process DB queue. Wrote the plan, the contracts, and this file. Spend at start: $0.16 on the key.
- Session 2 (Kimi B): built the complete responsive React SPA and typed API/token/upload helpers; frontend typecheck, production build, and mock-mode dev smoke passed.
- Session 3 (Kimi A): implemented SQLite, all API routes, uploads/auth, Effect OpenRouter and mock adapters, code-side scoring, and the leased retry worker; typecheck, 8 tests with `--root .`, and full mock curl flow passed (plain `npm test` still needs Vitest root config outside `server/`).
- Orchestrator: integrated A+B. Fixed the vitest root. Mock E2E passed (409 before approval, idempotent replay, token 404s, magic-byte check). Real smoke on Haiku 5.5: 8 calls, $0.006 total. Handwriting photo read correctly, grades 17/18 and 0/18 as expected. Fixed the grader so it no longer inherits the rubric draft's needsReview flags and capped output verbosity (about -30% tokens). Gotcha: kill the node PID, not the npm PID.
- Session 4 (Kimi C): added the seeded HTTP load-test harness with idempotency/integrity checks and JSON reports, Dockerfile/.dockerignore, README, and measured mock results. Typecheck, build, and 8 tests passed. Required runs passed: n=5 at 9.597 completed/s, E2E p95 520ms; n=30/concurrency=10 at 23.112/s, E2E p95 1271ms, peak in-flight 8, queue 10. Burst/failure/real load tests remain for orchestrator. Docker CLI unavailable, so image build was not run.
- Orchestrator: the crash test found that orphaned `processing` jobs waited for lease expiry; boot now requeues all of them. Fixed the review-list numbering in the approve dialog. Local deploy: `node --env-file=.env --import tsx server/index.ts` on :3000, LLM_MODE=real, data in ./data. Browser automation: the user's Chrome has no remote debugging, so launch headless Chrome with --remote-debugging-port=9333 and its own --user-data-dir, and set BU_CDP_WS plus BH_HOME=/tmp/bh-gag (~/.config is root-owned).
- Received the original take-home (`docs/takehome.md`). Gaps vs that brief: per-question flow, whiteboard, cross-device student/teacher return, a per-student report grid, the Goblins CTA, an accuracy eval, and a public deploy. Spec: docs/tasks/D-takehome-gaps.md (Kimi D). Cost lesson: Opus orchestrator turns are about 95% of spend, and a cache expiry after a gap of more than 5 minutes re-bills the full context (about $0.55 at 100k tokens). The Kimi workers cost about $0.30 each.
- Session 5 (Kimi D): replaced whole-assignment submissions with PIN-joined students and natural-key per-question jobs pinned to rubric slices; added the responsive whiteboard, teacher fragment links, student summary, report grid, and Goblins CTAs. Updated load testing and added a 15-answer/3-question real-model eval (not run). Added rubric-version and inline-PDF integration coverage. Typecheck, 11 tests, build, and the required n=30 mock smoke passed: 90/90 completed, 3/3 duplicate replays matched, zero lost/duplicated/stuck, E2E p95 604ms; results in `loadtest-results/2026-11-05T07-32-43-313Z-mock-n30.json`. No git commit made.
- Session 6: installed `gh`, logged in as zaidsiddiqui0, pushed `main` (public repo), and invited Karavil as a collaborator. Personal repos can't grant read-only access, so the invite is write.
- v2 verified: whiteboard grading worked in the browser, PIN rejoin worked, accuracy eval run (Haiku 93%), and the 300-student per-question spike passed (16 workers p95 43s; 96 workers p95 6.5s). Harness fix: retry transient fetch errors. Deploy target is Railway (the user chose it). The CLI runs via `npx -y @railway/cli` because brew needs an Xcode update. gh is installed; logins were pending on the user's device codes. Prod should set WORKER_CONCURRENCY around 48.
- Deployed. Deployed spike results are in LOADTEST.md: 300 students pass, and about 1000 simultaneous students break HTTP (502s) on one container. Gotcha: use a quoted heredoc ('EOF') when the text contains backticks.
