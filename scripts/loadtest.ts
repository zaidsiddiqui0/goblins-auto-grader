import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AssignmentDTO, StudentProgressDTO, SubmissionDetailDTO, SubmissionStatus, SubmissionSummaryDTO, TeacherReportDTO } from "../shared/schema";

type Mode = "mock" | "real";
type Options = {
  base: string; n: number; concurrency: number; burstMs: number; thinkMs: number;
  dupRate: number; seed: number; timeoutS: number; out: string; real: boolean; maxP95S: number | null;
};
type Metrics = { mode: Mode; queueDepth: number; inFlight: number; peakInFlight: number; retries: number; llm: { costUsd: number } };
type Student = { name: string; pin: string; answers: Record<string, string>; duplicate: boolean; thinkScales: number[] };
type Accepted = {
  id: string; studentId: string; studentName: string; questionId: string;
  submittedAt: number; acceptedAt: number; terminalAt?: number; status?: SubmissionStatus; stuck: boolean;
};
type SubmissionResponse = { submissionId: string; status: SubmissionStatus };

const defaults: Options = {
  base: "http://localhost:3000", n: 30, concurrency: 10, burstMs: 0, thinkMs: 2000,
  dupRate: 0.1, seed: 42, timeoutS: 120, out: "loadtest-results", real: false, maxP95S: null,
};
const questions = [
  { id: "q1", prompt: "What is 2 + 2?", answerKey: "4" },
  { id: "q2", prompt: "What is 9 - 5?", answerKey: "4" },
  { id: "q3", prompt: "What is 6 × 7?", answerKey: "42" },
];
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function usage(): void {
  console.log(`Usage: npm run loadtest -- [options]\n\n` +
    `  --base URL           Server URL (default ${defaults.base})\n` +
    `  --n N                Unique students (default ${defaults.n})\n` +
    `  --concurrency N      Students working concurrently (default ${defaults.concurrency})\n` +
    `  --burst-ms N         Spread student start times over N ms (default 0)\n` +
    `  --think-ms N         Mean think-time between questions, seeded ±50% (default 2000)\n` +
    `  --dup-rate N         Students replaying question 1, from 0 to 1 (default 0.1)\n` +
    `  --seed N             PRNG seed (default 42)\n` +
    `  --timeout-s N        Per-submission terminal timeout (default 120)\n` +
    `  --out PATH           JSON output directory (default loadtest-results)\n` +
    `  --real               Opt in to real models (N <= 10 students)\n` +
    `  --max-p95-s N        Fail if end-to-end p95 exceeds N seconds`);
}
function parseArgs(argv: string[]): Options | null {
  const options = { ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") return null;
    if (flag === "--real") { options.real = true; continue; }
    const value = argv[++index];
    if (!flag?.startsWith("--") || value === undefined) throw new Error(`Missing value for ${flag ?? "unknown flag"}`);
    const numberValue = Number(value);
    switch (flag) {
      case "--base": options.base = value.replace(/\/+$/, ""); break;
      case "--n": options.n = numberValue; break;
      case "--concurrency": options.concurrency = numberValue; break;
      case "--burst-ms": options.burstMs = numberValue; break;
      case "--think-ms": options.thinkMs = numberValue; break;
      case "--dup-rate": options.dupRate = numberValue; break;
      case "--seed": options.seed = numberValue; break;
      case "--timeout-s": options.timeoutS = numberValue; break;
      case "--out": options.out = value; break;
      case "--max-p95-s": options.maxP95S = numberValue; break;
      default: throw new Error(`Unknown flag: ${flag}`);
    }
  }
  if (!options.base) throw new Error("--base is required");
  if (!Number.isInteger(options.n) || options.n < 1) throw new Error("--n must be a positive integer");
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) throw new Error("--concurrency must be a positive integer");
  if (!Number.isFinite(options.burstMs) || options.burstMs < 0) throw new Error("--burst-ms must be >= 0");
  if (!Number.isFinite(options.thinkMs) || options.thinkMs < 0) throw new Error("--think-ms must be >= 0");
  if (!Number.isFinite(options.dupRate) || options.dupRate < 0 || options.dupRate > 1) throw new Error("--dup-rate must be between 0 and 1");
  if (!Number.isInteger(options.seed)) throw new Error("--seed must be an integer");
  if (!Number.isFinite(options.timeoutS) || options.timeoutS <= 0) throw new Error("--timeout-s must be > 0");
  if (!options.out) throw new Error("--out is required");
  if (options.maxP95S !== null && (!Number.isFinite(options.maxP95S) || options.maxP95S <= 0)) throw new Error("--max-p95-s must be > 0");
  return options;
}
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
function makeStudents(options: Options): Student[] {
  const random = mulberry32(options.seed);
  const duplicateCount = Math.floor(options.n * options.dupRate);
  return Array.from({ length: options.n }, (_, index) => {
    const answers: Record<string, string> = {};
    for (const question of questions) answers[question.id] = random() < 0.67 ? question.answerKey : String(Number(question.answerKey) + index + 1);
    return {
      name: `Load Student ${index + 1}-${Math.floor(random() * 1_000_000)}`,
      pin: String(1000 + Math.floor(random() * 9000)), answers,
      thinkScales: questions.slice(1).map(() => 0.5 + random()), duplicate: index < duplicateCount,
    };
  });
}
async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text || "Invalid JSON response" }; }
  if (!response.ok) {
    const message = typeof body === "object" && body && "error" in body ? String(body.error) : `HTTP ${response.status}`;
    throw new Error(`${init?.method ?? "GET"} ${url}: ${message}`);
  }
  return body as T;
}
function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]! * 1000) / 1000;
}
function gitSha(): string {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return "unknown"; }
}

async function run(options: Options): Promise<void> {
  const health = await jsonRequest<{ ok: boolean; mode: Mode }>(`${options.base}/api/health`);
  if (!health.ok || (health.mode !== "mock" && health.mode !== "real")) throw new Error("Invalid health response");
  console.log(`Server mode: ${health.mode}`);
  if (health.mode === "real" && !options.real) throw new Error("Server is in real mode; pass --real to opt in explicitly");
  if (options.real && (health.mode !== "real" || options.n > 10)) throw new Error("--real requires mode=real and --n <= 10 students");
  const baseline = await jsonRequest<Metrics>(`${options.base}/api/metrics`);
  const created = await jsonRequest<{ assignment: AssignmentDTO; teacherToken: string }>(`${options.base}/api/assignments`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: `Load test ${new Date().toISOString()}`, questions }),
  });
  const assignmentId = created.assignment.id;
  const teacherHeaders = { "x-teacher-token": created.teacherToken };
  await jsonRequest<AssignmentDTO>(`${options.base}/api/assignments/${assignmentId}/rubric/generate`, { method: "POST", headers: teacherHeaders });
  await jsonRequest<AssignmentDTO>(`${options.base}/api/assignments/${assignmentId}/rubric/approve`, { method: "POST", headers: teacherHeaders });

  const students = makeStudents(options);
  const accepted: Accepted[] = [];
  const errors: string[] = [];
  let http429 = 0, clientRetries = 0, dupReplays = 0, dupMismatches = 0;
  let peakInFlight = 0, peakQueueDepth = 0, metricsSampleErrors = 0;
  let firstSubmitAt: number | null = null;

  async function post(studentId: string, token: string, questionId: string, answer: string): Promise<SubmissionResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= 3; attempt += 1) {
      const form = new FormData(); form.set("answer", answer);
      let response: Response;
      try {
        response = await fetch(`${options.base}/api/students/${studentId}/submissions/${questionId}`, { method: "POST", headers: { "x-student-token": token }, body: form });
      } catch (error) {
        lastError = error;
        if (attempt < 3) { clientRetries += 1; await delay(100 * 2 ** attempt); continue; }
        break;
      }
      if (response.status === 429) http429 += 1;
      const text = await response.text();
      let body: unknown;
      try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
      if (response.status >= 500) {
        lastError = new Error(`HTTP ${response.status}: ${text}`);
        if (attempt < 3) { clientRetries += 1; await delay(100 * 2 ** attempt); continue; }
        break;
      }
      if (!response.ok) {
        const message = typeof body === "object" && body && "error" in body ? String(body.error) : `HTTP ${response.status}`;
        throw new Error(message);
      }
      const result = body as Partial<SubmissionResponse>;
      if (typeof result.submissionId !== "string") throw new Error("Submission response has no submissionId");
      return result as SubmissionResponse;
    }
    throw lastError instanceof Error ? lastError : new Error("Submission failed");
  }
  async function poll(record: Accepted, token: string): Promise<void> {
    const deadline = record.submittedAt + options.timeoutS * 1000;
    while (Date.now() < deadline) {
      try {
        const detail = await jsonRequest<SubmissionDetailDTO>(`${options.base}/api/submissions/${record.id}`, { headers: { "x-student-token": token } });
        if (detail.status === "completed" || detail.status === "failed") {
          record.status = detail.status; record.terminalAt = Date.now(); return;
        }
        record.status = detail.status;
      } catch { /* Teacher verification below is authoritative. */ }
      await delay(Math.min(250, Math.max(0, deadline - Date.now())));
    }
    record.stuck = true;
  }

  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      try {
        const metrics = await jsonRequest<Metrics>(`${options.base}/api/metrics`);
        peakInFlight = Math.max(peakInFlight, metrics.inFlight);
        peakQueueDepth = Math.max(peakQueueDepth, metrics.queueDepth);
      } catch { metricsSampleErrors += 1; }
      if (sampling) await delay(500);
    }
  })();

  const scheduleStartedAt = Date.now();
  let nextStudent = 0;
  async function studentWorker(): Promise<void> {
    while (true) {
      const index = nextStudent++;
      const student = students[index];
      if (!student) return;
      const offset = students.length === 1 ? 0 : options.burstMs * index / (students.length - 1);
      await delay(Math.max(0, scheduleStartedAt + offset - Date.now()));
      try {
        const joined = await jsonRequest<{ studentToken: string; progress: StudentProgressDTO }>(`${options.base}/api/public/${created.assignment.accessCode}/join`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: student.name, pin: student.pin }),
        });
        const studentId = joined.progress.studentId;
        for (const [questionIndex, question] of questions.entries()) {
          const submittedAt = Date.now();
          firstSubmitAt = firstSubmitAt === null ? submittedAt : Math.min(firstSubmitAt, submittedAt);
          const response = await post(studentId, joined.studentToken, question.id, student.answers[question.id]!);
          const record: Accepted = {
            id: response.submissionId, studentId, studentName: student.name, questionId: question.id,
            submittedAt, acceptedAt: Date.now(), status: response.status, stuck: false,
          };
          accepted.push(record);
          await poll(record, joined.studentToken);
          if (student.duplicate && questionIndex === 0) {
            try {
              const replay = await post(studentId, joined.studentToken, question.id, student.answers[question.id]!);
              if (replay.submissionId === response.submissionId) dupReplays += 1;
              else dupMismatches += 1;
            } catch { dupMismatches += 1; }
          }
          if (questionIndex < questions.length - 1) await delay(options.thinkMs * student.thinkScales[questionIndex]!);
        }
      } catch (error) { if (errors.length < 20) errors.push(error instanceof Error ? error.message : String(error)); }
    }
  }

  await Promise.all(Array.from({ length: Math.min(options.concurrency, options.n) }, () => studentWorker()));
  sampling = false; await sampler;
  const [finalMetrics, teacher] = await Promise.all([
    jsonRequest<Metrics>(`${options.base}/api/metrics`),
    jsonRequest<TeacherReportDTO>(`${options.base}/api/assignments/${assignmentId}/submissions`, { headers: teacherHeaders }),
  ]);
  const rows: SubmissionSummaryDTO[] = teacher.submissions;
  const acceptedIds = new Set(accepted.map((record) => record.id));
  const rowIds = new Set(rows.map((row) => row.id));
  const lost = [...acceptedIds].filter((id) => !rowIds.has(id)).length;
  const duplicated = rows.length - rowIds.size + [...rowIds].filter((id) => !acceptedIds.has(id)).length;
  const stuckIds = new Set(accepted.filter((record) => record.stuck).map((record) => record.id));
  for (const row of rows) if (row.status !== "completed" && row.status !== "failed") stuckIds.add(row.id);
  const completed = rows.filter((row) => row.status === "completed").length;
  const failed = rows.filter((row) => row.status === "failed").length;
  const missingScores = rows.filter((row) => row.status === "completed" && (typeof row.score !== "number" || !Number.isFinite(row.score))).length;
  const lastTerminalAt = Math.max(0, ...accepted.map((record) => record.terminalAt ?? 0));
  const durationS = firstSubmitAt !== null && lastTerminalAt > firstSubmitAt ? (lastTerminalAt - firstSubmitAt) / 1000 : 0;
  const acceptLatencies = accepted.map((record) => record.acceptedAt - record.submittedAt);
  const terminalLatencies = accepted.filter((record) => record.terminalAt !== undefined).map((record) => record.terminalAt! - record.submittedAt);
  const submitAcceptMs = { p50: percentile(acceptLatencies, 0.5), p95: percentile(acceptLatencies, 0.95), p99: percentile(acceptLatencies, 0.99) };
  const submitToTerminalMs = { p50: percentile(terminalLatencies, 0.5), p95: percentile(terminalLatencies, 0.95), p99: percentile(terminalLatencies, 0.99) };
  const p95Exceeded = options.maxP95S !== null && submitToTerminalMs.p95 !== null && submitToTerminalMs.p95 > options.maxP95S * 1000;
  const timestamp = new Date().toISOString();
  const expected = options.n * questions.length;
  const result = {
    timestamp, gitSha: gitSha(), mode: health.mode, parameters: options, assignmentId,
    students: options.n, questionsPerStudent: questions.length, offered: expected, accepted: acceptedIds.size,
    dupReplays, dupMismatches, completed, failed, stuck: stuckIds.size, lost, duplicated, missingScores,
    http429, clientRetries, serverRetries: finalMetrics.retries - baseline.retries,
    throughputCompletedPerS: durationS > 0 ? Math.round(completed / durationS * 1000) / 1000 : 0,
    submitAcceptMs, submitToTerminalMs,
    perSubmission: accepted.map((record) => ({
      submissionId: record.id, studentId: record.studentId, studentName: record.studentName, questionId: record.questionId,
      status: record.status ?? "unknown", acceptMs: record.acceptedAt - record.submittedAt,
      terminalMs: record.terminalAt === undefined ? null : record.terminalAt - record.submittedAt, stuck: record.stuck,
    })),
    peakInFlight, peakQueueDepth, llmCostDeltaUsd: finalMetrics.llm.costUsd - baseline.llm.costUsd, metricsSampleErrors, errors,
  };
  await mkdir(options.out, { recursive: true });
  const filename = `${timestamp.replace(/[:.]/g, "-")}-${health.mode}-n${options.n}.json`;
  const output = path.resolve(options.out, filename);
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  const latency = (value: number | null) => value === null ? "n/a" : `${(value / 1000).toFixed(3)}s`;
  const verdict = acceptedIds.size !== expected || lost > 0 || duplicated > 0 || stuckIds.size > 0 || dupMismatches > 0 || missingScores > 0 || errors.length > 0 || p95Exceeded ? "FAIL" : "PASS";
  console.log("\nMetric                 Value");
  console.log("---------------------  ------------------------------");
  console.log(`Result / mode          ${verdict} / ${health.mode}`);
  console.log(`Students / questions   ${options.n} / ${questions.length}`);
  console.log(`Offered / accepted     ${expected} / ${acceptedIds.size}`);
  console.log(`Dup replay / mismatch  ${dupReplays} / ${dupMismatches}`);
  console.log(`Complete/fail/stuck    ${completed} / ${failed} / ${stuckIds.size}`);
  console.log(`Lost/dup/429           ${lost} / ${duplicated} / ${http429}`);
  console.log(`Client/server retries  ${clientRetries} / ${result.serverRetries}`);
  console.log(`Throughput completed   ${result.throughputCompletedPerS.toFixed(3)}/s`);
  console.log(`Accept p50/p95/p99     ${latency(submitAcceptMs.p50)} / ${latency(submitAcceptMs.p95)} / ${latency(submitAcceptMs.p99)}`);
  console.log(`E2E p50/p95/p99        ${latency(submitToTerminalMs.p50)} / ${latency(submitToTerminalMs.p95)} / ${latency(submitToTerminalMs.p99)}`);
  console.log(`Peak inFlight/queue    ${peakInFlight} / ${peakQueueDepth}`);
  console.log(`LLM cost delta         $${result.llmCostDeltaUsd.toFixed(6)}`);
  console.log(`Params                 n=${options.n} c=${options.concurrency} think=${options.thinkMs}ms burst=${options.burstMs}ms dup=${options.dupRate} seed=${options.seed}`);
  console.log(`Git / timestamp        ${result.gitSha.slice(0, 12)} / ${timestamp}`);
  console.log(`JSON (per-submission)  ${output}`);
  if (verdict === "FAIL") process.exitCode = 1;
}

const options = parseArgs(process.argv.slice(2));
if (options === null) usage();
else await run(options).catch((error: unknown) => { console.error(`Load test failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
