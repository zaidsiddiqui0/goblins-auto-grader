import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, getStudentToken } from "../api.ts";
import type { SubmissionDetailDTO } from "../../shared/schema.ts";
import { Loading, Notice, StatusPill } from "../ui.tsx";

export function ResultPage() {
  const { sid = "" } = useParams();
  const hasToken = Boolean(getStudentToken(sid));
  const [submission, setSubmission] = useState<SubmissionDetailDTO | null>(null);
  const [loading, setLoading] = useState(hasToken);
  const [error, setError] = useState("");

  const load = useCallback(async (initial = false) => {
    if (!getStudentToken(sid)) { setLoading(false); return; }
    if (initial) setLoading(true);
    try {
      const next = await api.getStudentSubmission(sid);
      setSubmission(next);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t load your result.");
    } finally {
      if (initial) setLoading(false);
    }
  }, [sid]);

  useEffect(() => { void load(true); }, [load]);

  useEffect(() => {
    if (submission?.status !== "queued" && submission?.status !== "processing") return;
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [submission?.status, load]);

  if (!hasToken) return <div className="card centered-message"><h1>Result unavailable</h1><p>This result isn't available on this device.</p></div>;
  if (loading) return <Loading>Opening your result…</Loading>;
  if (!submission) return <Notice tone="error">{error || "This result isn't available on this device."}</Notice>;

  return (
    <div className="narrow-page result-page">
      <div className="page-heading">
        <p className="eyebrow">Your submission</p>
        <h1>{submission.status === "completed" ? "Your feedback is ready" : submission.status === "failed" ? "Grading needs a hand" : "Your work is in"}</h1>
        <StatusPill status={submission.status} />
      </div>
      {error && <Notice tone="error">{error} We’ll keep trying while this page is open.</Notice>}

      {(submission.status === "queued" || submission.status === "processing") && (
        <section className="card waiting-panel">
          <Loading>{submission.status === "queued" ? "Your work is waiting to be graded." : "Your teacher’s rubric is being used to grade your work."}</Loading>
          <p>This usually takes a little while. This page updates automatically, so you can stay here.</p>
        </section>
      )}

      {submission.status === "failed" && <Notice tone="warning">We couldn't grade this automatically. Your teacher can see it.</Notice>}

      {submission.status === "completed" && (
        <>
          <section className="card score-card">
            <p className="eyebrow">Your score</p>
            <div className="big-score">{submission.score ?? submission.grade?.score ?? 0}<span> / {submission.maxScore ?? submission.grade?.maxScore ?? "—"}</span></div>
            {submission.needsReview && <Notice tone="warning">Your teacher may review this grade.</Notice>}
          </section>
          {submission.grade ? (
            <section className="result-feedback" aria-label="Question feedback">
              <h2>Feedback by question</h2>
              {submission.grade.questions.map((question, index) => (
                <article className="card" key={question.questionId}>
                  <div className="section-heading"><h3>Question {index + 1}</h3><strong>{question.score} / {question.maxScore}</strong></div>
                  <p className="preserve-lines">{question.feedback}</p>
                  {question.needsReview && <span className="badge badge-check">Teacher review possible</span>}
                </article>
              ))}
              <article className="card overall-feedback"><h2>Overall feedback</h2><p className="preserve-lines">{submission.grade.overallFeedback}</p></article>
            </section>
          ) : <p className="muted">Detailed feedback isn’t available for this grade.</p>}
        </>
      )}
    </div>
  );
}
