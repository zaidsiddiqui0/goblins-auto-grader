import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AssignmentDTO,
  GradeResult,
  Question,
  RubricVersionDTO,
  StudentProgressDTO,
  SubmissionDetailDTO,
  SubmissionStatus,
  SubmissionSummaryDTO,
  Transcription,
} from "../shared/schema";
import { rubricMax } from "../shared/schema";

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "./data");
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(path.join(DATA_DIR, "uploads"), { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "app.db"));
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA busy_timeout=5000;
  PRAGMA foreign_keys=ON;

  CREATE TABLE IF NOT EXISTS assignments (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    access_code TEXT NOT NULL UNIQUE,
    teacher_token_hash TEXT NOT NULL,
    questions_json TEXT NOT NULL,
    accepting_submissions INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rubric_versions (
    id TEXT PRIMARY KEY,
    assignment_id TEXT NOT NULL REFERENCES assignments(id),
    version INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('draft', 'approved')),
    rubric_json TEXT NOT NULL,
    model TEXT,
    created_at TEXT NOT NULL,
    approved_at TEXT,
    UNIQUE(assignment_id, version)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS one_draft_per_assignment
    ON rubric_versions(assignment_id) WHERE status='draft';

  CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    assignment_id TEXT NOT NULL REFERENCES assignments(id),
    name TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    wrong_pin_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS one_student_per_assignment_name
    ON students(assignment_id, lower(name));
`);

// Preserve a pre-per-question database as archived tables rather than dropping it.
const submissionColumns = db.prepare("PRAGMA table_info(submissions)").all() as Array<{ name: string }>;
if (submissionColumns.length && !submissionColumns.some((column) => column.name === "student_id")) {
  const gradeColumns = db.prepare("PRAGMA table_info(grades)").all() as Array<{ name: string }>;
  if (gradeColumns.length) db.exec("ALTER TABLE grades RENAME TO legacy_grades");
  db.exec("ALTER TABLE submissions RENAME TO legacy_submissions");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    assignment_id TEXT NOT NULL REFERENCES assignments(id),
    student_id TEXT NOT NULL REFERENCES students(id),
    question_id TEXT NOT NULL,
    rubric_version_id TEXT NOT NULL REFERENCES rubric_versions(id),
    status TEXT NOT NULL CHECK(status IN ('queued', 'processing', 'completed', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_run_at INTEGER NOT NULL,
    lease_until INTEGER,
    last_error TEXT,
    typed_answer TEXT,
    files_json TEXT NOT NULL,
    transcription_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(student_id, question_id)
  );
  CREATE INDEX IF NOT EXISTS submission_queue
    ON submissions(status, next_run_at, created_at);
  CREATE INDEX IF NOT EXISTS submissions_by_assignment
    ON submissions(assignment_id, student_id, question_id);

  CREATE TABLE IF NOT EXISTS grades (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id),
    rubric_version_id TEXT NOT NULL REFERENCES rubric_versions(id),
    result_json TEXT NOT NULL,
    model TEXT NOT NULL,
    usage_json TEXT NOT NULL DEFAULT '[]',
    override_score REAL,
    override_note TEXT,
    override_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS llm_usage (
    id TEXT PRIMARY KEY,
    stage TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    ms INTEGER NOT NULL DEFAULT 0,
    ok INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
`);

export type AssignmentRow = {
  id: string;
  title: string;
  access_code: string;
  teacher_token_hash: string;
  questions_json: string;
  accepting_submissions: number;
  created_at: string;
};

export type RubricVersionRow = {
  id: string;
  assignment_id: string;
  version: number;
  status: "draft" | "approved";
  rubric_json: string;
  model: string | null;
  created_at: string;
  approved_at: string | null;
};

export type StudentRow = {
  id: string;
  assignment_id: string;
  name: string;
  pin_hash: string;
  token_hash: string;
  wrong_pin_attempts: number;
  locked_until: number | null;
  created_at: string;
};

export type StoredFile = { name: string; mime: string; path: string };

export type SubmissionRow = {
  id: string;
  assignment_id: string;
  student_id: string;
  question_id: string;
  rubric_version_id: string;
  status: SubmissionStatus;
  attempts: number;
  next_run_at: number;
  lease_until: number | null;
  last_error: string | null;
  typed_answer: string | null;
  files_json: string;
  transcription_json: string | null;
  created_at: string;
  updated_at: string;
};

export type SubmissionJoinedRow = SubmissionRow & {
  student_name: string;
  student_token_hash: string;
  rubric_version: number;
  result_json: string | null;
  grade_model: string | null;
  graded_at: string | null;
  override_score: number | null;
  override_note: string | null;
  override_at: string | null;
};

export const now = () => new Date().toISOString();
export const newId = () => randomUUID();
export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest();

export function tokenMatches(token: string | undefined, hashHex: string): boolean {
  if (!token) return false;
  const actual = hashToken(token);
  const expected = Buffer.from(hashHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pin, salt, 32).toString("hex")}`;
}

export function pinMatches(pin: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const actual = scryptSync(pin, Buffer.from(saltHex, "hex"), 32);
  const expected = Buffer.from(hashHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function newAccessCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getAssignment(id: string): AssignmentRow | undefined {
  return db.prepare("SELECT * FROM assignments WHERE id=?").get(id) as unknown as AssignmentRow | undefined;
}

export function getAssignmentByCode(code: string): AssignmentRow | undefined {
  return db.prepare("SELECT * FROM assignments WHERE access_code=?").get(code) as unknown as AssignmentRow | undefined;
}

export function getStudent(id: string): StudentRow | undefined {
  return db.prepare("SELECT * FROM students WHERE id=?").get(id) as unknown as StudentRow | undefined;
}

export function listStudents(assignmentId: string): StudentRow[] {
  return db.prepare("SELECT * FROM students WHERE assignment_id=? ORDER BY lower(name), created_at").all(assignmentId) as unknown as StudentRow[];
}

export function publicAssignment(row: AssignmentRow) {
  const questions = (JSON.parse(row.questions_json) as Question[]).map(({ id, prompt }) => ({ id, prompt }));
  return { title: row.title, questions, acceptingSubmissions: Boolean(row.accepting_submissions) };
}

export function rubricVersionDto(row: RubricVersionRow): RubricVersionDTO {
  const rubric = JSON.parse(row.rubric_json) as RubricVersionDTO["rubric"];
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    rubric,
    maxScore: rubricMax(rubric),
    model: row.model,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
  };
}

export function assignmentDto(row: AssignmentRow): AssignmentDTO {
  const versions = db.prepare("SELECT * FROM rubric_versions WHERE assignment_id=? ORDER BY version DESC").all(row.id) as unknown as RubricVersionRow[];
  const approved = versions.find((version) => version.status === "approved");
  const draft = versions.find((version) => version.status === "draft");
  return {
    id: row.id,
    title: row.title,
    accessCode: row.access_code,
    questions: JSON.parse(row.questions_json) as Question[],
    acceptingSubmissions: Boolean(row.accepting_submissions),
    currentRubric: approved ? rubricVersionDto(approved) : null,
    draftRubric: draft ? rubricVersionDto(draft) : null,
    createdAt: row.created_at,
  };
}

const submissionSelect = `
  SELECT s.*, st.name AS student_name, st.token_hash AS student_token_hash, rv.version AS rubric_version,
    g.result_json, g.model AS grade_model, g.created_at AS graded_at,
    g.override_score, g.override_note, g.override_at
  FROM submissions s
  JOIN students st ON st.id=s.student_id
  JOIN rubric_versions rv ON rv.id=s.rubric_version_id
  LEFT JOIN grades g ON g.submission_id=s.id
`;

export function getSubmission(id: string): SubmissionJoinedRow | undefined {
  return db.prepare(`${submissionSelect} WHERE s.id=?`).get(id) as unknown as SubmissionJoinedRow | undefined;
}

export function listSubmissions(assignmentId: string): SubmissionJoinedRow[] {
  return db.prepare(`${submissionSelect} WHERE s.assignment_id=? ORDER BY st.name, s.created_at`).all(assignmentId) as unknown as SubmissionJoinedRow[];
}

export function listStudentSubmissions(studentId: string): SubmissionJoinedRow[] {
  return db.prepare(`${submissionSelect} WHERE s.student_id=? ORDER BY s.created_at`).all(studentId) as unknown as SubmissionJoinedRow[];
}

export function submissionSummary(row: SubmissionJoinedRow): SubmissionSummaryDTO {
  const grade = row.result_json ? JSON.parse(row.result_json) as GradeResult : null;
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    questionId: row.question_id,
    status: row.status,
    rubricVersion: row.rubric_version,
    score: row.override_score ?? grade?.score ?? null,
    maxScore: grade?.maxScore ?? null,
    needsReview: grade?.needsReview ?? false,
    error: row.last_error,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function submissionDetail(row: SubmissionJoinedRow, token: string, includeOverrideNote: boolean): SubmissionDetailDTO {
  const result = row.result_json ? JSON.parse(row.result_json) as GradeResult : null;
  const files = JSON.parse(row.files_json) as StoredFile[];
  return {
    ...submissionSummary(row),
    typedAnswer: row.typed_answer,
    files: files.map((file, index) => ({
      name: file.name,
      mime: file.mime,
      url: `/api/files/${row.id}/${index}?t=${encodeURIComponent(token)}`,
    })),
    transcription: row.transcription_json ? JSON.parse(row.transcription_json) as Transcription : null,
    grade: result && row.grade_model && row.graded_at ? { ...result, model: row.grade_model, gradedAt: row.graded_at } : null,
    override: row.override_score === null ? null : {
      score: row.override_score,
      note: includeOverrideNote ? row.override_note : null,
      at: row.override_at ?? row.updated_at,
    },
  };
}

export function studentProgressDto(student: StudentRow): StudentProgressDTO {
  const assignment = getAssignment(student.assignment_id)!;
  const dto = assignmentDto(assignment);
  const submissions = listStudentSubmissions(student.id).map(submissionSummary);
  return {
    studentId: student.id,
    studentName: student.name,
    classCode: assignment.access_code,
    assignment: publicAssignment(assignment),
    submissions,
    answered: submissions.length,
    totalScore: submissions.reduce((sum, submission) => sum + (submission.score ?? 0), 0),
    maxScore: dto.currentRubric?.maxScore ?? 0,
    complete: submissions.length === dto.questions.length,
  };
}

export function recordLlmUsage(entry: {
  stage: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  ms: number;
  ok: boolean;
}): void {
  db.prepare(`
    INSERT INTO llm_usage (id, stage, model, prompt_tokens, completion_tokens, cost_usd, ms, ok, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(newId(), entry.stage, entry.model, entry.promptTokens, entry.completionTokens, entry.costUsd, entry.ms, entry.ok ? 1 : 0, now());
}

export function llmSpend(): number {
  const row = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS spend FROM llm_usage").get() as { spend: number };
  return row.spend;
}
