import type { Question, Rubric } from "../shared/schema";
import {
  db,
  getAssignment,
  now,
  newId,
  transaction,
  type StoredFile,
  type SubmissionRow,
} from "./db";
import { scoreGrade } from "./grading";
import { makeGrader, makeStudentWorkReader } from "./llm/adapters";
import { ProviderError, Timeout } from "./llm/openrouter";

export class Worker {
  private inFlight = 0;
  private peakInFlight = 0;
  private retries = 0;
  private stopped = true;
  private pollTimer: NodeJS.Timeout | undefined;
  private reaperTimer: NodeJS.Timeout | undefined;
  private readonly tasks = new Set<Promise<void>>();
  private readonly reader = makeStudentWorkReader();
  private readonly grader = makeGrader();

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    // Single-process: anything 'processing' at boot was orphaned by a crash. Requeue it now.
    this.reapExpired(Number.MAX_SAFE_INTEGER);
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), 250);
    this.reaperTimer = setInterval(() => this.reapExpired(), 10_000);
  }

  notify(): void {
    if (!this.stopped) this.poll();
  }

  metrics(): { inFlight: number; peakInFlight: number; retries: number } {
    return { inFlight: this.inFlight, peakInFlight: this.peakInFlight, retries: this.retries };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reaperTimer) clearInterval(this.reaperTimer);
    this.pollTimer = undefined;
    this.reaperTimer = undefined;
    await Promise.all([...this.tasks]);
  }

  private claim(): SubmissionRow | undefined {
    const timestamp = Date.now();
    const lease = timestamp + 2 * Number(process.env.LLM_TIMEOUT_MS ?? 45_000);
    return db.prepare(`
      UPDATE submissions
      SET status='processing', lease_until=?, attempts=attempts+1, updated_at=?
      WHERE id=(
        SELECT id FROM submissions
        WHERE status='queued' AND next_run_at<=?
        ORDER BY created_at LIMIT 1
      )
      RETURNING *
    `).get(lease, now(), timestamp) as unknown as SubmissionRow | undefined;
  }

  private poll(): void {
    if (this.stopped) return;
    const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 8));
    while (this.inFlight < concurrency) {
      const submission = this.claim();
      if (!submission) break;
      this.inFlight += 1;
      this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
      const task = this.process(submission)
        .catch((error: unknown) => {
          console.error(JSON.stringify({ event: "worker_error", ok: false, message: error instanceof Error ? error.message : "Unknown error" }));
        })
        .finally(() => {
          this.inFlight -= 1;
          this.tasks.delete(task);
          if (!this.stopped) this.poll();
        });
      this.tasks.add(task);
    }
  }

  private async process(submission: SubmissionRow): Promise<void> {
    try {
      const assignment = getAssignment(submission.assignment_id);
      const rubricRow = db.prepare("SELECT * FROM rubric_versions WHERE id=? AND status='approved'").get(submission.rubric_version_id) as { rubric_json: string } | undefined;
      if (!assignment || !rubricRow) throw new Error("Submission assignment or approved rubric is missing");
      const questions = JSON.parse(assignment.questions_json) as Question[];
      const fullRubric = JSON.parse(rubricRow.rubric_json) as Rubric;
      const question = questions.find((item) => item.id === submission.question_id);
      const rubricQuestion = fullRubric.questions.find((item) => item.questionId === submission.question_id);
      if (!question || !rubricQuestion) throw new Error("Submission question or rubric entry is missing");
      const rubric: Rubric = { questions: [rubricQuestion] };
      const files = JSON.parse(submission.files_json) as StoredFile[];
      const context = { submissionId: submission.id, attempt: submission.attempts };

      const transcription = await this.reader.read(question, submission.typed_answer, files, context);
      const output = await this.grader.grade(rubric, transcription, context);
      const result = scoreGrade(rubric, output, transcription);
      const gradedAt = now();
      transaction(() => {
        db.prepare(`
          INSERT INTO grades (id, submission_id, rubric_version_id, result_json, model, usage_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(submission_id) DO NOTHING
        `).run(newId(), submission.id, submission.rubric_version_id, JSON.stringify(result), this.grader.model, "[]", gradedAt);
        db.prepare(`
          UPDATE submissions SET status='completed', transcription_json=?, lease_until=NULL, last_error=NULL, updated_at=?
          WHERE id=?
        `).run(JSON.stringify(transcription), gradedAt, submission.id);
      });
    } catch (error) {
      const retryable = error instanceof Timeout || (error instanceof ProviderError && error.retryable);
      const maxAttempts = Math.max(1, Number(process.env.MAX_ATTEMPTS ?? 3));
      const message = (error instanceof Error ? error.message : "Grading failed").slice(0, 500);
      if (retryable && submission.attempts < maxAttempts) {
        const backoff = Math.min(10_000, 500 * 2 ** (submission.attempts - 1));
        db.prepare(`
          UPDATE submissions SET status='queued', next_run_at=?, lease_until=NULL, last_error=?, updated_at=? WHERE id=?
        `).run(Date.now() + backoff, message, now(), submission.id);
        this.retries += 1;
      } else {
        db.prepare(`
          UPDATE submissions SET status='failed', lease_until=NULL, last_error=?, updated_at=? WHERE id=?
        `).run(message, now(), submission.id);
      }
    }
  }

  private reapExpired(cutoff = Date.now()): void {
    const timestamp = Date.now();
    const result = db.prepare(`
      UPDATE submissions SET status='queued', next_run_at=?, lease_until=NULL, updated_at=?
      WHERE status='processing' AND lease_until IS NOT NULL AND lease_until<=?
    `).run(timestamp, now(), cutoff);
    this.retries += Number(result.changes);
  }
}
