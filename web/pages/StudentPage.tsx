import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { api, pollWithBackoff, saveStudentToken, submitStudentWork } from "../api.ts";
import type { PublicAssignmentDTO, StudentProgressDTO, SubmissionDetailDTO } from "../../shared/schema.ts";
import { Loading, Notice, StatusPill } from "../ui.tsx";
import { Whiteboard, type WhiteboardHandle } from "../Whiteboard.tsx";

type Session = { studentId: string; token: string; progress: StudentProgressDTO };

export function StudentPage() {
  const { code = "" } = useParams();
  const active = useRef(true);
  const pollController = useRef<AbortController | null>(null);
  const boardRef = useRef<WhiteboardHandle>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [assignment, setAssignment] = useState<PublicAssignmentDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [joining, setJoining] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [submission, setSubmission] = useState<SubmissionDetailDTO | null>(null);
  const [finished, setFinished] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    active.current = true;
    api.getPublicAssignment(code.toUpperCase())
      .then((next) => { if (active.current) setAssignment(next); })
      .catch((cause) => { if (active.current) setLoadError(cause instanceof Error ? cause.message : "Couldn’t open this assignment."); })
      .finally(() => { if (active.current) setLoading(false); });
    return () => { active.current = false; pollController.current?.abort(); };
  }, [code]);

  async function pollSubmission(studentId: string, submissionId: string) {
    pollController.current?.abort();
    const controller = new AbortController();
    pollController.current = controller;
    try {
      const detail = await pollWithBackoff(async () => {
        const next = await api.getStudentSubmission(studentId, submissionId);
        if (active.current && !controller.signal.aborted) setSubmission(next);
        return next;
      }, (next) => next.status === "completed" || next.status === "failed", {
        signal: controller.signal,
        onError: (cause) => { if (active.current) setError(cause instanceof Error ? cause.message : "Couldn’t load your grade."); },
      });
      if (!detail || !active.current || controller.signal.aborted) return;
      const nextProgress = await api.getStudentProgress(studentId);
      if (active.current) setSession((current) => current ? { ...current, progress: nextProgress } : current);
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : "Couldn’t load your grade.");
    }
  }

  function openProgress(next: StudentProgressDTO, token: string) {
    setSession({ studentId: next.studentId, token, progress: next });
    const pending = next.submissions.find((item) => item.status === "queued" || item.status === "processing");
    const nextIndex = next.assignment.questions.findIndex((question) => !next.submissions.some((item) => item.questionId === question.id));
    if (pending) {
      setCurrentIndex(next.assignment.questions.findIndex((question) => question.id === pending.questionId));
      void pollSubmission(next.studentId, pending.id);
    } else if (nextIndex === -1) setFinished(true);
    else setCurrentIndex(nextIndex);
  }

  async function join(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!name.trim() || !/^\d{4}$/.test(pin)) { setError("Enter your name and choose a 4-digit PIN."); return; }
    setJoining(true);
    try {
      const result = await api.joinStudent(code.toUpperCase(), name.trim(), pin);
      saveStudentToken(result.progress.studentId, result.studentToken);
      openProgress(result.progress, result.studentToken);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn’t join this assignment."); }
    finally { setJoining(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!assignment || !session) return;
    const question = assignment.questions[currentIndex];
    if (!question) return;
    setError("");
    setSending(true); setProgress(0); setSubmission(null);
    try {
      const file = photo ?? await boardRef.current?.exportPng() ?? null;
      if (!file && !answer.trim()) throw new Error("Draw, type, or upload an answer before submitting.");
      const result = await submitStudentWork(session.studentId, question.id, { answer, file }, setProgress);
      await pollSubmission(session.studentId, result.submissionId);
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "Couldn’t submit your answer. Try again."); }
    finally { if (active.current) setSending(false); }
  }

  function nextQuestion() {
    if (!assignment || !session) return;
    setSubmission(null); setAnswer(""); setPhoto(null); setError("");
    const nextIndex = assignment.questions.findIndex((question, index) => index > currentIndex && !session.progress.submissions.some((item) => item.questionId === question.id));
    if (nextIndex === -1) setFinished(true);
    else setCurrentIndex(nextIndex);
  }

  if (loading) return <Loading>Opening your assignment…</Loading>;
  if (!assignment) return <Notice tone="error">{loadError || "Assignment not found. Check the class code with your teacher."}</Notice>;

  if (!session) return (
    <div className="narrow-page student-page">
      <div className="page-heading"><p className="eyebrow">Class code {code.toUpperCase()}</p><h1>{assignment.title}</h1><p>Join with your name and a PIN you’ll remember. The same details restore your progress on any device.</p></div>
      {error && <Notice tone="error">{error}</Notice>}
      <form className="card form-section" onSubmit={join}>
        <div className="field"><label htmlFor="student-name">Your name</label><input id="student-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></div>
        <div className="field"><label htmlFor="student-pin">4-digit PIN</label><input id="student-pin" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" autoComplete="current-password" pattern="\d{4}" required /></div>
        <button className="button primary large" type="submit" disabled={joining}>{joining ? "Joining…" : "Start or resume"}</button>
      </form>
    </div>
  );

  if (finished) return (
    <div className="narrow-page result-page">
      <div className="page-heading"><p className="eyebrow">Assignment summary</p><h1>Nice work, {session.progress.studentName}</h1><p>You answered {session.progress.answered} of {assignment.questions.length} questions.</p></div>
      <section className="card score-card"><p className="eyebrow">Total score</p><div className="big-score">{session.progress.totalScore}<span> / {session.progress.maxScore}</span></div></section>
      <section className="result-feedback">{assignment.questions.map((question, index) => {
        const item = session.progress.submissions.find((submission) => submission.questionId === question.id);
        return <article className="card" key={question.id}><div className="section-heading"><h3>Question {index + 1}</h3>{item ? <strong>{item.score ?? "—"} / {item.maxScore ?? "—"}</strong> : <StatusPill status="queued" />}</div><p>{question.prompt}</p></article>;
      })}</section>
      <aside className="card growth-cta"><strong>Made with Goblins</strong><p>Want live feedback and analytics for your students? <a href="https://goblinsapp.com" target="_blank" rel="noreferrer">Assign this in Goblins →</a></p></aside>
    </div>
  );

  const question = assignment.questions[currentIndex]!;
  const terminal = submission?.status === "completed" || submission?.status === "failed";
  return (
    <div className="narrow-page student-page">
      <div className="page-heading"><p className="eyebrow">Question {currentIndex + 1} of {assignment.questions.length}</p><h1>{assignment.title}</h1><p>Submit this question to see its score, then continue.</p></div>
      {!assignment.acceptingSubmissions && <Notice tone="warning">This assignment isn’t accepting submissions yet.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <section className="card student-question"><span className="question-number">Question {currentIndex + 1}</span><h2>{question.prompt}</h2>
        {!submission && <form onSubmit={submit}>
          <div className="field"><label>Show your work on the whiteboard</label><Whiteboard key={question.id} ref={boardRef} label={`Whiteboard for question ${currentIndex + 1}`} disabled={sending} /></div>
          <div className="field"><label htmlFor="answer">Type your answer <span className="label-hint">optional</span></label><textarea id="answer" rows={5} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Add an explanation or type your whole answer…" disabled={sending} /></div>
          <div className="field"><label htmlFor="answer-photo">Upload a photo instead <span className="label-hint">optional</span></label><input ref={photoInputRef} id="answer-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={sending} onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024)) {
              setError("Choose a JPG, PNG, or WebP image up to 8MB."); setPhoto(null);
              if (photoInputRef.current) photoInputRef.current.value = "";
            } else { setPhoto(file); setError(""); }
          }} /></div>
          {photo && <p className="muted">{photo.name} will be used instead of the whiteboard. <button type="button" className="text-button danger" onClick={() => { setPhoto(null); if (photoInputRef.current) photoInputRef.current.value = ""; }}>Remove</button></p>}
          {sending && <div className="upload-progress" role="status"><label htmlFor="upload-progress">Uploading: {progress}%</label><progress id="upload-progress" max={100} value={progress} /></div>}
          <button className="button primary large submit-work" type="submit" disabled={sending || !assignment.acceptingSubmissions}>{sending ? "Submitting…" : "Submit this question"}</button>
        </form>}
        {submission && !terminal && <Loading>{submission.status === "queued" ? "Your answer is waiting to be graded." : "Your answer is being graded."}</Loading>}
        {submission?.status === "failed" && <Notice tone="warning">We couldn’t grade this automatically. Your teacher can see it.</Notice>}
        {submission?.status === "completed" && <div className="score-card"><p className="eyebrow">This question</p><div className="big-score">{submission.score ?? 0}<span> / {submission.maxScore ?? "—"}</span></div>{submission.grade && <p className="preserve-lines">{submission.grade.questions[0]?.feedback}</p>}</div>}
        {terminal && <button type="button" className="button primary large submit-work" onClick={nextQuestion}>{currentIndex === assignment.questions.length - 1 || session.progress.complete ? "See my summary" : "Next question"}</button>}
      </section>
    </div>
  );
}
