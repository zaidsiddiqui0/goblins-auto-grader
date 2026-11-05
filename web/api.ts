import type {
  AssignmentDTO,
  PublicAssignmentDTO,
  Question,
  Rubric,
  StudentProgressDTO,
  SubmissionDetailDTO,
  SubmissionStatus,
  SubmissionSummaryDTO,
  TeacherReportDTO,
} from "../shared/schema.ts";

const teacherKey = (id: string) => `goblins.teacher.${id}`;
const studentKey = (id: string) => `goblins.student.${id}`;
const assignmentListKey = "goblins.assignments";
export type LocalAssignment = { id: string; title: string };

export function saveTeacherToken(id: string, token: string) { localStorage.setItem(teacherKey(id), token); }
export function getTeacherToken(id: string) { return localStorage.getItem(teacherKey(id)); }
export function saveStudentToken(id: string, token: string) { localStorage.setItem(studentKey(id), token); }
export function getStudentToken(id: string) { return localStorage.getItem(studentKey(id)); }

export function getLocalAssignments(): LocalAssignment[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(assignmentListKey) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is LocalAssignment => typeof item === "object" && item !== null && typeof (item as LocalAssignment).id === "string" && typeof (item as LocalAssignment).title === "string");
  } catch { return []; }
}
export function rememberAssignment(assignment: { id: string; title: string }) {
  const rest = getLocalAssignments().filter((item) => item.id !== assignment.id);
  localStorage.setItem(assignmentListKey, JSON.stringify([{ id: assignment.id, title: assignment.title }, ...rest]));
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(path, init); }
  catch { throw new ApiError("Network error. Check your connection and try again.", 0); }
  const body = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new ApiError(body?.error ?? `Request failed (${response.status}).`, response.status);
  return body as T;
}
function json(method: string, body?: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}
function teacherCall<T>(id: string, path: string, init?: RequestInit): Promise<T> {
  const token = getTeacherToken(id);
  if (!token) return Promise.reject(new ApiError("This assignment isn't available on this device.", 401));
  const headers = new Headers(init?.headers);
  headers.set("x-teacher-token", token);
  return request<T>(path, { ...init, headers });
}
function studentCall<T>(studentId: string, path: string, init?: RequestInit): Promise<T> {
  const token = getStudentToken(studentId);
  if (!token) return Promise.reject(new ApiError("Join with your name and PIN first.", 401));
  const headers = new Headers(init?.headers);
  headers.set("x-student-token", token);
  return request<T>(path, { ...init, headers });
}

export const api = {
  createAssignment(title: string, questions: Question[]) {
    return request<{ assignment: AssignmentDTO; teacherToken: string }>("/api/assignments", json("POST", { title, questions }));
  },
  extract(file: File) {
    const form = new FormData(); form.append("file", file);
    return request<{ text: string; questions: Question[] }>("/api/extract", { method: "POST", body: form });
  },
  getAssignment(id: string) { return teacherCall<AssignmentDTO>(id, `/api/assignments/${id}`); },
  generateRubric(id: string) { return teacherCall<AssignmentDTO>(id, `/api/assignments/${id}/rubric/generate`, json("POST")); },
  saveRubric(id: string, rubric: Rubric) { return teacherCall<AssignmentDTO>(id, `/api/assignments/${id}/rubric/draft`, json("PUT", { rubric })); },
  approveRubric(id: string) { return teacherCall<AssignmentDTO>(id, `/api/assignments/${id}/rubric/approve`, json("POST")); },
  getSubmissions(id: string) { return teacherCall<TeacherReportDTO>(id, `/api/assignments/${id}/submissions`); },
  getTeacherSubmission(id: string, sid: string) { return teacherCall<SubmissionDetailDTO>(id, `/api/assignments/${id}/submissions/${sid}`); },
  retrySubmission(id: string, sid: string) { return teacherCall<SubmissionSummaryDTO>(id, `/api/assignments/${id}/submissions/${sid}/retry`, json("POST")); },
  overrideScore(id: string, sid: string, score: number, note: string) {
    return teacherCall<SubmissionDetailDTO>(id, `/api/assignments/${id}/submissions/${sid}/override`, json("POST", { score, note }));
  },
  getPublicAssignment(code: string) { return request<PublicAssignmentDTO>(`/api/public/${encodeURIComponent(code)}`); },
  joinStudent(code: string, name: string, pin: string) {
    return request<{ studentToken: string; progress: StudentProgressDTO }>(`/api/public/${encodeURIComponent(code)}/join`, json("POST", { name, pin }));
  },
  getStudentProgress(studentId: string) { return studentCall<StudentProgressDTO>(studentId, `/api/students/${studentId}/progress`); },
  getStudentSubmission(studentId: string, sid: string) { return studentCall<SubmissionDetailDTO>(studentId, `/api/submissions/${sid}`); },
};

type CreatedSubmission = { submissionId: string; status: SubmissionStatus };
export function submitStudentWork(
  studentId: string,
  questionId: string,
  data: { answer: string; file: File | null },
  onProgress: (percent: number) => void,
): Promise<CreatedSubmission> {
  return new Promise((resolve, reject) => {
    const token = getStudentToken(studentId);
    if (!token) { reject(new ApiError("Join with your name and PIN first.", 401)); return; }
    const form = new FormData();
    form.append("answer", data.answer);
    if (data.file) form.append("file", data.file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/students/${encodeURIComponent(studentId)}/submissions/${encodeURIComponent(questionId)}`);
    xhr.setRequestHeader("x-student-token", token);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    xhr.onerror = () => reject(new ApiError("Network error. Your answer is still here—try submitting again.", 0));
    xhr.onabort = () => reject(new ApiError("Upload cancelled. Try again.", 0));
    xhr.onload = () => {
      let body: (Partial<CreatedSubmission> & { error?: string }) | null = null;
      try { body = JSON.parse(xhr.responseText || "null") as (Partial<CreatedSubmission> & { error?: string }) | null; }
      catch { reject(new ApiError("The server returned an invalid response. Try again.", xhr.status)); return; }
      if (xhr.status < 200 || xhr.status >= 300) reject(new ApiError(body?.error ?? `Submission failed (${xhr.status}).`, xhr.status));
      else if (!body?.submissionId || !body.status) reject(new ApiError("The server returned an incomplete response. Try again.", xhr.status));
      else resolve({ submissionId: body.submissionId, status: body.status });
    };
    xhr.send(form);
  });
}
