# HTTP API contract

Types live in `shared/schema.ts`. All JSON. Errors: `{ "error": string }` with a proper 4xx/5xx status.

## Auth and persistence
- **Teacher**: `POST /api/assignments` returns `teacherToken` once. Store it in the private link `/t/:id#k=<token>`; fragments are never sent to the server. Teacher routes require `x-teacher-token`.
- **Student**: join with class code, case-insensitive name, and 4-digit PIN. PINs are salted/scrypt-hashed. Five wrong attempts lock that student for 10 minutes. A successful join returns a session token and all progress; rejoining rotates the token. Student routes require `x-student-token`.
- File downloads: `GET /api/files/:submissionId/:index?t=<teacherOrStudentToken>`.

## Teacher
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/extract` | multipart `file` (PDF ≤10MB) | `{ text, questions: Question[] }` |
| POST | `/api/assignments` | `{ title, questions }` | `{ assignment, teacherToken }` |
| GET | `/api/assignments/:id` | – | `AssignmentDTO` |
| PUT | `/api/assignments/:id/questions` | `{ questions }` | `AssignmentDTO` (409 after submissions) |
| POST | `/api/assignments/:id/rubric/generate` | – | `AssignmentDTO`; LLM sees questions and answer keys only |
| PUT | `/api/assignments/:id/rubric/draft` | `{ rubric }` | `AssignmentDTO`; editing an approved rubric creates a new draft version |
| POST | `/api/assignments/:id/rubric/approve` | – | `AssignmentDTO`; approved versions are immutable |
| GET | `/api/assignments/:id/submissions` | – | `TeacherReportDTO`: one row per joined student, per-question cells, flattened submissions, and status counts |
| GET | `/api/assignments/:id/submissions/:sid` | – | `SubmissionDetailDTO` |
| POST | `/api/assignments/:id/submissions/:sid/retry` | – | `SubmissionSummaryDTO` (only from `failed`) |
| POST | `/api/assignments/:id/submissions/:sid/override` | `{ score, note? }` | `SubmissionDetailDTO` |

## Student
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/public/:code` | – | `PublicAssignmentDTO`; no answer keys or rubric |
| POST | `/api/public/:code/join` | `{ name, pin }` | `{ studentToken, progress: StudentProgressDTO }` |
| GET | `/api/students/:studentId/progress` | auth header | `StudentProgressDTO` |
| POST | `/api/students/:studentId/submissions/:questionId` | auth header; multipart `answer` (optional string) and `file` (optional one jpg/png/webp ≤8MB); one is required | `202 { submissionId, status }` |
| GET | `/api/submissions/:id` | auth header | `SubmissionDetailDTO` without private override note |

A submission is exactly one question and pins the latest approved `rubric_version_id`. `UNIQUE(student_id, question_id)` is the idempotency key: replaying the same student/question returns `200` and the existing submission id without creating another job. Whiteboard/photo submissions use vision transcription; typed-only submissions skip the reader model.

## Ops
| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | `{ ok, mode }` |
| GET | `/api/metrics` | `{ mode, queueDepth, inFlight, peakInFlight, statusCounts, retries, llm }` |
