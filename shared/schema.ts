// Single source of truth for data shapes shared by server, web, and load test.
// Change this file deliberately: server/ and web/ both depend on it.
import { z } from "zod";

// ---------- Assignment content (teacher-provided only) ----------
export const Question = z.object({
  id: z.string().min(1), // stable, e.g. "q1"
  prompt: z.string().min(1),
  answerKey: z.string().nullable(), // teacher-provided answer/instructions, if any
});
export type Question = z.infer<typeof Question>;

// ---------- Rubric (generated from assignment content ONLY) ----------
export const Criterion = z.object({
  id: z.string().min(1), // e.g. "q1-c1"
  description: z.string().min(1),
  points: z.number().min(0).max(100),
});
export type Criterion = z.infer<typeof Criterion>;

export const RubricQuestion = z.object({
  questionId: z.string().min(1),
  prompt: z.string(),
  expectedAnswer: z.string().nullable(),
  answerSource: z.enum(["teacher_key", "inferred", "subjective"]),
  criteria: z.array(Criterion).min(1),
  partialCredit: z.string(),
  alternatives: z.array(z.string()),
  commonMistakes: z.array(z.string()),
  needsReview: z.boolean(), // model unsure (e.g. inferred answer) -> teacher should check
  reviewNotes: z.string().nullable(),
});
export type RubricQuestion = z.infer<typeof RubricQuestion>;

export const Rubric = z.object({ questions: z.array(RubricQuestion).min(1) });
export type Rubric = z.infer<typeof Rubric>;

/** maxPoints is always derived in code, never trusted from a model. */
export const questionMax = (q: RubricQuestion) => q.criteria.reduce((s, c) => s + c.points, 0);
export const rubricMax = (r: Rubric) => r.questions.reduce((s, q) => s + questionMax(q), 0);

// ---------- Student work transcription (StudentWorkReader output) ----------
export const Transcription = z.object({
  source: z.enum(["typed", "vision", "pdf_text", "mock"]),
  questions: z.array(
    z.object({
      questionId: z.string(),
      text: z.string(), // "" if not answered
      uncertain: z.boolean(),
      note: z.string().nullable(),
    }),
  ),
  unreadable: z.boolean(),
});
export type Transcription = z.infer<typeof Transcription>;

// ---------- Grader raw model output (validated strictly, then scored in code) ----------
export const GraderOutput = z.object({
  questions: z.array(
    z.object({
      questionId: z.string(),
      criteria: z.array(z.object({ criterionId: z.string(), awarded: z.number(), rationale: z.string() })),
      feedback: z.string(), // student-facing
      needsReview: z.boolean(),
      reviewReason: z.string().nullable(),
    }),
  ),
  overallFeedback: z.string(),
});
export type GraderOutput = z.infer<typeof GraderOutput>;

/** Persisted, code-computed grade. Scores come from code, not model arithmetic. */
export const GradeResult = z.object({
  score: z.number(),
  maxScore: z.number(),
  questions: z.array(
    z.object({
      questionId: z.string(),
      score: z.number(),
      maxScore: z.number(),
      criteria: z.array(z.object({ criterionId: z.string(), awarded: z.number(), max: z.number(), rationale: z.string() })),
      feedback: z.string(),
      needsReview: z.boolean(),
      reviewReason: z.string().nullable(),
    }),
  ),
  overallFeedback: z.string(),
  needsReview: z.boolean(), // true if any question or transcription is uncertain
});
export type GradeResult = z.infer<typeof GradeResult>;

// ---------- Statuses ----------
export const SubmissionStatus = z.enum(["queued", "processing", "completed", "failed"]);
export type SubmissionStatus = z.infer<typeof SubmissionStatus>;
export const TERMINAL: SubmissionStatus[] = ["completed", "failed"];

// ---------- API DTOs ----------
export type RubricVersionDTO = {
  id: string;
  version: number;
  status: "draft" | "approved";
  rubric: Rubric;
  maxScore: number;
  model: string | null; // model that generated the draft (null if hand-written)
  createdAt: string;
  approvedAt: string | null;
};

export type AssignmentDTO = {
  id: string;
  title: string;
  accessCode: string; // 6 chars, students use it at /s/:code
  questions: Question[];
  acceptingSubmissions: boolean; // true once a rubric version is approved
  currentRubric: RubricVersionDTO | null; // latest APPROVED version (used for new submissions)
  draftRubric: RubricVersionDTO | null; // editable draft, if any
  createdAt: string;
};

export type SubmissionSummaryDTO = {
  id: string;
  studentName: string;
  status: SubmissionStatus;
  rubricVersion: number;
  score: number | null; // teacher override if set, else model grade
  maxScore: number | null;
  needsReview: boolean;
  error: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
};

export type SubmissionDetailDTO = SubmissionSummaryDTO & {
  typedAnswers: Record<string, string> | null;
  files: { name: string; mime: string; url: string }[]; // url requires same auth token
  transcription: Transcription | null;
  grade: (GradeResult & { model: string; gradedAt: string }) | null;
  override: { score: number; note: string | null; at: string } | null;
};

export type PublicAssignmentDTO = {
  title: string;
  questions: { id: string; prompt: string }[]; // never includes answer keys or rubric
  acceptingSubmissions: boolean;
};
