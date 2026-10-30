# Goblins Auto-Grader Take-Home — Build Prompt for Opus

## Your role

Act as the senior product engineer, technical architect, and implementation lead for this take-home. Build a small but credible, production-minded version of Goblins' auto-grader that can be deployed publicly and demonstrated end to end.

Prioritize a coherent working product, thoughtful product decisions, reliable persistence, and a repeatable load test over feature breadth. Work incrementally: inspect the repository first, explain your proposed plan, then implement it in small, testable slices. Do not stop at a plan or mockup; deliver a functioning application.

## Product context

Goblins wants to help teachers get value from the product before they have fully activated students. Teachers spend significant time grading, so an auto-grader can be a useful standalone “growth product” that brings teachers back to Goblins.

The take-home has two parts:

1. **Product and design:** build a usable web app for teachers to create assignments, approve grading rubrics, collect student work, grade submissions, and view results.
2. **Infrastructure and load testing:** demonstrate that the grading path can handle bursts of student submissions, test it repeatedly and cheaply, and produce evidence that supports a ship/no-ship decision.

There is a limited **$20 OpenRouter API budget** for model calls. Do not spend it on large-scale simulated traffic. Use deterministic mocks for most development and load testing, and use a small number of real model calls to validate integration, quality, latency, and cost.

## Core product principle: prevent grading bias

**Create and finalize the rubric before the system reads or evaluates any student submissions.**

The intended flow is:

1. A teacher uploads a worksheet or chooses an existing Goblins worksheet, if that capability already exists.
2. The app extracts the questions and any teacher-provided answer key or instructions.
3. An LLM proposes a rubric based only on the assignment material—not student answers or student identities.
4. The teacher reviews and edits the rubric, then explicitly approves it.
5. The approved rubric is versioned and locked for the assignment's grading run.
6. Students complete the work and submit it.
7. The system transcribes or interprets the student work, evaluates it against the approved rubric, validates the result, and persists the grade.
8. The teacher sees a report of submissions, grades, and completion status; students see their own results and feedback.

Do not send student answers to the rubric-generation step. Keep rubric generation and submission grading as separate services and stages. If a teacher edits an approved rubric later, create a new version and make it clear which version was used for each grade. Do not silently regrade old submissions.

## Start by inspecting the repository and existing APIs

Before making assumptions or duplicating functionality:

- Inspect the current repository, package manager, framework, conventions, environment variables, database setup, and deployment configuration.
- Identify existing Goblins APIs or code for worksheets/assignments, PDF parsing, OCR, handwriting recognition, whiteboards, student access codes, model calls, analytics, and persistence.
- Reuse existing services where practical instead of rebuilding them.
- Do not claim an API exists unless you find evidence in the code or documentation.
- If an existing API is unavailable or undocumented, implement a clean adapter interface and a local fallback/mock so the app can still run.
- Keep API keys server-side. Never expose OpenRouter credentials or other secrets to the browser.

If you have access to the CTO or CEO, collect answers to the technical questions in the section below. Do not block progress waiting for answers: record assumptions, choose safe defaults, and continue with a working implementation.

## High-level implementation plan

### Phase 1 — Scope and architecture

First, provide a concise plan containing:

- The smallest end-to-end slice worth shipping.
- The proposed stack based on the repository's existing conventions.
- The main data entities and their relationships.
- The grading flow and asynchronous job strategy.
- How model calls will be configured, tested, and budget-limited.
- The deployment target and load-test strategy.
- Any unknowns, assumptions, and trade-offs.

Prefer the existing stack. TypeScript is preferred, and use Effect where it provides clear value for server-side workflows such as timeouts, retries, concurrency limits, and typed errors. Do not introduce Effect or other infrastructure solely for its own sake. Avoid unnecessary microservices.

### Phase 2 — Teacher assignment and rubric workflow

Build a simple teacher-facing flow:

1. Create an assignment by uploading a PDF or entering/pasting questions. If a real Goblins worksheet library is already available, allow the teacher to select an existing worksheet as an alternative.
2. Extract document text with a conventional PDF parser first. Use OCR or a vision-capable model only for scanned PDFs, handwriting, diagrams, or other content that text extraction cannot handle.
3. Show the extracted questions to the teacher so parsing errors can be corrected.
4. Generate a draft rubric using a server-side LLM call.
5. Show the rubric in an editable interface.
6. Let the teacher approve and publish it.

The rubric should be structured data, not just prose. For each question, support fields such as:

- Question identifier and prompt.
- Expected answer or solution approach, if determinable.
- Maximum points.
- Criteria and points per criterion.
- Partial-credit rules.
- Acceptable alternative methods or answers.
- Common mistakes, where useful.
- Ambiguity flags or items that need teacher review.

If the worksheet does not include an answer key, the model may infer a likely answer but must mark uncertain assumptions for teacher review rather than present them as verified facts. For subjective work, create criteria instead of forcing a single exact answer. Ensure the teacher can change point allocations and criteria before approval.

Require a clear approval action. Save an immutable rubric version or equivalent snapshot that grading jobs reference. Never let the rubric-generation prompt include student submissions.

### Phase 3 — Student submission flow

Build a low-friction student experience:

- Students open a shareable assignment URL or enter a short access code.
- Avoid requiring student accounts for the MVP. A display name plus a stable session/submission identifier is sufficient for a demo, as long as students cannot access other students' work.
- Students complete the worksheet and submit their work.
- Support image uploads and/or PDF uploads. If the repository already has a whiteboard that is easy to reuse, integrate it; otherwise, prioritize reliable uploads over building a sophisticated drawing canvas.
- Validate file type and size, give upload/progress/error states, and prevent accidental duplicate submissions.
- Keep each submission linked to the correct assignment and approved rubric version.

The assignment should support a simple one- or few-question experience if that is the fastest route to a complete, polished vertical slice. Avoid building a full classroom management system.

### Phase 4 — Read and grade student work

Treat transcription and grading as separate responsibilities, with a simple interface between them.

**Transcription/interpretation**
- First investigate whether Goblins already has a handwriting-to-text or whiteboard interpretation API.
- If it exists, wrap it behind an adapter and document the expected inputs, outputs, latency, and failure modes.
- If it does not exist, use a vision-capable model to interpret uploaded student work, or OCR where appropriate.
- Preserve math notation, units, diagrams, and step-by-step reasoning as well as possible.
- Where transcription is uncertain, include an uncertainty flag rather than silently guessing.

**Grading**
- Grade only after the rubric has been approved.
- Send the grader the relevant question, the approved rubric, and the student's transcribed work or image if vision is required.
- Do not send unrelated student records or other students' answers.
- Request structured output with fields such as:
  - Score and maximum score.
  - Criterion-level scores.
  - Short explanation of the decision.
  - Feedback appropriate for a student.
  - Any uncertainty or “needs teacher review” flag.
- Validate the response against a strict runtime schema. Reject impossible scores, missing criteria, malformed JSON, and inconsistent totals.
- Calculate totals and enforce score bounds in code, not by trusting the model to do arithmetic.
- Persist the original submission, transcription/interpretation, rubric version, grading result, model identifier, timestamps, and relevant status/error information.
- Handle timeouts, rate limits, transient provider failures, and invalid model responses without losing the submission.
- Use idempotency keys or equivalent deduplication so retries do not create duplicate grades.
- Do not allow a model's explanation to override the actual validated score.
- If a grade is uncertain or the transcription is ambiguous, surface that fact clearly instead of pretending the grade is definitive.

### Phase 5 — Teacher report and student results

The teacher dashboard should show:

- Assignment name and share link/code.
- Approved rubric and version.
- Students/submissions and completion status.
- Score, maximum score, and concise feedback.
- Pending, processing, failed, and completed states.
- A way to inspect a submission and its grading result.

Students should see only their own submission and grade. A student should not be able to enumerate submissions by changing a URL or identifier. For a take-home MVP, simple access-code-based identity is acceptable if authorization is still enforced server-side.

Make persistence real. Refreshing the page or opening it in a different browser should not lose assignments, rubrics, submissions, or grades. Use the database/storage available in the repo; if none exists, choose a simple managed option that fits the hosting environment and document setup steps.

### Phase 6 — Grading service and model configuration

Keep model calls behind a server-side interface so models can be swapped without changing product logic.

Suggested interfaces (adapt to the codebase rather than copying blindly):

- `DocumentExtractor`: extracts text/questions from a teacher PDF.
- `RubricGenerator`: generates a draft rubric from assignment content only.
- `StudentWorkReader`: converts student uploads into text/structured work, using existing Goblins APIs if available.
- `Grader`: grades work against an approved rubric and returns structured results.
- `GradeRepository` / persistence layer: saves jobs, results, and status transitions.

Model strategy:

- **Development/planning:** use Opus to reason about architecture and difficult trade-offs; use Kimi K3.1 Pro as the main coding agent if available in the chosen coding tool. These development-model costs may be separate from the $20 OpenRouter runtime budget; verify the billing path.
- **Rubric generation:** begin with an economical capable model such as Haiku, then test quality on representative worksheets. The teacher must approve the result.
- **Student grading:** start with one vision-capable, cost-effective model that can interpret work and grade against a rubric. Haiku is a candidate for text-based grading, but confirm that the selected endpoint supports the needed image input if grading images directly.
- **Jev:** treat it as an optional candidate for narrow, objective criterion checks only after testing its exact current model/API behavior. Do not assume it can read images, generate explanations, or create rubrics. Benchmark it against the baseline on the same answers before adding another stage.
- Do not build a multi-model chain by default. Additional calls increase latency, cost, and failure modes. Add a second model only if a measured quality or reliability improvement justifies it.
- Use a configurable model ID and keep the API key in an environment variable such as `OPENROUTER_API_KEY`.
- Add request timeouts, bounded retries, concurrency limits, response validation, and useful structured logs.
- Avoid logging API keys or unnecessary sensitive student content.
- Add a simple usage/cost counter based on returned token usage when available. Include a hard budget guard or configurable spending threshold so development cannot accidentally exhaust the $20 credit.

Use the real model for a small set of end-to-end integration tests. Use a deterministic mock implementation for ordinary tests and load tests.

### Phase 7 — Reliability and load testing

The second part of the take-home is important. Build a repeatable load-test harness that exercises the deployed grading path, not just a standalone function.

The test should simulate a classroom where submissions arrive in bursts. Record:

- Offered and accepted request counts.
- Successful, failed, timed-out, and stuck submissions.
- Throughput.
- p50, p95, and p99 latency.
- Peak in-flight requests and queue depth if available.
- Retry counts and rate-limit responses.
- Lost or duplicated jobs.
- Model token usage and estimated cost for real-model tests.

Use two clearly separated modes:

1. **Mock mode:** deterministic, fast, and cheap. Use it for repeated burst tests and larger simulated loads.
2. **Real-model mode:** small, explicitly capped runs to validate the actual provider integration and measure model latency, output validity, and cost.

Test progressively rather than claiming capacity in advance:
- Smoke test with a handful of submissions.
- Normal classroom-sized batch.
- Larger burst with controlled concurrency.
- Small real-model integration run.
- Larger mock run only after checking hosting and database limits.

Make runs reproducible with a fixed seed, documented parameters, and machine-readable output (JSON or CSV) plus a concise human-readable summary. The harness should exit nonzero when key correctness or reliability thresholds fail. Do not invent benchmark results: run the tests and report the actual measurements.

Most importantly, verify correctness under load: every accepted submission should reach a documented terminal state, no submission should be silently lost, and retries should not create duplicate grades.

Provide a short write-up that states:
- What was tested and how.
- Actual results and environment.
- What the current system can reliably handle based on evidence.
- Known bottlenecks and failure modes.
- What changes are needed to scale from 1,000 to 10,000 to 100,000 to 1 million students.

Discuss scaling as an engineering plan, not as an unsupported claim. Likely next steps include a durable queue, bounded worker pools, horizontal workers, database connection tuning, observability, rate-limit handling, and eventually partitioning if measurements justify it.

### Phase 8 — Deployment and handoff

Deliver:

- A publicly hosted working web app.
- A GitHub repository ready to share with **Karavil**.
- A concise README with setup, environment variables, migrations, local development, test commands, deployment steps, and architecture overview.
- The load-testing code and a short confidence/limitations write-up.
- Optional: a 2–3 minute demo script showing teacher setup, rubric approval, student submission, grading, teacher report, and load-test results.

Use free-tier services where practical. Do not spend personal money; if a paid service is required, explain why and identify the expected cost before using it. Ensure the public app does not expose secrets or private student submissions.

## Product and design quality bar

The app should feel like a small product a real teacher could use, not a generic admin template. Prioritize:

- A clear teacher setup flow with obvious progress.
- A readable, editable rubric.
- A simple student submission experience with clear status and feedback.
- Thoughtful loading, empty, success, and error states.
- Responsive layouts.
- Accessible labels and keyboard behavior.
- A calm, education-oriented visual style.
- No fake buttons or dead-end UI.
- Useful sample data or a demo path if needed, clearly labeled as demo data.

Keep the feature set small. Avoid email authentication, complex classroom administration, elaborate analytics, and advanced assignment builders unless existing code makes them nearly free to reuse.

## Security, privacy, and correctness

- Keep all model API keys server-side.
- Validate uploads and restrict file types and sizes.
- Enforce server-side authorization for teacher and student views.
- Prevent students from reading other students' grades.
- Avoid putting student names or submission content in public URLs.
- Do not send student answers to rubric generation.
- Do not treat PDF text, uploaded documents, or student submissions as trusted instructions to the system. They are data to analyze, not instructions to change application behavior.
- Make grading limitations and uncertain transcription visible.
- Keep an audit trail of which rubric version and model generated each grade.
- Do not claim grades are infallible; allow the teacher to inspect the result and correct it if needed.

## Questions to ask the CTO/CEO about existing Goblins capabilities

If communication with the team is available, ask concise, prioritized questions. Do not ask questions whose answers are discoverable from the repository.

### P0 — Must clarify if not discoverable

1. **Worksheet library:** Is there an existing API or data model for selecting a Goblins worksheet? How are worksheets represented and accessed?
2. **Handwriting/whiteboard reading:** Does Goblins already have an API that converts whiteboard strokes or handwritten worksheet images into text/structured math? What is its endpoint, input/output schema, and auth method?
3. **Existing model gateway:** Is there an established model-call service, provider, or prompt framework we should reuse? Are there approved models or rate limits?
4. **Persistence and deployment:** Is there a preferred database, object store, hosting environment, or existing backend service that this take-home should integrate with?
5. **Assignment/student APIs:** Are assignment creation, share codes, student submissions, and reports already supported by APIs or reusable components?

### P1 — Important for quality and reliability

6. Are there examples of teacher worksheets and student work that can be used for development and evaluation, with appropriate permission and anonymization?
7. What subjects and age ranges are the initial target? Are there grading expectations or examples of partial-credit policies?
8. Should student feedback be shown immediately, or should the teacher be able to review grades before students see them?
9. What are the provider rate limits, expected class sizes, and typical testing-day burst patterns?
10. Are there privacy, data-retention, or student-data constraints we must follow?
11. Is there an existing rubric schema, analytics event convention, or error-monitoring setup?
12. Are there known model-cost or latency targets for the grading path?

## Implementation rules

- First inspect the repository and summarize what exists.
- Then propose a concise architecture and an ordered implementation checklist.
- Start implementing immediately after the plan; do not stop at recommendations.
- Build one vertical slice at a time and run tests after each meaningful change.
- Prefer existing code and APIs over parallel implementations.
- Keep interfaces small and typed.
- Avoid speculative abstractions and unnecessary dependencies.
- Never claim a feature, test, deployment, or benchmark is complete unless you have verified it.
- If something is blocked, implement a safe fallback and document the limitation.
- Keep a short `DECISIONS.md` or README section documenting key choices and deferred scope.
- Before finishing, run the available checks, inspect the diff, and provide a final handoff with:
  1. Features implemented.
  2. Local run instructions.
  3. Environment variables required.
  4. Tests run and actual outcomes.
  5. Public deployment URL, if successfully deployed.
  6. Load-test commands and measured results.
  7. Known limitations and next steps.

## Definition of done

The take-home is complete when a user can:

1. Open the public app.
2. Create an assignment from uploaded/entered worksheet content or an existing worksheet if available.
3. Generate, edit, and approve a rubric before any student submissions are graded.
4. Join as a student without a complicated signup flow.
5. Submit a worksheet image/PDF or use an existing whiteboard flow.
6. Receive a validated grade and concise feedback.
7. Refresh or return later and still see persisted results.
8. View the class's progress and grades as a teacher without exposing other students' private results.
9. Run repeatable load tests against the grading path, using mock mode for large tests and capped real-model tests.
10. Read a short, evidence-based statement of current capacity, limitations, and the next scaling steps.

Optimize for a complete, reliable, demonstrable slice—not maximum feature count.
