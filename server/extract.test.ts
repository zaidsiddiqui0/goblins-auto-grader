import { describe, expect, it } from "vitest";
import { splitQuestions } from "./extract";

describe("splitQuestions", () => {
  it("splits numbered variants and captures explicit answer keys", () => {
    expect(splitQuestions("1. Two plus two?\nAnswer: 4\n2) Five minus one?\nAns: 4\nQ3: Name a triangle.")).toEqual([
      { id: "q1", prompt: "Two plus two?", answerKey: "4" },
      { id: "q2", prompt: "Five minus one?", answerKey: "4" },
      { id: "q3", prompt: "Name a triangle.", answerKey: null },
    ]);
  });

  it("returns all unnumbered text as one question", () => {
    expect(splitQuestions("Explain photosynthesis.\nInclude the inputs and outputs.")).toEqual([
      { id: "q1", prompt: "Explain photosynthesis.\nInclude the inputs and outputs.", answerKey: null },
    ]);
  });

  it("keeps multiline prompts with their numbered question", () => {
    expect(splitQuestions("Q1 Solve x+2=4.\nShow your work.\nQ2 Explain why.")).toEqual([
      { id: "q1", prompt: "Solve x+2=4.\nShow your work.", answerKey: null },
      { id: "q2", prompt: "Explain why.", answerKey: null },
    ]);
  });
});
