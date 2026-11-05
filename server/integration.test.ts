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
  const [{ createApp }, { Worker }, database] = await Promise.all([import("./routes"), import("./worker"), import("./db")]);
  worker = new Worker();
  app = createApp(worker);
  closeDb = () => database.db.close();
  worker.start();
});
afterAll(async () => { await worker.stop(); closeDb(); await rm(directory, { recursive: true, force: true }); });

async function json(response: Response): Promise<any> { return response.json(); }
async function createApproved(title = "Math") {
  const questions = [{ id: "q1", prompt: "What is 2+2?", answerKey: "4" }, { id: "q2", prompt: "What is 9-5?", answerKey: "4" }];
  const created = await json(await app.request("/api/assignments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, questions }) }));
  const id = created.assignment.id as string;
  const headers = { "x-teacher-token": created.teacherToken as string };
  await app.request(`/api/assignments/${id}/rubric/generate`, { method: "POST", headers });
  await app.request(`/api/assignments/${id}/rubric/approve`, { method: "POST", headers });
  return { id, code: created.assignment.accessCode as string, headers };
}
async function join(code: string, name = "Student One", pin = "1234") {
  return json(await app.request(`/api/public/${code}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, pin }) }));
}
function answerForm(answer = "4") { const form = new FormData(); form.set("answer", answer); return form; }
async function waitForGrade(studentId: string, token: string, sid: string) {
  let detail: any;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    detail = await json(await app.request(`/api/submissions/${sid}`, { headers: { "x-student-token": token } }));
    if (detail.status === "completed" || detail.status === "failed") return detail;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return detail;
}

describe("per-question flow", () => {
  it("joins, replays naturally, restores progress, and isolates student tokens", async () => {
    const { id, code, headers } = await createApproved();
    const joined = await join(code);
    const studentId = joined.progress.studentId as string;
    const token = joined.studentToken as string;
    const path = `/api/students/${studentId}/submissions/q1`;
    const auth = { "x-student-token": token };
    const submittedResponse = await app.request(path, { method: "POST", headers: auth, body: answerForm() });
    expect(submittedResponse.status).toBe(202);
    const submitted = await json(submittedResponse);
    const duplicateResponse = await app.request(path, { method: "POST", headers: auth, body: answerForm() });
    expect(duplicateResponse.status).toBe(200);
    expect((await json(duplicateResponse)).submissionId).toBe(submitted.submissionId);
    const detail = await waitForGrade(studentId, token, submitted.submissionId);
    expect(detail.status).toBe("completed");
    expect(detail.grade.maxScore).toBe(3);
    expect(detail.questionId).toBe("q1");

    const wrongPin = await app.request(`/api/public/${code}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "student one", pin: "9999" }) });
    expect(wrongPin.status).toBe(401);
    const rejoined = await join(code, "STUDENT ONE", "1234");
    expect(rejoined.progress.answered).toBe(1);
    expect(rejoined.progress.submissions[0].id).toBe(submitted.submissionId);
    expect(rejoined.studentToken).not.toBe(token);

    const other = await join(code, "Student Two", "5678");
    const forbidden = await app.request(`/api/submissions/${submitted.submissionId}`, { headers: { "x-student-token": other.studentToken } });
    expect(forbidden.status).toBe(404);
    const oldToken = await app.request(`/api/submissions/${submitted.submissionId}`, { headers: auth });
    expect(oldToken.status).toBe(404);

    const report = await json(await app.request(`/api/assignments/${id}/submissions`, { headers }));
    expect(report.students).toHaveLength(2);
    expect(report.students[0].answered).toBe(1);
    const { db } = await import("./db");
    const count = db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE student_id=? AND question_id='q1'").get(studentId) as { count: number };
    expect(count.count).toBe(1);
  });

  it("locks after five wrong PINs", async () => {
    const { code } = await createApproved("PIN lock");
    await join(code, "Locked Student", "1234");
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await app.request(`/api/public/${code}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Locked Student", pin: "0000" }) });
      expect(response.status).toBe(401);
    }
    const fifth = await app.request(`/api/public/${code}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Locked Student", pin: "0000" }) });
    expect(fifth.status).toBe(423);
    const correctWhileLocked = await app.request(`/api/public/${code}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Locked Student", pin: "1234" }) });
    expect(correctWhileLocked.status).toBe(423);
  });

  it("creates rubric v2 on edit while the old grade keeps v1", async () => {
    const { id, code, headers } = await createApproved("Versioning");
    const joined = await join(code);
    const studentId = joined.progress.studentId;
    const submitted = await json(await app.request(`/api/students/${studentId}/submissions/q1`, { method: "POST", headers: { "x-student-token": joined.studentToken }, body: answerForm() }));
    const old = await waitForGrade(studentId, joined.studentToken, submitted.submissionId);
    expect(old.rubricVersion).toBe(1);

    const assignment = await json(await app.request(`/api/assignments/${id}`, { headers }));
    const edited = structuredClone(assignment.currentRubric.rubric);
    edited.questions[0].criteria[0].description = "Edited correct reasoning";
    const draftResponse = await app.request(`/api/assignments/${id}/rubric/draft`, { method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ rubric: edited }) });
    expect((await json(draftResponse)).draftRubric.version).toBe(2);
    const approved = await json(await app.request(`/api/assignments/${id}/rubric/approve`, { method: "POST", headers }));
    expect(approved.currentRubric.version).toBe(2);
    const oldTeacherDetail = await json(await app.request(`/api/assignments/${id}/submissions/${submitted.submissionId}`, { headers }));
    expect(oldTeacherDetail.rubricVersion).toBe(1);
    const { db } = await import("./db");
    const pinned = db.prepare("SELECT rubric_version_id FROM submissions WHERE id=?").get(submitted.submissionId) as { rubric_version_id: string };
    expect(pinned.rubric_version_id).toBe(assignment.currentRubric.id);
  });
});

describe("PDF extraction API", () => {
  it("extracts questions from a tiny generated PDF", async () => {
    const stream = "BT /F1 12 Tf 72 720 Td (1. What is 2+2?) Tj 0 -24 Td (2. What is 3+3?) Tj ET";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    let pdf = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const form = new FormData();
    form.set("file", new File([pdf], "tiny.pdf", { type: "application/pdf" }));
    const response = await app.request("/api/extract", { method: "POST", body: form });
    expect(response.status).toBe(200);
    const extracted = await json(response);
    expect(extracted.questions.map((question: any) => question.prompt)).toEqual(["What is 2+2?", "What is 3+3?"]);
  });
});
