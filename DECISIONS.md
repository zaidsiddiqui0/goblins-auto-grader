# Decisions

- **Built from scratch.** The repo had no Goblins code or API docs, so every Goblins capability sits behind an adapter (`server/llm/*`), with mock and OpenRouter implementations.
- **One process: Hono + SQLite + in-DB job queue.** This keeps ops at zero and stays durable across restarts (leases are requeued on boot). The trade-off is a single node only. Next step: Postgres plus `SELECT … FOR UPDATE SKIP LOCKED` workers, or a managed queue.
- **Per-question submissions.** `(student_id, question_id)` is the natural idempotency key; one rubric slice and one transcription per job reduce tokens and let students see each score before continuing.
- **Whiteboard first.** A responsive pointer-events canvas supports pen, eraser, undo, clear, and three colours; exports are white-background PNGs capped at 1000px, with typed text and photo upload as alternatives.
- **PIN persistence.** Students return with class code, case-insensitive name, and a 4-digit PIN stored with salted scrypt; five wrong attempts lock that student for ten minutes.
- **Private teacher links.** The capability token travels only in `/t/:id#k=<token>`'s fragment, is stored in localStorage, and is stripped from the visible URL before API requests.
- **Two model stages, reader then grader.** Typed-only answers skip the reader entirely. Each grader call receives exactly one approved rubric question.
- **Haiku 5.5 for every stage** ($0.10/$0.50 per M tokens, vision). It's configurable per stage and evaluated with the fixed labeled set before choosing a cheaper model.
- **Grades are visible to students immediately**, with "needs teacher review" labels. Teacher override is supported. A release gate is deferred.
- **Growth CTA.** A small Goblins card on teacher and student-summary pages offers live feedback and analytics without interrupting the grading flow.
- **Deferred:** worksheet library, full accounts, roster imports, advanced analytics, and regrade-on-new-version.
