import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let directory: string;
let app: import("hono").Hono;
let worker: import("./worker").Worker;
let closeDb: () => void;

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "goblins-api-"));
  process.env.DATA_DIR = directory;
  process.env.LLM_MODE = "mock";
  process.env.MOCK_LATENCY_MS = "1";
  process.env.MOCK_FAIL_RATE = "0";
  process.env.WORKER_CONCURRENCY = "2";
  const [{ createApp }, { Worker }, database] = await Promise.all([
    import("./routes"),
    import("./worker"),
    import("./db"),
  ]);
  worker = new Worker();
  app = createApp(worker);
  closeDb = () => database.db.close();
  worker.start();
});

afterAll(async () => {
  await worker.stop();
  closeDb();
  await rm(directory, { recursive: true, force: true });
});

async function json(response: Response): Promise<any> {
  return response.json();
}

describe("full mock flow", () => {
  it("creates, approves, submits idempotently, and protects student reads", async () => {
    const questions = [{ id: "q1", prompt: "What is 2+2?", answerKey: "4" }];
    const createdResponse = await app.request("/api/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Math", questions }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await json(createdResponse);
    const id = created.assignment.id as string;
    const code = created.assignment.accessCode as string;
    const teacherToken = created.teacherToken as string;
    const teacherHeaders = { "x-teacher-token": teacherToken };

    const generatedResponse = await app.request(`/api/assignments/${id}/rubric/generate`, { method: "POST", headers: teacherHeaders });
    expect(generatedResponse.status).toBe(200);
    expect((await json(generatedResponse)).draftRubric.status).toBe("draft");
    const approvedResponse = await app.request(`/api/assignments/${id}/rubric/approve`, { method: "POST", headers: teacherHeaders });
    expect(approvedResponse.status).toBe(200);
    expect((await json(approvedResponse)).currentRubric.version).toBe(1);

    const makeForm = () => {
      const form = new FormData();
      form.set("studentName", "Student One");
      form.set("idempotencyKey", "7ef1fb38-0ec6-4b7b-94f8-c58d728fb9ad");
      form.set("answers", JSON.stringify({ q1: "4" }));
      return form;
    };
    const submittedResponse = await app.request(`/api/public/${code}/submissions`, { method: "POST", body: makeForm() });
    expect(submittedResponse.status).toBe(202);
    const submitted = await json(submittedResponse);
    const duplicateResponse = await app.request(`/api/public/${code}/submissions`, { method: "POST", body: makeForm() });
    expect(duplicateResponse.status).toBe(200);
    expect((await json(duplicateResponse)).submissionId).toBe(submitted.submissionId);

    let detail: any;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await app.request(`/api/submissions/${submitted.submissionId}`, {
        headers: { "x-student-token": submitted.studentToken },
      });
      detail = await json(response);
      if (detail.status === "completed" || detail.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(detail.status).toBe("completed");
    expect(detail.grade.maxScore).toBe(3);

    const missingToken = await app.request(`/api/submissions/${submitted.submissionId}`);
    expect(missingToken.status).toBe(401);
    const wrongToken = await app.request(`/api/submissions/${submitted.submissionId}`, { headers: { "x-student-token": "another-student-token" } });
    expect(wrongToken.status).toBe(404);

    const { db } = await import("./db");
    const grades = db.prepare("SELECT COUNT(*) AS count FROM grades WHERE submission_id=?").get(submitted.submissionId) as { count: number };
    expect(grades.count).toBe(1);
    const submissions = db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE assignment_id=?").get(id) as { count: number };
    expect(submissions.count).toBe(1);
  });
});
