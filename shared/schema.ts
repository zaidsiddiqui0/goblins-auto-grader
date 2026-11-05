// Single source of truth for data shapes shared by server, web, and scripts.
import { z } from "zod";

// ---------- Assignment content (teacher-provided only) ----------
export const Question = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  answerKey: z.string().nullable(),
});
export type Question = z.infer<typeof Question>;

// ---------- Rubric (generated from assignment content ONLY) ----------
export const Criterion = z.object({
  id: z.string().min(1),
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
  needsReview: z.boolean(),
  reviewNotes: z.string().nullable(),
});
export type RubricQuestion = z.infer<typeof RubricQuestion>;

export const Rubric = z.object({ questions: z.array(RubricQuestion).min(1) });
export type Rubric = z.infer<typeof Rubric>;
export const questionMax = (q: RubricQuestion) => q.criteria.reduce((s, c) => s + c.points, 0);
export const rubricMax = (r: Rubric) => r.questions.reduce((s, q) => s + questionMax(q), 0);

// ---------- One-question student work and grading ----------
export const Transcription = z.object({
  source: z.enum(["typed", "vision", "pdf_text", "mock"]),
  questions: z.array(z.object({
    questionId: z.string(),
    text: z.string(),
    uncertain: z.boolean(),
    note: z.string().nullable(),
  })).length(1),
  unreadable: z.boolean(),
});
export type Transcription = z.infer<typeof Transcription>;

export const GraderOutput = z.object({
  questions: z.array(z.object({
    questionId: z.string(),
    criteria: z.array(z.object({ criterionId: z.string(), awarded: z.number(), rationale: z.string() })),
    feedback: z.string(),
    needsReview: z.boolean(),
    reviewReason: z.string().nullable(),
  })).length(1),
  overallFeedback: z.string(),
});
export type GraderOutput = z.infer<typeof GraderOutput>;

export const GradeResult = z.object({
  score: z.number(),
  maxScore: z.number(),
  questions: z.array(z.object({
    questionId: z.string(),
    score: z.number(),
    maxScore: z.number(),
    criteria: z.array(z.object({ criterionId: z.string(), awarded: z.number(), max: z.number(), rationale: z.string() })),
    feedback: z.string(),
    needsReview: z.boolean(),
    reviewReason: z.string().nullable(),
  })).length(1),
  overallFeedback: z.string(),
  needsReview: z.boolean(),
});
export type GradeResult = z.infer<typeof GradeResult>;

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
  model: string | null;
  createdAt: string;
  approvedAt: string | null;
};

export type AssignmentDTO = {
  id: string;
  title: string;
  accessCode: string;
  questions: Question[];
  acceptingSubmissions: boolean;
  currentRubric: RubricVersionDTO | null;
  draftRubric: RubricVersionDTO | null;
  createdAt: string;
};

export type PublicAssignmentDTO = {
  title: string;
  questions: { id: string; prompt: string }[];
  acceptingSubmissions: boolean;
};

export type SubmissionSummaryDTO = {
  id: string;
  studentId: string;
  studentName: string;
  questionId: string;
  status: SubmissionStatus;
  rubricVersion: number;
  score: number | null;
  maxScore: number | null;
  needsReview: boolean;
  error: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
};

export type SubmissionDetailDTO = SubmissionSummaryDTO & {
  typedAnswer: string | null;
  files: { name: string; mime: string; url: string }[];
  transcription: Transcription | null;
  grade: (GradeResult & { model: string; gradedAt: string }) | null;
  override: { score: number; note: string | null; at: string } | null;
};

export type StudentProgressDTO = {
  studentId: string;
  studentName: string;
  classCode: string;
  assignment: PublicAssignmentDTO;
  submissions: SubmissionSummaryDTO[];
  answered: number;
  totalScore: number;
  maxScore: number;
  complete: boolean;
};

export type TeacherStudentReportDTO = {
  studentId: string;
  studentName: string;
  answered: number;
  totalScore: number;
  maxScore: number;
  questions: Record<string, SubmissionSummaryDTO | null>;
};

export type TeacherReportDTO = {
  students: TeacherStudentReportDTO[];
  submissions: SubmissionSummaryDTO[];
  counts: Record<SubmissionStatus, number>;
};
