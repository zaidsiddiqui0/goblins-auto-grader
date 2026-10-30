import { describe, expect, it } from "vitest";
import { scoreGrade } from "./grading";
import { InvalidOutput } from "./llm/openrouter";

const rubric = {
  questions: [{
    questionId: "q1",
    prompt: "Solve",
    expectedAnswer: "4",
    answerSource: "teacher_key",
    criteria: [
      { id: "c1", description: "Answer", points: 2 },
      { id: "c2", description: "Work", points: 1 },
    ],
    partialCredit: "Partial credit",
    alternatives: [],
    commonMistakes: [],
    needsReview: false,
    reviewNotes: null,
  }],
};
const transcription = {
  source: "typed",
  questions: [{ questionId: "q1", text: "2+2=4", uncertain: false, note: null }],
  unreadable: false,
};
const output = {
  questions: [{
    questionId: "q1",
    criteria: [
      { criterionId: "c1", awarded: 99, rationale: "Correct" },
      { criterionId: "c2", awarded: -4, rationale: "No work" },
    ],
    feedback: "Good answer",
    needsReview: false,
    reviewReason: null,
  }],
  overallFeedback: "Good",
};

describe("scoreGrade", () => {
  it("clamps awards and calculates totals in code", () => {
    const grade = scoreGrade(rubric, output, transcription);
    expect(grade.score).toBe(2);
    expect(grade.maxScore).toBe(3);
    expect(grade.questions[0]?.criteria.map((criterion) => criterion.awarded)).toEqual([2, 0]);
    expect(grade.needsReview).toBe(false);
  });

  it("rejects a missing criterion", () => {
    const missing = { ...output, questions: [{ ...output.questions[0]!, criteria: [output.questions[0]!.criteria[0]!] }] };
    expect(() => scoreGrade(rubric, missing, transcription)).toThrow(InvalidOutput);
  });

  it("rejects unknown question and criterion ids", () => {
    const unknownQuestion = { ...output, questions: [{ ...output.questions[0]!, questionId: "other" }] };
    expect(() => scoreGrade(rubric, unknownQuestion, transcription)).toThrow("Unknown question");
    const unknownCriterion = {
      ...output,
      questions: [{
        ...output.questions[0]!,
        criteria: [{ ...output.questions[0]!.criteria[0]!, criterionId: "other" }, output.questions[0]!.criteria[1]!],
      }],
    };
    expect(() => scoreGrade(rubric, unknownCriterion, transcription)).toThrow("Unknown criterion");
  });

  it("marks uncertain or unreadable transcriptions for review", () => {
    const uncertain = { ...transcription, questions: [{ ...transcription.questions[0]!, uncertain: true }] };
    expect(scoreGrade(rubric, output, uncertain).needsReview).toBe(true);
    expect(scoreGrade(rubric, output, { ...transcription, unreadable: true }).needsReview).toBe(true);
  });
});
