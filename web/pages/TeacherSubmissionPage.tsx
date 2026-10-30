import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, getTeacherToken } from "../api.ts";
import type { AssignmentDTO, SubmissionDetailDTO } from "../../shared/schema.ts";
import { formatDate, Loading, Notice, StatusPill } from "../ui.tsx";

export function TeacherSubmissionPage() {
  const { id = "", sid = "" } = useParams();
  const [assignment, setAssignment] = useState<AssignmentDTO | null>(null);
  const [submission, setSubmission] = useState<SubmissionDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const [score, setScore] = useState("0");
  const [note, setNote] = useState("");

  const applyDetail = useCallback((detail: SubmissionDetailDTO) => {
    setSubmission(detail);
    setScore(String(detail.score ?? detail.grade?.score ?? 0));
  }, []);

  const load = useCallback(async (initial = false) => {
    if (!getTeacherToken(id)) {
      setError("This submission isn't available on this device.");
      setLoading(false);
      return;
    }
    if (initial) setLoading(true);
    try {
      const [nextAssignment, detail] = await Promise.all([api.getAssignment(id), api.getTeacherSubmission(id, sid)]);
      setAssignment(nextAssignment);
      applyDetail(detail);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t load this submission.");
    } finally {
      if (initial) setLoading(false);
    }
  }, [id, sid, applyDetail]);

  useEffect(() => { void load(true); }, [load]);

  useEffect(() => {
    if (submission?.status !== "queued" && submission?.status !== "processing") return;
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [submission?.status, load]);

  async function retry() {
    setRetrying(true);
    setError("");
    setSuccess("");
    try {
      await api.retrySubmission(id, sid);
      await load();
      setSuccess("Submission queued for another grading attempt.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t retry this submission.");
    } finally {
      setRetrying(false);
    }
  }

  async function override(event: FormEvent) {
    event.preventDefault();
    const numericScore = Number(score);
    const max = submission?.maxScore ?? submission?.grade?.maxScore;
    if (!Number.isFinite(numericScore) || numericScore < 0 || (max !== null && max !== undefined && numericScore > max)) {
      setError(`Enter a score from 0 to ${max ?? "the assignment maximum"}.`);
      return;
    }
    setOverriding(true);
    setError("");
    setSuccess("");
    try {
      const detail = await api.overrideScore(id, sid, numericScore, note.trim());
      applyDetail(detail);
      setNote("");
      setSuccess("Score overridden. The original AI grade remains visible below.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t override the score.");
    } finally {
      setOverriding(false);
    }
  }

  if (loading) return <Loading>Loading submission…</Loading>;
  if (!submission) return <Notice tone="error">{error || "Submission not found."}</Notice>;

  const promptFor = (questionId: string) => assignment?.questions.find((question) => question.id === questionId)?.prompt ?? questionId;
  const rubric = assignment?.currentRubric?.version === submission.rubricVersion
    ? assignment.currentRubric.rubric
    : assignment?.draftRubric?.version === submission.rubricVersion ? assignment.draftRubric.rubric : null;
  const criterionFor = (questionId: string, criterionId: string) => rubric?.questions.find((question) => question.questionId === questionId)?.criteria.find((criterion) => criterion.id === criterionId)?.description ?? criterionId;
  const maxScore = submission.maxScore ?? submission.grade?.maxScore;

  return (
    <div className="submission-detail">
      <Link to={`/t/${id}`} className="back-link">← Back to {assignment?.title ?? "assignment"}</Link>
      <div className="page-heading submission-heading">
        <div><p className="eyebrow">Student submission</p><h1>{submission.studentName}</h1><p>Submitted {formatDate(submission.createdAt)} · Rubric v{submission.rubricVersion} · Attempt {submission.attempts}</p></div>
        <StatusPill status={submission.status} />
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {success && <Notice tone="success">{success}</Notice>}
      {submission.needsReview && <Notice tone="warning">This grade needs teacher review.</Notice>}
      {submission.status === "failed" && (
        <Notice tone="error"><strong>Grading failed.</strong> {submission.error || "The work could not be graded automatically."}<div><button type="button" className="button secondary" onClick={() => void retry()} disabled={retrying}>{retrying ? "Retrying…" : "Retry"}</button></div></Notice>
      )}
      {(submission.status === "queued" || submission.status === "processing") && <Loading>Grading is {submission.status}. This page updates automatically.</Loading>}

      <section className="detail-section">
        <h2>Submitted work</h2>
        <div className="work-grid">
          <div className="card">
            <h3>Typed answers</h3>
            {submission.typedAnswers && Object.keys(submission.typedAnswers).length > 0 ? Object.entries(submission.typedAnswers).map(([questionId, answer]) => (
              <div className="answer-block" key={questionId}><h4>{promptFor(questionId)}</h4><p className="preserve-lines">{answer || "No typed answer."}</p></div>
            )) : <p className="muted">No typed answers.</p>}
          </div>
          <div className="card">
            <h3>Uploaded files</h3>
            {submission.files.length ? <div className="file-gallery">{submission.files.map((file, index) => (
              <figure key={`${file.url}-${index}`}>
                {file.mime.startsWith("image/") ? <img src={file.url} alt={`Uploaded student work: ${file.name}`} /> : <div className="pdf-placeholder" aria-hidden="true">PDF</div>}
                <figcaption><a href={file.url} target="_blank" rel="noreferrer">{file.name}</a></figcaption>
              </figure>
            ))}</div> : <p className="muted">No uploaded files.</p>}
          </div>
        </div>
      </section>

      <section className="detail-section">
        <h2>Transcription</h2>
        {submission.transcription ? (
          <div className="card">
            <p className="muted">Source: {submission.transcription.source}</p>
            {submission.transcription.unreadable && <Notice tone="warning">Some or all of this work was unreadable.</Notice>}
            {submission.transcription.questions.map((question) => (
              <div className="answer-block" key={question.questionId}>
                <div className="transcription-heading"><h4>{promptFor(question.questionId)}</h4>{question.uncertain && <span className="badge badge-check">Uncertain</span>}</div>
                <p className="preserve-lines">{question.text || "No answer transcribed."}</p>
                {question.note && <p className="muted">{question.note}</p>}
              </div>
            ))}
          </div>
        ) : <p className="muted">Transcription isn’t available yet.</p>}
      </section>

      {submission.grade && (
        <section className="detail-section">
          <div className="section-heading"><div><p className="eyebrow">AI-assisted grade</p><h2>{submission.grade.score} / {submission.grade.maxScore} points</h2></div>{submission.override && <span className="badge badge-check">Overridden to {submission.override.score}</span>}</div>
          <p className="muted">Model: {submission.grade.model} · Rubric v{submission.rubricVersion} · Graded {formatDate(submission.grade.gradedAt)}</p>
          {submission.grade.questions.map((question, index) => (
            <article className="card grade-question" key={question.questionId}>
              <div className="section-heading"><div><span className="question-number">Question {index + 1}</span><h3>{promptFor(question.questionId)}</h3></div><strong>{question.score} / {question.maxScore}</strong></div>
              {question.needsReview && <Notice tone="warning">Needs review{question.reviewReason ? `: ${question.reviewReason}` : "."}</Notice>}
              <div className="table-wrap"><table><thead><tr><th>Criterion</th><th>Awarded</th><th>Rationale</th></tr></thead><tbody>{question.criteria.map((criterion) => <tr key={criterion.criterionId}><td>{criterionFor(question.questionId, criterion.criterionId)}</td><td><strong>{criterion.awarded} / {criterion.max}</strong></td><td>{criterion.rationale}</td></tr>)}</tbody></table></div>
              <div className="feedback"><h4>Feedback</h4><p className="preserve-lines">{question.feedback}</p></div>
            </article>
          ))}
          <div className="card feedback"><h3>Overall feedback</h3><p className="preserve-lines">{submission.grade.overallFeedback}</p></div>
        </section>
      )}

      {submission.override && <Notice tone="info">Score overridden to {submission.override.score} on {formatDate(submission.override.at)}.{submission.override.note ? ` Note: ${submission.override.note}` : ""}</Notice>}

      {(submission.status === "completed" || submission.status === "failed") && (
        <section className="card override-panel">
          <h2>Override score</h2>
          <p className="muted">Use your professional judgment. This changes the reported score without silently regrading the work.</p>
          <form onSubmit={override} className="override-form">
            <div className="field"><label htmlFor="override-score">New score{maxScore !== null && maxScore !== undefined ? ` (0–${maxScore})` : ""}</label><input id="override-score" type="number" min={0} max={maxScore ?? undefined} step="any" value={score} onChange={(event) => setScore(event.target.value)} required /></div>
            <div className="field override-note"><label htmlFor="override-note">Note <span className="label-hint">optional</span></label><textarea id="override-note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why are you changing this score?" /></div>
            <button type="submit" className="button primary" disabled={overriding}>{overriding ? "Saving…" : "Override score"}</button>
          </form>
        </section>
      )}
    </div>
  );
}
