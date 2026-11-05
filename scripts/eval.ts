import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { Question, Rubric, type Transcription } from "../shared/schema";
import { scoreGrade } from "../server/grading";
import { llmSpend } from "../server/db";
import { OpenRouterGrader } from "../server/llm/adapters";

const EvalSet = z.object({
  questions: z.array(Question).length(3),
  rubric: Rubric,
  answers: z.array(z.object({ id: z.string(), questionId: z.string(), text: z.string(), expectedScore: z.number().min(0) })).min(12),
});
function percentile50(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.5) - 1)]!;
}
function parseModels(argv: string[]): string[] {
  const models: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--help" || argv[index] === "-h") {
      console.log("Usage: LLM_MODE=real npm run eval -- --model MODEL [--model MODEL ...]");
      return [];
    }
    if (argv[index] !== "--model" || !argv[index + 1]) throw new Error("Each --model needs an OpenRouter model id");
    models.push(argv[++index]!);
  }
  return models.length ? models : [process.env.GRADER_MODEL ?? "anthropic/claude-haiku-5.5"];
}

async function run(): Promise<void> {
  if (process.env.LLM_MODE !== "real") throw new Error("Accuracy eval requires LLM_MODE=real; no model calls were made");
  const models = parseModels(process.argv.slice(2));
  if (!models.length) return;
  const set = EvalSet.parse(JSON.parse(await readFile(new URL("./eval-set.json", import.meta.url), "utf8")));
  const output = [];
  for (const model of models) {
    const grader = new OpenRouterGrader(model);
    const costBefore = llmSpend();
    const predictions = [];
    for (const answer of set.answers) {
      const rubricQuestion = set.rubric.questions.find((question) => question.questionId === answer.questionId);
      if (!rubricQuestion) throw new Error(`No rubric entry for ${answer.questionId}`);
      const rubric = { questions: [rubricQuestion] };
      const transcription: Transcription = {
        source: "typed", unreadable: false,
        questions: [{ questionId: answer.questionId, text: answer.text, uncertain: false, note: null }],
      };
      const started = performance.now();
      const raw = await grader.grade(rubric, transcription, { submissionId: `eval-${answer.id}`, attempt: 1 });
      const latencyMs = performance.now() - started;
      const grade = scoreGrade(rubric, raw, transcription);
      predictions.push({
        answerId: answer.id, questionId: answer.questionId, expectedScore: answer.expectedScore,
        actualScore: grade.score, absoluteError: Math.abs(grade.score - answer.expectedScore), latencyMs,
      });
    }
    const exactMatches = predictions.filter((prediction) => prediction.actualScore === prediction.expectedScore).length;
    const result = {
      model,
      count: predictions.length,
      exactMatchPercent: exactMatches / predictions.length * 100,
      meanAbsoluteError: predictions.reduce((sum, prediction) => sum + prediction.absoluteError, 0) / predictions.length,
      costUsd: llmSpend() - costBefore,
      p50LatencyMs: percentile50(predictions.map((prediction) => prediction.latencyMs)),
      predictions,
    };
    output.push(result);
    console.log(`${model}: exact ${result.exactMatchPercent.toFixed(1)}% | MAE ${result.meanAbsoluteError.toFixed(3)} | cost $${result.costUsd.toFixed(6)} | p50 ${(result.p50LatencyMs / 1000).toFixed(3)}s`);
  }
  const directory = path.resolve("loadtest-results");
  await mkdir(directory, { recursive: true });
  const timestamp = new Date().toISOString();
  const filename = path.join(directory, `eval-${timestamp.replace(/[:.]/g, "-")}.json`);
  await writeFile(filename, `${JSON.stringify({ timestamp, models: output }, null, 2)}\n`);
  console.log(`JSON: ${filename}`);
}

await run().catch((error: unknown) => {
  console.error(`Eval failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
