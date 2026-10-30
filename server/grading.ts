import {
  GraderOutput,
  Rubric,
  Transcription,
  rubricMax,
  type GradeResult,
} from "../shared/schema";
import { InvalidOutput } from "./llm/openrouter";

function indexById<T extends { questionId: string }>(items: T[], label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    if (result.has(item.questionId)) throw new InvalidOutput(`Duplicate ${label} id: ${item.questionId}`);
    result.set(item.questionId, item);
  }
  return result;
}

/** Validate model selections and calculate every score in code. */
export function scoreGrade(rubricInput: unknown, outputInput: unknown, transcriptionInput: unknown): GradeResult {
  const rubric = Rubric.parse(rubricInput);
  const output = GraderOutput.parse(outputInput);
  const transcription = Transcription.parse(transcriptionInput);
  const outputQuestions = indexById(output.questions, "question");
  const transcribedQuestions = indexById(transcription.questions, "transcription question");
  const rubricIds = new Set(rubric.questions.map((question) => question.questionId));

  for (const id of outputQuestions.keys()) {
    if (!rubricIds.has(id)) throw new InvalidOutput(`Unknown question id: ${id}`);
  }
  for (const id of transcribedQuestions.keys()) {
    if (!rubricIds.has(id)) throw new InvalidOutput(`Unknown transcription question id: ${id}`);
  }

  const questions: GradeResult["questions"] = rubric.questions.map((rubricQuestion) => {
    const awardedQuestion = outputQuestions.get(rubricQuestion.questionId);
    const transcribed = transcribedQuestions.get(rubricQuestion.questionId);
    if (!awardedQuestion) throw new InvalidOutput(`Missing question: ${rubricQuestion.questionId}`);
    if (!transcribed) throw new InvalidOutput(`Missing transcription question: ${rubricQuestion.questionId}`);

    const expectedCriteria = new Map(rubricQuestion.criteria.map((criterion) => [criterion.id, criterion]));
    const actualCriteria = new Map<string, (typeof awardedQuestion.criteria)[number]>();
    for (const criterion of awardedQuestion.criteria) {
      if (!expectedCriteria.has(criterion.criterionId)) {
        throw new InvalidOutput(`Unknown criterion id: ${criterion.criterionId}`);
      }
      if (actualCriteria.has(criterion.criterionId)) {
        throw new InvalidOutput(`Duplicate criterion id: ${criterion.criterionId}`);
      }
      actualCriteria.set(criterion.criterionId, criterion);
    }

    const criteria = rubricQuestion.criteria.map((criterion) => {
      const actual = actualCriteria.get(criterion.id);
      if (!actual) throw new InvalidOutput(`Missing criterion: ${criterion.id}`);
      return {
        criterionId: criterion.id,
        awarded: Math.max(0, Math.min(criterion.points, actual.awarded)),
        max: criterion.points,
        rationale: actual.rationale,
      };
    });
    const transcriptionReview = transcription.unreadable || transcribed.uncertain;
    return {
      questionId: rubricQuestion.questionId,
      score: criteria.reduce((sum, criterion) => sum + criterion.awarded, 0),
      maxScore: rubricQuestion.criteria.reduce((sum, criterion) => sum + criterion.points, 0),
      criteria,
      feedback: awardedQuestion.feedback,
      needsReview: awardedQuestion.needsReview || transcriptionReview,
      reviewReason:
        awardedQuestion.reviewReason ??
        (transcriptionReview ? transcribed.note ?? "Student work was uncertain or unreadable." : null),
    };
  });

  return {
    score: questions.reduce((sum, question) => sum + question.score, 0),
    maxScore: rubricMax(rubric),
    questions,
    overallFeedback: output.overallFeedback,
    needsReview: transcription.unreadable || questions.some((question) => question.needsReview),
  };
}
