# HTTP API contract

Types live in `shared/schema.ts`. All JSON. Errors: `{ "error": string }` with a proper 4xx/5xx status.

## Auth (no accounts)
- **Teacher**: `POST /api/assignments` returns a random `teacherToken` once. Server stores only its SHA-256. Teacher routes require header `x-teacher-token`. Wrong/missing → 401/404 (don't leak existence).
- **Student**: creating a submission returns a random `studentToken` once. `GET /api/submissions/:id` requires header `x-student-token` matching that submission. IDs are random (not sequential).
- File downloads: `GET /api/files/:submissionId/:index?t=<teacherOrStudentToken>` (query param because `<img src>` can't send headers).

## Teacher
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/extract` | multipart `file` (PDF ≤10MB) | `{ text, questions: Question[] }` — stateless, heuristic split on numbered lines; no answer keys inferred |
| POST | `/api/assignments` | `{ title, questions: Question[] }` | `{ assignment: AssignmentDTO, teacherToken }` |
| GET | `/api/assignments/:id` | – | `AssignmentDTO` |
| PUT | `/api/assignments/:id/questions` | `{ questions: Question[] }` | `AssignmentDTO` (409 if any submissions exist) |
| POST | `/api/assignments/:id/rubric/generate` | – | `AssignmentDTO` (creates/replaces draft; LLM sees questions+answer keys only) |
| PUT | `/api/assignments/:id/rubric/draft` | `{ rubric: Rubric }` | `AssignmentDTO` (creates a draft if none — used to edit after approval → next version) |
| POST | `/api/assignments/:id/rubric/approve` | – | `AssignmentDTO` (draft → approved, immutable; becomes currentRubric) |
| GET | `/api/assignments/:id/submissions` | – | `{ submissions: SubmissionSummaryDTO[], counts: Record<SubmissionStatus, number> }` |
| GET | `/api/assignments/:id/submissions/:sid` | – | `SubmissionDetailDTO` |
| POST | `/api/assignments/:id/submissions/:sid/retry` | – | `SubmissionSummaryDTO` (only from `failed`) |
| POST | `/api/assignments/:id/submissions/:sid/override` | `{ score, note? }` | `SubmissionDetailDTO` |

## Student
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/public/:code` | – | `PublicAssignmentDTO` |
| POST | `/api/public/:code/submissions` | multipart: `studentName`, `idempotencyKey` (client UUID), `answers` (JSON `Record<questionId,string>`, optional), `files` (0–5 × jpg/png/webp ≤8MB each, or 1 PDF ≤10MB). Need answers or files. | `202 { submissionId, studentToken, status }`. Same `(code, idempotencyKey)` again → `200` same submission, no new job. 409 if not accepting. |
| GET | `/api/submissions/:id` | header `x-student-token` | `SubmissionDetailDTO` minus `override.note`; same shape |

## Ops
| GET | `/api/health` | `{ ok, mode }` |
| GET | `/api/metrics` | `{ mode, queueDepth, inFlight, peakInFlight, statusCounts, retries, llm: { calls, costUsd, budgetUsd } }` |
