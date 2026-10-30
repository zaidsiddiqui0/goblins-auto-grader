import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, rememberAssignment, saveTeacherToken } from "../api.ts";
import type { Question } from "../../shared/schema.ts";
import { Loading, Notice, Stepper } from "../ui.tsx";

let questionNumber = 0;
const newQuestion = (): Question => ({ id: `q-${crypto.randomUUID()}-${questionNumber++}`, prompt: "", answerKey: null });

function splitQuestions(text: string): Question[] {
  const chunks = text
    .split(/^\s*(?:\d+[.)]|Q\d+[.:)])\s+/gim)
    .map((part) => part.trim())
    .filter(Boolean);
  const source = chunks.length > 1 ? chunks : [text.trim()];
  return source.filter(Boolean).map((prompt) => ({ ...newQuestion(), prompt }));
}

export function NewAssignmentPage() {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState<Question[]>([newQuestion()]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"extract" | "save" | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function updateQuestion(id: string, update: Partial<Question>) {
    setQuestions((current) => current.map((question) => question.id === id ? { ...question, ...update } : question));
  }

  async function extractPdf(file: File | undefined) {
    if (!file) return;
    setError("");
    setSuccess("");
    if (file.type !== "application/pdf") {
      setError("Choose a PDF file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("That PDF is too big. The maximum size is 10 MB.");
      return;
    }
    setBusy("extract");
    try {
      const result = await api.extract(file);
      setText(result.text);
      if (result.questions.length) {
        setQuestions(result.questions.map((question) => ({ ...question, answerKey: question.answerKey ?? null })));
        setSuccess(`Extracted ${result.questions.length} question${result.questions.length === 1 ? "" : "s"}. Check them below.`);
      } else {
        setSuccess("Extracted the PDF text. Click “Split into questions” to create question cards.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t extract that PDF.");
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function splitText() {
    setError("");
    setSuccess("");
    if (!text.trim()) {
      setError("Paste or extract some assignment text first.");
      return;
    }
    const split = splitQuestions(text);
    setQuestions(split);
    setSuccess(`Created ${split.length} question${split.length === 1 ? "" : "s"}. Check the wording below.`);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!title.trim()) {
      setError("Give your assignment a title.");
      return;
    }
    if (!questions.length || questions.some((question) => !question.prompt.trim())) {
      setError("Add a prompt to every question, or remove empty questions.");
      return;
    }
    setBusy("save");
    try {
      const cleaned = questions.map((question) => ({
        ...question,
        prompt: question.prompt.trim(),
        answerKey: question.answerKey?.trim() || null,
      }));
      const result = await api.createAssignment(title.trim(), cleaned);
      saveTeacherToken(result.assignment.id, result.teacherToken);
      rememberAssignment(result.assignment);
      navigate(`/t/${result.assignment.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t save the assignment.");
      setBusy(null);
    }
  }

  return (
    <div className="narrow-page">
      <Stepper current={1} />
      <div className="page-heading">
        <p className="eyebrow">Teacher setup</p>
        <h1>Create an assignment</h1>
        <p>Start with the questions students will answer. You can add answer keys or notes to guide the rubric.</p>
      </div>

      <form onSubmit={save}>
        <section className="card form-section">
          <label htmlFor="assignment-title">Assignment title</label>
          <input id="assignment-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Photosynthesis check-in" required />
        </section>

        <section className="card form-section">
          <h2>Import or paste questions</h2>
          <p className="muted">Upload a PDF, or paste numbered questions below. Always check extracted text before continuing.</p>
          <div className="field">
            <label htmlFor="assignment-pdf">Assignment PDF <span className="label-hint">up to 10 MB</span></label>
            <input ref={fileInput} id="assignment-pdf" type="file" accept="application/pdf" disabled={busy !== null} onChange={(event) => void extractPdf(event.target.files?.[0])} />
          </div>
          {busy === "extract" && <Loading>Reading your PDF…</Loading>}
          <div className="field">
            <label htmlFor="question-text">Assignment text</label>
            <textarea id="question-text" rows={7} value={text} onChange={(event) => setText(event.target.value)} placeholder={"1. What is photosynthesis?\n2. Why do plants need sunlight?"} />
          </div>
          <button type="button" className="button secondary" onClick={splitText} disabled={busy !== null}>Split into questions</button>
        </section>

        {success && <Notice tone="success">{success}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}

        <section className="questions-section" aria-labelledby="questions-heading">
          <div className="section-heading">
            <div><p className="eyebrow">Review</p><h2 id="questions-heading">Questions</h2></div>
            <button type="button" className="button secondary" onClick={() => setQuestions((current) => [...current, newQuestion()])}>+ Add question</button>
          </div>
          {questions.map((question, index) => (
            <article className="card question-card" key={question.id}>
              <div className="question-card-heading">
                <h3>Question {index + 1}</h3>
                <button type="button" className="text-button danger" onClick={() => setQuestions((current) => current.filter((item) => item.id !== question.id))} disabled={questions.length === 1}>Remove</button>
              </div>
              <div className="field">
                <label htmlFor={`prompt-${question.id}`}>Question prompt</label>
                <textarea id={`prompt-${question.id}`} rows={3} value={question.prompt} onChange={(event) => updateQuestion(question.id, { prompt: event.target.value })} required />
              </div>
              <div className="field">
                <label htmlFor={`key-${question.id}`}>Answer key / teacher notes <span className="label-hint">optional</span></label>
                <textarea id={`key-${question.id}`} rows={3} value={question.answerKey ?? ""} onChange={(event) => updateQuestion(question.id, { answerKey: event.target.value })} placeholder="Add the expected answer or grading notes." />
              </div>
            </article>
          ))}
        </section>

        <div className="form-actions">
          <button className="button primary large" type="submit" disabled={busy !== null}>{busy === "save" ? "Saving…" : "Save & continue"}</button>
        </div>
      </form>
    </div>
  );
}
