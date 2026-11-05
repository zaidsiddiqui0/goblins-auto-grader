import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, getTeacherToken, rememberAssignment, saveTeacherToken } from "../api.ts";
import type { AssignmentDTO, Rubric, SubmissionStatus, TeacherReportDTO } from "../../shared/schema.ts";
import { ReadonlyRubric, RubricEditor } from "../RubricEditor.tsx";
import { EmptyState, formatDate, Loading, Notice, StatusPill, Stepper } from "../ui.tsx";

type Report = TeacherReportDTO;

export function TeacherAssignmentPage() {
  const { id = "" } = useParams();
  const [assignment, setAssignment] = useState<AssignmentDTO | null>(null);
  const [editedRubric, setEditedRubric] = useState<Rubric | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState<"save" | "approve" | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [copyState, setCopyState] = useState("");
  const [teacherCopyState, setTeacherCopyState] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [reportError, setReportError] = useState("");

  const applyAssignment = useCallback((next: AssignmentDTO) => {
    setAssignment(next);
    setEditedRubric(next.draftRubric ? structuredClone(next.draftRubric.rubric) : null);
    rememberAssignment(next);
  }, []);

  useEffect(() => {
    let active = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const linkedToken = fragment.get("k");
    if (linkedToken) saveTeacherToken(id, linkedToken);
    if (window.location.hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    if (!getTeacherToken(id)) {
      setError("This assignment isn't available on this device.");
      setLoading(false);
      return;
    }
    api.getAssignment(id)
      .then((next) => { if (active) applyAssignment(next); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Couldn’t load this assignment."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, applyAssignment]);

  const loadReport = useCallback(async () => {
    if (!getTeacherToken(id)) return;
    try {
      const next = await api.getSubmissions(id);
      setReport(next);
      setReportError("");
    } catch (cause) {
      setReportError(cause instanceof Error ? cause.message : "Couldn’t load the class report.");
    }
  }, [id]);

  useEffect(() => { void loadReport(); }, [loadReport]);

  const activeSubmissions = (report?.counts.queued ?? 0) + (report?.counts.processing ?? 0);
  useEffect(() => {
    if (!activeSubmissions) return;
    const timer = window.setInterval(() => void loadReport(), 3000);
    return () => window.clearInterval(timer);
  }, [activeSubmissions, loadReport]);

  async function generateRubric() {
    setGenerating(true);
    setError("");
    setSuccess("");
    try {
      applyAssignment(await api.generateRubric(id));
      setSuccess("Draft rubric generated. Review it carefully before publishing.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t generate a rubric.");
    } finally {
      setGenerating(false);
    }
  }

  function validateRubric(rubric: Rubric) {
    if (rubric.questions.some((question) => question.criteria.some((criterion) => !criterion.description.trim()))) {
      return "Every criterion needs a description.";
    }
    if (rubric.questions.some((question) => question.criteria.some((criterion) => !Number.isFinite(criterion.points) || criterion.points < 0 || criterion.points > 100))) {
      return "Criterion points must be between 0 and 100.";
    }
    return "";
  }

  async function saveDraft() {
    if (!editedRubric) return;
    const validation = validateRubric(editedRubric);
    if (validation) { setError(validation); return; }
    setBusy("save");
    setError("");
    setSuccess("");
    try {
      applyAssignment(await api.saveRubric(id, editedRubric));
      setSuccess("Draft saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t save the draft.");
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (!editedRubric) return;
    const validation = validateRubric(editedRubric);
    if (validation) { setError(validation); setConfirming(false); return; }
    setBusy("approve");
    setError("");
    setSuccess("");
    try {
      await api.saveRubric(id, editedRubric);
      const next = await api.approveRubric(id);
      applyAssignment(next);
      setConfirming(false);
      setSuccess(`Rubric v${next.currentRubric?.version ?? ""} approved. Your class code is ready to share.`);
      void loadReport();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t approve the rubric.");
    } finally {
      setBusy(null);
    }
  }

  async function copyShareLink(link: string) {
    setCopyState("");
    try {
      await navigator.clipboard.writeText(link);
      setCopyState("Copied!");
    } catch {
      setCopyState("Select the link above and copy it.");
    }
  }

  if (loading) return <Loading>Loading assignment…</Loading>;
  if (!assignment) return <Notice tone="error">{error || "This assignment isn't available on this device."}</Notice>;

  const current = assignment.currentRubric;
  const draft = assignment.draftRubric;
  const editorVersion = draft?.version ?? (current?.version ?? 0) + 1;
  const shareLink = `${window.location.origin}/s/${assignment.accessCode}`;
  const privateTeacherLink = `${window.location.origin}/t/${id}#k=${encodeURIComponent(getTeacherToken(id) ?? "")}`;
  const reviewQuestions = editedRubric?.questions.map((question, i) => ({ ...question, number: i + 1 })).filter((question) => question.needsReview) ?? [];

  return (
    <div className="teacher-page">
      <Stepper current={current ? 3 : 2} />
      <div className="page-heading assignment-heading">
        <div><p className="eyebrow">Teacher assignment</p><h1>{assignment.title}</h1></div>
        <span className={`badge ${assignment.acceptingSubmissions ? "badge-live" : ""}`}>{assignment.acceptingSubmissions ? "Accepting submissions" : "Setup in progress"}</span>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {success && <Notice tone="success">{success}</Notice>}

      <section className="card teacher-link-panel">
        <h2>Private teacher link</h2>
        <p>Bookmark this to open your class on any device.</p>
        <div className="share-link-row"><div className="field"><label htmlFor="private-teacher-link">Keep this link private</label><input id="private-teacher-link" readOnly value={privateTeacherLink} onFocus={(event) => event.target.select()} /></div><button className="button secondary" type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(privateTeacherLink); setTeacherCopyState("Copied!"); }
          catch { setTeacherCopyState("Select the link above and copy it."); }
        }}>Copy</button></div>
        {teacherCopyState && <p className="muted" role="status">{teacherCopyState}</p>}
      </section>

      {!current && !editedRubric && (
        <section className="card generate-panel">
          <p className="eyebrow">Step 2</p>
          <h2>Generate your rubric</h2>
          <p>The rubric is generated from your questions only, before any student work is seen.</p>
          <p className="muted">This can take up to about 30 seconds. You’ll review every answer and criterion before anything is published.</p>
          <button type="button" className="button primary" onClick={() => void generateRubric()} disabled={generating}>{generating ? "Generating rubric…" : "Generate rubric"}</button>
          {generating && <Loading>Building a draft from your assignment questions…</Loading>}
        </section>
      )}

      {current && (
        <section className="card share-panel" aria-labelledby="share-heading">
          <div><p className="eyebrow">Ready for your class</p><h2 id="share-heading">Share this code</h2><p>Students use this code to open the assignment. No account needed.</p></div>
          <div className="access-code" aria-label={`Class code ${assignment.accessCode}`}>{assignment.accessCode}</div>
          <div className="share-link-row">
            <div className="field"><label htmlFor="share-link">Student link</label><input id="share-link" readOnly value={shareLink} onFocus={(event) => event.target.select()} /></div>
            <button className="button secondary" type="button" onClick={() => void copyShareLink(shareLink)}>Copy</button>
          </div>
          {copyState && <p className="muted" role="status">{copyState}</p>}
        </section>
      )}

      {editedRubric ? (
        <section className="rubric-section" aria-label="Rubric draft">
          {draft && current && <Notice tone="info">You’re editing draft v{draft.version}. Published v{current.version} remains in use until this draft is approved.</Notice>}
          {!draft && current && <Notice tone="info">Your changes are not saved yet. Saving creates draft v{editorVersion}.</Notice>}
          <RubricEditor rubric={editedRubric} version={editorVersion} busy={busy} onChange={(rubric) => { setEditedRubric(rubric); setSuccess(""); }} onSave={() => void saveDraft()} onApprove={() => setConfirming(true)} />
        </section>
      ) : current ? (
        <section className="rubric-section">
          <div className="section-heading">
            <div><p className="eyebrow">Approved rubric</p><h2>v{current.version} approved {formatDate(current.approvedAt ?? current.createdAt)}</h2></div>
            <button type="button" className="button secondary" onClick={() => { setEditedRubric(structuredClone(current.rubric)); setSuccess(""); }}>Edit rubric (creates v{current.version + 1})</button>
          </div>
          <p className="muted">Existing grades keep their version. New submissions use the approved version shown above.</p>
          <ReadonlyRubric rubric={current.rubric} />
        </section>
      ) : null}

      <section className="class-report" aria-labelledby="report-heading">
        <div className="section-heading"><div><p className="eyebrow">Class report</p><h2 id="report-heading">Submissions</h2></div>{activeSubmissions > 0 && <span className="live-label"><span className="live-dot" />Updating live</span>}</div>
        {report && (
          <div className="status-counts" aria-label="Submission status counts">
            {(["queued", "processing", "completed", "failed"] as SubmissionStatus[]).map((status) => <div key={status}><span>{status}</span><strong>{report.counts[status] ?? 0}</strong></div>)}
          </div>
        )}
        {reportError && <Notice tone="error">{reportError}</Notice>}
        {!report && !reportError && <Loading>Loading submissions…</Loading>}
        {report && report.students.length === 0 && <EmptyState title="No students yet">Share code {assignment.accessCode} with your class. Joined students will appear here.</EmptyState>}
        {report && report.students.length > 0 && (
          <div className="table-wrap report-grid-wrap">
            <table className="report-grid">
              <thead><tr><th>Student</th><th>Progress</th><th>Total score</th>{assignment.questions.map((question, index) => <th key={question.id} title={question.prompt}>Q{index + 1}</th>)}</tr></thead>
              <tbody>{report.students.map((student) => (
                <tr key={student.studentId}>
                  <td><strong>{student.studentName}</strong></td>
                  <td>{student.answered}/{assignment.questions.length} answered</td>
                  <td><strong>{student.totalScore} / {student.maxScore}</strong></td>
                  {assignment.questions.map((question, index) => {
                    const cell = student.questions[question.id];
                    return <td key={question.id} className="report-cell">{cell ? <Link to={`/t/${id}/s/${cell.id}`} aria-label={`Open ${student.studentName}, question ${index + 1}`}>
                      <strong>{cell.score === null ? "—" : `${cell.score} / ${cell.maxScore ?? "—"}`}</strong><StatusPill status={cell.status} />
                      {cell.needsReview && <span className="badge badge-check">Review</span>}
                    </Link> : <span className="badge">Not answered</span>}</td>;
                  })}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <aside className="card growth-cta">
        <p>Want live feedback and analytics for your students? <a href="https://goblinsapp.com" target="_blank" rel="noreferrer">Assign this in Goblins →</a></p>
      </aside>

      {confirming && editedRubric && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setConfirming(false); }}>
          <section className="modal card" role="dialog" aria-modal="true" aria-labelledby="approve-title">
            <h2 id="approve-title">Lock rubric v{editorVersion}?</h2>
            <p>Submissions will be graded with this version.</p>
            {reviewQuestions.length > 0 && <Notice tone="warning"><strong>Still marked for review:</strong><ul>{reviewQuestions.map((question) => <li key={question.questionId}>Question {question.number}: {question.reviewNotes || question.prompt}</li>)}</ul></Notice>}
            <p className="muted">An approved rubric is immutable. Further edits create a new version.</p>
            <div className="button-group modal-actions"><button type="button" className="button secondary" onClick={() => setConfirming(false)} disabled={busy !== null}>Keep editing</button><button type="button" className="button primary" onClick={() => void approve()} disabled={busy !== null}>{busy === "approve" ? "Publishing…" : "Lock & publish"}</button></div>
          </section>
        </div>
      )}
    </div>
  );
}
