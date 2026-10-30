import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { Question, Rubric, type SubmissionStatus } from "../shared/schema";
import {
  DATA_DIR,
  assignmentDto,
  db,
  getAssignment,
  getAssignmentByCode,
  getSubmission,
  hashToken,
  listSubmissions,
  llmSpend,
  newAccessCode,
  newId,
  newToken,
  now,
  submissionDetail,
  submissionSummary,
  tokenMatches,
  transaction,
  type AssignmentRow,
  type StoredFile,
} from "./db";
import { extractPdf } from "./extract";
import { makeRubricGenerator } from "./llm/adapters";

const QuestionsBody = z.object({
  title: z.string().trim().min(1).max(300),
  questions: z.array(Question).min(1),
});
const Answers = z.record(z.string(), z.string());
const mode = () => process.env.LLM_MODE === "real" ? "real" : "mock";
const uploadRoot = () => path.join(DATA_DIR, "uploads");

function uniqueQuestions(questions: Array<{ id: string }>): boolean {
  return new Set(questions.map((question) => question.id)).size === questions.length;
}

function teacherAssignment(id: string, token: string | undefined): AssignmentRow | null {
  const assignment = getAssignment(id);
  return assignment && tokenMatches(token, assignment.teacher_token_hash) ? assignment : null;
}

function values<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

async function fileType(file: File): Promise<{ mime: string; extension: string } | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", extension: "jpg" };
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) {
    return { mime: "image/png", extension: "png" };
  }
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP") {
    return { mime: "image/webp", extension: "webp" };
  }
  if (bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString() === "%PDF-") return { mime: "application/pdf", extension: "pdf" };
  return null;
}

async function onePdf(body: Record<string, string | File | Array<string | File>>): Promise<File | null> {
  const files = values(body.file).filter((value): value is File => value instanceof File);
  const file = files[0];
  if (files.length !== 1 || !file || file.size > 10 * 1024 * 1024) return null;
  return (await fileType(file))?.mime === "application/pdf" ? file : null;
}

export type AppWorker = {
  notify(): void;
  metrics(): { inFlight: number; peakInFlight: number; retries: number };
};

export function createApp(worker: AppWorker): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof SyntaxError) return c.json({ error: "Invalid JSON" }, 400);
    console.error(JSON.stringify({ event: "http_error", path: c.req.path, message: error.message }));
    return c.json({ error: "Internal server error" }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true, mode: mode() }));

  app.post("/api/extract", bodyLimit({ maxSize: 11 * 1024 * 1024, onError: (c) => c.json({ error: "Upload too large" }, 413) }), async (c) => {
    const body = await c.req.parseBody();
    const file = await onePdf(body);
    if (!file) return c.json({ error: "One valid PDF up to 10MB is required" }, 400);
    try {
      return c.json(await extractPdf(new Uint8Array(await file.arrayBuffer())));
    } catch {
      return c.json({ error: "Could not extract text from PDF" }, 422);
    }
  });

  app.post("/api/assignments", async (c) => {
    const parsed = QuestionsBody.safeParse(await c.req.json());
    if (!parsed.success || !uniqueQuestions(parsed.data.questions)) return c.json({ error: "Valid title and unique questions are required" }, 400);
    const teacherToken = newToken();
    const id = newId();
    const createdAt = now();
    let accessCode = newAccessCode();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        db.prepare(`
          INSERT INTO assignments (id, title, access_code, teacher_token_hash, questions_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, parsed.data.title, accessCode, hashToken(teacherToken).toString("hex"), JSON.stringify(parsed.data.questions), createdAt);
        const assignment = getAssignment(id)!;
        return c.json({ assignment: assignmentDto(assignment), teacherToken }, 201);
      } catch (error) {
        if (attempt === 4 || !String(error).includes("access_code")) throw error;
        accessCode = newAccessCode();
      }
    }
    return c.json({ error: "Could not create assignment" }, 500);
  });

  app.get("/api/assignments/:id", (c) => {
    const assignment = teacherAssignment(c.req.param("id"), c.req.header("x-teacher-token"));
    return assignment ? c.json(assignmentDto(assignment)) : c.json({ error: "Assignment not found" }, 404);
  });

  app.put("/api/assignments/:id/questions", async (c) => {
    const assignment = teacherAssignment(c.req.param("id"), c.req.header("x-teacher-token"));
    if (!assignment) return c.json({ error: "Assignment not found" }, 404);
    const parsed = z.object({ questions: z.array(Question).min(1) }).safeParse(await c.req.json());
    if (!parsed.success || !uniqueQuestions(parsed.data.questions)) return c.json({ error: "Valid unique questions are required" }, 400);
    const count = db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE assignment_id=?").get(assignment.id) as { count: number };
    if (count.count > 0) return c.json({ error: "Questions cannot change after submissions exist" }, 409);
    db.prepare("UPDATE assignments SET questions_json=? WHERE id=?").run(JSON.stringify(parsed.data.questions), assignment.id);
    return c.json(assignmentDto(getAssignment(assignment.id)!));
  });

  app.post("/api/assignments/:id/rubric/generate", async (c) => {
    const assignment = teacherAssignment(c.req.param("id"), c.req.header("x-teacher-token"));
    if (!assignment) return c.json({ error: "Assignment not found" }, 404);
    const generator = makeRubricGenerator();
    const rubric = await generator.generate(JSON.parse(assignment.questions_json));
    transaction(() => {
      const version = db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM rubric_versions WHERE assignment_id=?").get(assignment.id) as { version: number };
      db.prepare("DELETE FROM rubric_versions WHERE assignment_id=? AND status='draft'").run(assignment.id);
      db.prepare(`
        INSERT INTO rubric_versions (id, assignment_id, version, status, rubric_json, model, created_at)
        VALUES (?, ?, ?, 'draft', ?, ?, ?)
      `).run(newId(), assignment.id, version.version, JSON.stringify(rubric), generator.model, now());
    });
    return c.json(assignmentDto(getAssignment(assignment.id)!));
  });

  app.put("/api/assignments/:id/rubric/draft", async (c) => {
    const assignment = teacherAssignment(c.req.param("id"), c.req.header("x-teacher-token"));
    if (!assignment) return c.json({ error: "Assignment not found" }, 404);
    const parsed = z.object({ rubric: Rubric }).safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Valid rubric is required" }, 400);
    transaction(() => {
      const existing = db.prepare("SELECT id FROM rubric_versions WHERE assignment_id=? AND status='draft'").get(assignment.id) as { id: string } | undefined;
      if (existing) {
        db.prepare("UPDATE rubric_versions SET rubric_json=?, model=NULL WHERE id=?").run(JSON.stringify(parsed.data.rubric), existing.id);
      } else {
        const version = db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM rubric_versions WHERE assignment_id=?").get(assignment.id) as { version: number };
        db.prepare(`
          INSERT INTO rubric_versions (id, assignment_id, version, status, rubric_json, model, created_at)
          VALUES (?, ?, ?, 'draft', ?, NULL, ?)
        `).run(newId(), assignment.id, version.version, JSON.stringify(parsed.data.rubric), now());
      }
    });
    return c.json(assignmentDto(getAssignment(assignment.id)!));
  });

  app.post("/api/assignments/:id/rubric/approve", (c) => {
    const assignment = teacherAssignment(c.req.param("id"), c.req.header("x-teacher-token"));
    if (!assignment) return c.json({ error: "Assignment not found" }, 404);
    const approvedAt = now();
    const result = transaction(() => {
      const draft = db.prepare("SELECT id FROM rubric_versions WHERE assignment_id=? AND status='draft'").get(assignment.id) as { id: string } | undefined;
      if (!draft) return false;
      db.prepare("UPDATE rubric_versions SET status='approved', approved_at=? WHERE id=? AND status='draft'").run(approvedAt, draft.id);
      db.prepare("UPDATE assignments SET accepting_submissions=1 WHERE id=?").run(assignment.id);
      return true;
    });
    if (!result) return c.json({ error: "No draft rubric to approve" }, 409);
    return c.json(assignmentDto(getAssignment(assignment.id)!));
  });

  app.get("/api/assignments/:id/submissions", (c) => {
    const assignment = teacherAssignment(c.req.param("id"), c.req.header("x-teacher-token"));
    if (!assignment) return c.json({ error: "Assignment not found" }, 404);
    const submissions = listSubmissions(assignment.id);
    const counts: Record<SubmissionStatus, number> = { queued: 0, processing: 0, completed: 0, failed: 0 };
    for (const submission of submissions) counts[submission.status] += 1;
    return c.json({ submissions: submissions.map(submissionSummary), counts });
  });

  app.get("/api/assignments/:id/submissions/:sid", (c) => {
    const token = c.req.header("x-teacher-token");
    const assignment = teacherAssignment(c.req.param("id"), token);
    const submission = getSubmission(c.req.param("sid"));
    if (!assignment || !submission || submission.assignment_id !== assignment.id) return c.json({ error: "Submission not found" }, 404);
    return c.json(submissionDetail(submission, token!, true));
  });

  app.post("/api/assignments/:id/submissions/:sid/retry", (c) => {
    const assignment = teacherAssignment(c.req.param("id"), c.req.header("x-teacher-token"));
    const submission = assignment ? getSubmission(c.req.param("sid")) : undefined;
    if (!assignment || !submission || submission.assignment_id !== assignment.id) return c.json({ error: "Submission not found" }, 404);
    if (submission.status !== "failed") return c.json({ error: "Only failed submissions can be retried" }, 409);
    db.prepare(`
      UPDATE submissions SET status='queued', attempts=0, next_run_at=?, lease_until=NULL, last_error=NULL, updated_at=? WHERE id=?
    `).run(Date.now(), now(), submission.id);
    worker.notify();
    return c.json(submissionSummary(getSubmission(submission.id)!));
  });

  app.post("/api/assignments/:id/submissions/:sid/override", async (c) => {
    const assignment = teacherAssignment(c.req.param("id"), c.req.header("x-teacher-token"));
    const submission = assignment ? getSubmission(c.req.param("sid")) : undefined;
    if (!assignment || !submission || submission.assignment_id !== assignment.id) return c.json({ error: "Submission not found" }, 404);
    const parsed = z.object({ score: z.number().min(0), note: z.string().max(5000).optional() }).safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Valid score and note are required" }, 400);
    if (!submission.result_json) return c.json({ error: "A grade is required before override" }, 409);
    const result = JSON.parse(submission.result_json) as { maxScore: number };
    if (parsed.data.score > result.maxScore) return c.json({ error: "Override score exceeds maximum" }, 400);
    db.prepare("UPDATE grades SET override_score=?, override_note=?, override_at=? WHERE submission_id=?")
      .run(parsed.data.score, parsed.data.note ?? null, now(), submission.id);
    return c.json(submissionDetail(getSubmission(submission.id)!, c.req.header("x-teacher-token")!, true));
  });

  app.get("/api/public/:code", (c) => {
    const assignment = getAssignmentByCode(c.req.param("code").toUpperCase());
    if (!assignment) return c.json({ error: "Assignment not found" }, 404);
    const questions = (JSON.parse(assignment.questions_json) as Array<{ id: string; prompt: string }>).map(({ id, prompt }) => ({ id, prompt }));
    return c.json({ title: assignment.title, questions, acceptingSubmissions: Boolean(assignment.accepting_submissions) });
  });

  app.post("/api/public/:code/submissions", bodyLimit({ maxSize: 42 * 1024 * 1024, onError: (c) => c.json({ error: "Upload too large" }, 413) }), async (c) => {
    const assignment = getAssignmentByCode(c.req.param("code").toUpperCase());
    if (!assignment) return c.json({ error: "Assignment not found" }, 404);
    const body = await c.req.parseBody();
    const studentName = typeof body.studentName === "string" ? body.studentName.trim() : "";
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
    if (!studentName || studentName.length > 200 || !z.string().uuid().safeParse(idempotencyKey).success) {
      return c.json({ error: "studentName and a UUID idempotencyKey are required" }, 400);
    }
    const duplicate = db.prepare("SELECT id, status FROM submissions WHERE assignment_id=? AND idempotency_key=?")
      .get(assignment.id, idempotencyKey) as { id: string; status: SubmissionStatus } | undefined;
    if (duplicate) return c.json({ submissionId: duplicate.id, status: duplicate.status }, 200);
    if (!assignment.accepting_submissions) return c.json({ error: "Assignment is not accepting submissions" }, 409);
    const currentRubric = db.prepare(`
      SELECT id FROM rubric_versions WHERE assignment_id=? AND status='approved' ORDER BY version DESC LIMIT 1
    `).get(assignment.id) as { id: string } | undefined;
    if (!currentRubric) return c.json({ error: "Assignment is not accepting submissions" }, 409);

    let typedAnswers: Record<string, string> | null = null;
    if (typeof body.answers === "string") {
      let json: unknown;
      try { json = JSON.parse(body.answers); } catch { return c.json({ error: "answers must be valid JSON" }, 400); }
      const parsed = Answers.safeParse(json);
      if (!parsed.success) return c.json({ error: "answers must map question ids to strings" }, 400);
      typedAnswers = parsed.data;
    }
    const questionIds = new Set((JSON.parse(assignment.questions_json) as Array<{ id: string }>).map((question) => question.id));
    if (typedAnswers && Object.keys(typedAnswers).some((id) => !questionIds.has(id))) return c.json({ error: "Unknown question id in answers" }, 400);
    const uploads = values(body.files).filter((value): value is File => value instanceof File);
    if (uploads.length > 5) return c.json({ error: "At most five images are allowed" }, 400);
    if (!uploads.length && !Object.values(typedAnswers ?? {}).some((answer) => answer.length > 0)) {
      return c.json({ error: "Answers or files are required" }, 400);
    }

    const detected: Array<{ file: File; mime: string; extension: string }> = [];
    for (const file of uploads) {
      const type = await fileType(file);
      if (!type) return c.json({ error: "Files must be valid JPG, PNG, WEBP, or PDF files" }, 400);
      const max = type.mime === "application/pdf" ? 10 * 1024 * 1024 : 8 * 1024 * 1024;
      if (file.size > max || file.size === 0) return c.json({ error: "File exceeds its size limit" }, 400);
      detected.push({ file, ...type });
    }
    if (detected.some((file) => file.mime === "application/pdf") && detected.length !== 1) {
      return c.json({ error: "A PDF must be the only uploaded file" }, 400);
    }

    const submissionId = newId();
    const studentToken = newToken();
    const directory = path.join(uploadRoot(), submissionId);
    await mkdir(directory, { recursive: true });
    try {
      const files: StoredFile[] = [];
      for (const [index, upload] of detected.entries()) {
        const storedPath = path.join(directory, `${index}.${upload.extension}`);
        await writeFile(storedPath, new Uint8Array(await upload.file.arrayBuffer()), { flag: "wx" });
        files.push({ name: upload.file.name.slice(0, 255) || `upload-${index + 1}`, mime: upload.mime, path: storedPath });
      }
      const createdAt = now();
      db.prepare(`
        INSERT INTO submissions (
          id, assignment_id, rubric_version_id, student_name, student_token_hash, idempotency_key,
          status, next_run_at, typed_answers_json, files_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)
      `).run(
        submissionId, assignment.id, currentRubric.id, studentName, hashToken(studentToken).toString("hex"),
        idempotencyKey, Date.now(), typedAnswers === null ? null : JSON.stringify(typedAnswers), JSON.stringify(files), createdAt, createdAt,
      );
      worker.notify();
      return c.json({ submissionId, studentToken, status: "queued" }, 202);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      const existing = db.prepare("SELECT id, status FROM submissions WHERE assignment_id=? AND idempotency_key=?")
        .get(assignment.id, idempotencyKey) as { id: string; status: SubmissionStatus } | undefined;
      if (existing) return c.json({ submissionId: existing.id, status: existing.status }, 200);
      throw error;
    }
  });

  app.get("/api/submissions/:id", (c) => {
    const token = c.req.header("x-student-token");
    if (!token) return c.json({ error: "Student token required" }, 401);
    const submission = getSubmission(c.req.param("id"));
    if (!submission || !tokenMatches(token, submission.student_token_hash)) return c.json({ error: "Submission not found" }, 404);
    return c.json(submissionDetail(submission, token, false));
  });

  app.get("/api/files/:submissionId/:index", async (c) => {
    const token = c.req.query("t");
    const submission = getSubmission(c.req.param("submissionId"));
    const assignment = submission ? getAssignment(submission.assignment_id) : undefined;
    if (!submission || !assignment || !tokenMatches(token, submission.student_token_hash) && !tokenMatches(token, assignment.teacher_token_hash)) {
      return c.json({ error: "File not found" }, 404);
    }
    if (!/^\d+$/.test(c.req.param("index"))) return c.json({ error: "File not found" }, 404);
    const files = JSON.parse(submission.files_json) as StoredFile[];
    const file = files[Number(c.req.param("index"))];
    if (!file) return c.json({ error: "File not found" }, 404);
    const expectedDirectory = path.join(uploadRoot(), submission.id);
    const resolved = path.resolve(file.path);
    if (path.dirname(resolved) !== expectedDirectory) return c.json({ error: "File not found" }, 404);
    try {
      const contents = await readFile(resolved);
      c.header("Content-Type", file.mime);
      c.header("Content-Disposition", `inline; filename="${file.name.replace(/["\r\n]/g, "_")}"`);
      return c.body(new Uint8Array(contents));
    } catch {
      return c.json({ error: "File not found" }, 404);
    }
  });

  app.get("/api/metrics", (c) => {
    const statusCounts: Record<SubmissionStatus, number> = { queued: 0, processing: 0, completed: 0, failed: 0 };
    const rows = db.prepare("SELECT status, COUNT(*) AS count FROM submissions GROUP BY status").all() as Array<{ status: SubmissionStatus; count: number }>;
    for (const row of rows) statusCounts[row.status] = row.count;
    const llm = db.prepare("SELECT COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost FROM llm_usage").get() as { calls: number; cost: number };
    return c.json({
      mode: mode(),
      queueDepth: statusCounts.queued,
      ...worker.metrics(),
      statusCounts,
      llm: { calls: llm.calls, costUsd: llm.cost, budgetUsd: Number(process.env.LLM_BUDGET_USD ?? 2) },
    });
  });

  app.notFound((c) => c.json({ error: "Not found" }, 404));
  return app;
}
