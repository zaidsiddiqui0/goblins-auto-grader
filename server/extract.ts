import { extractText, getDocumentProxy } from "unpdf";
import type { Question } from "../shared/schema";

/** Split teacher-provided text without inferring answers. */
export function splitQuestions(input: string): Question[] {
  const text = input.replace(/\r\n?/g, "\n").trim();
  if (!text) return [];

  const lines = text.split("\n");
  const groups: string[][] = [];
  let sawNumber = false;
  for (const line of lines) {
    const match = /^\s*(?:Q(?:uestion)?\s*\d+|\d+[.)])\s*[:\-]?\s*(.*)$/i.exec(line);
    if (match) {
      sawNumber = true;
      groups.push([match[1] ?? ""]);
    } else if (sawNumber && groups.length) {
      groups[groups.length - 1]?.push(line);
    }
  }

  if (!sawNumber) groups.push(lines);
  return groups
    .map((group, index) => {
      const promptLines: string[] = [];
      let answerKey: string | null = null;
      for (const line of group) {
        const answer = /^\s*(?:Answer|Ans)\s*:\s*(.*)$/i.exec(line);
        if (answer) answerKey = answer[1]?.trim() || "";
        else promptLines.push(line);
      }
      return {
        id: `q${index + 1}`,
        prompt: promptLines.join("\n").trim(),
        answerKey,
      };
    })
    .filter((question) => question.prompt.length > 0);
}

export async function extractPdf(data: Uint8Array): Promise<{ text: string; questions: Question[] }> {
  const pdf = await getDocumentProxy(data);
  const extracted = await extractText(pdf, { mergePages: true });
  const text = (Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text).trim();
  return { text, questions: splitQuestions(text) };
}
