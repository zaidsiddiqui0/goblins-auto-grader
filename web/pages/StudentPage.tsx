import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, saveStudentToken, submitStudentWork } from "../api.ts";
import type { PublicAssignmentDTO } from "../../shared/schema.ts";
import { Loading, Notice } from "../ui.tsx";

type Attachment = { file: File; preview: string | null };
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function StudentPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const idempotencyKey = useRef(crypto.randomUUID());
  const fileInput = useRef<HTMLInputElement>(null);
  const [assignment, setAssignment] = useState<PublicAssignmentDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const attachmentsRef = useRef<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  attachmentsRef.current = attachments;

  useEffect(() => {
    let active = true;
    api.getPublicAssignment(code.toUpperCase())
      .then((next) => {
        if (!active) return;
        setAssignment(next);
        setAnswers(Object.fromEntries(next.questions.map((question) => [question.id, ""])));
      })
      .catch((cause) => { if (active) setLoadError(cause instanceof Error ? cause.message : "Couldn’t open this assignment."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [code]);

  useEffect(() => () => {
    attachmentsRef.current.forEach((attachment) => { if (attachment.preview) URL.revokeObjectURL(attachment.preview); });
  }, []);

  function addFiles(selected: File[]) {
    setError("");
    if (fileInput.current) fileInput.current.value = "";
    if (!selected.length) return;
    const files = [...attachments.map((item) => item.file), ...selected];
    if (files.some((file) => file.type !== "application/pdf" && !IMAGE_TYPES.has(file.type))) {
      setError("Use JPG, PNG, or WebP photos, or a PDF.");
      return;
    }
    if (files.some((file) => file.type === "application/pdf") && files.length > 1) {
      setError("Upload either one PDF or up to five photos—not both.");
      return;
    }
    if (files.filter((file) => IMAGE_TYPES.has(file.type)).length > 5) {
      setError("You can attach up to five photos.");
      return;
    }
    const oversizedImage = files.find((file) => IMAGE_TYPES.has(file.type) && file.size > 8 * 1024 * 1024);
    if (oversizedImage) {
      setError(`${oversizedImage.name} is too big. Photos must be 8 MB or smaller.`);
      return;
    }
    const oversizedPdf = files.find((file) => file.type === "application/pdf" && file.size > 10 * 1024 * 1024);
    if (oversizedPdf) {
      setError(`${oversizedPdf.name} is too big. PDFs must be 10 MB or smaller.`);
      return;
    }
    setAttachments((current) => [...current, ...selected.map((file) => ({ file, preview: IMAGE_TYPES.has(file.type) ? URL.createObjectURL(file) : null }))]);
  }

  function removeFile(index: number) {
    setAttachments((current) => {
      const removed = current[index];
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!assignment?.acceptingSubmissions) {
      setError("This assignment isn’t accepting submissions yet.");
      return;
    }
    if (!name.trim()) {
      setError("Enter your name so your teacher can identify your work.");
      return;
    }
    if (!attachments.length && !Object.values(answers).some((answer) => answer.trim())) {
      setError("Type at least one answer or attach your work before submitting.");
      return;
    }
    setSending(true);
    setProgress(0);
    try {
      const result = await submitStudentWork(code.toUpperCase(), {
        studentName: name.trim(),
        idempotencyKey: idempotencyKey.current,
        answers,
        files: attachments.map((attachment) => attachment.file),
      }, setProgress);
      saveStudentToken(result.submissionId, result.studentToken);
      navigate(`/r/${result.submissionId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t submit your work. Try again.");
      setSending(false);
    }
  }

  if (loading) return <Loading>Opening your assignment…</Loading>;
  if (!assignment) return <Notice tone="error">{loadError || "Assignment not found. Check the class code with your teacher."}</Notice>;

  return (
    <div className="narrow-page student-page">
      <div className="page-heading">
        <p className="eyebrow">Class code {code.toUpperCase()}</p>
        <h1>{assignment.title}</h1>
        <p>Answer the questions below. You can type, attach photos or a PDF of your work, or do both.</p>
      </div>
      {!assignment.acceptingSubmissions && <Notice tone="warning">This assignment isn’t accepting submissions yet. Check back after your teacher publishes it.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <form onSubmit={submit}>
        <section className="card form-section">
          <label htmlFor="student-name">Your name</label>
          <input id="student-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required disabled={sending} />
        </section>
        <section className="student-questions" aria-label="Assignment questions">
          {assignment.questions.map((question, index) => (
            <div className="card student-question" key={question.id}>
              <label htmlFor={`answer-${question.id}`}><span className="question-number">Question {index + 1}</span><span>{question.prompt}</span></label>
              <textarea id={`answer-${question.id}`} rows={6} value={answers[question.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder="Type your answer here…" disabled={sending} />
            </div>
          ))}
        </section>

        <section className="card upload-panel">
          <h2>Attach your work <span className="label-hint">optional if you typed answers</span></h2>
          <p className="muted">Up to 5 JPG, PNG, or WebP photos (8 MB each), or 1 PDF (10 MB).</p>
          <div className="field"><label htmlFor="student-files">Photos or PDF</label><input ref={fileInput} id="student-files" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple onChange={(event) => addFiles(Array.from(event.target.files ?? []))} disabled={sending} /></div>
          {attachments.length > 0 && <div className="attachment-grid">{attachments.map((attachment, index) => (
            <figure className="attachment" key={`${attachment.file.name}-${attachment.file.lastModified}`}>
              {attachment.preview ? <img src={attachment.preview} alt={`Preview of ${attachment.file.name}`} /> : <div className="pdf-placeholder" aria-hidden="true">PDF</div>}
              <figcaption>{attachment.file.name}</figcaption>
              <button type="button" className="text-button danger" onClick={() => removeFile(index)} disabled={sending}>Remove</button>
            </figure>
          ))}</div>}
        </section>

        {sending && <div className="upload-progress" role="status"><label htmlFor="upload-progress">Uploading your work: {progress}%</label><progress id="upload-progress" max={100} value={progress} /></div>}
        <button className="button primary large submit-work" type="submit" disabled={sending || !assignment.acceptingSubmissions}>{sending ? "Submitting…" : "Submit my work"}</button>
        <p className="muted submit-note">You’ll get a private result link on this device. Don’t close the page until the upload finishes.</p>
      </form>
    </div>
  );
}
