# Decisions

- **Built from scratch.** The repo had no Goblins code or API docs, so every Goblins capability sits behind an adapter (`server/llm/*`), with mock and OpenRouter implementations.
- **One process: Hono + SQLite + in-DB job queue.** This keeps ops at zero and stays durable across restarts (leases are requeued on boot). The trade-off is a single node only. Next step: Postgres plus `SELECT … FOR UPDATE SKIP LOCKED` workers, or a managed queue.
- **Two model stages, reader then grader.** Typed answers skip the reader entirely. No multi-model chain or Jev stage; that waits for measured need.
- **Haiku 5.5 for every stage** ($0.10/$0.50 per M tokens, vision). It's configurable per stage.
- **No accounts.** The teacher gets a capability token, and each student gets a per-submission token. Both are stored hashed.
- **Grades are visible to students immediately**, with "needs teacher review" labels. Teacher override is supported. A release gate is deferred.
- **Deferred:** worksheet library, whiteboard, auth, rosters, analytics, regrade-on-new-version.
