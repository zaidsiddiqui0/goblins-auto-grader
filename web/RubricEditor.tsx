import type { Criterion, Rubric, RubricQuestion } from "../shared/schema.ts";
import { questionMax, rubricMax } from "../shared/schema.ts";
import { Notice } from "./ui.tsx";

function answerSource(question: RubricQuestion) {
  if (question.answerSource === "teacher_key") return <span className="badge">Teacher key</span>;
  if (question.answerSource === "inferred") return <span className="badge badge-check">Inferred · Check this</span>;
  return <span className="badge">Subjective</span>;
}

type EditorProps = {
  rubric: Rubric;
  version: number;
  busy: "save" | "approve" | null;
  onChange: (rubric: Rubric) => void;
  onSave: () => void;
  onApprove: () => void;
};

export function RubricEditor({ rubric, version, busy, onChange, onSave, onApprove }: EditorProps) {
  function updateQuestion(questionId: string, update: Partial<RubricQuestion>) {
    onChange({ questions: rubric.questions.map((question) => question.questionId === questionId ? { ...question, ...update } : question) });
  }

  function updateCriterion(questionId: string, criterionId: string, update: Partial<Criterion>) {
    const question = rubric.questions.find((item) => item.questionId === questionId);
    if (!question) return;
    updateQuestion(questionId, { criteria: question.criteria.map((criterion) => criterion.id === criterionId ? { ...criterion, ...update } : criterion) });
  }

  return (
    <div className="rubric-editor">
      <div className="section-heading">
        <div><p className="eyebrow">Draft v{version}</p><h2>Review the rubric</h2></div>
        <span className="badge">Editable</span>
      </div>
      <p className="muted">Check expected answers and point values before publishing. One list item per line.</p>
      {rubric.questions.map((question, questionIndex) => (
        <article className="card rubric-question" key={question.questionId}>
          <div className="rubric-question-heading">
            <div><span className="question-number">Question {questionIndex + 1}</span><h3>{question.prompt}</h3></div>
            {answerSource(question)}
          </div>
          {question.needsReview && (
            <Notice tone="warning"><strong>Teacher review needed.</strong> {question.reviewNotes || "Check this question before approving the rubric."}</Notice>
          )}
          <div className="field">
            <label htmlFor={`expected-${question.questionId}`}>Expected answer</label>
            <textarea id={`expected-${question.questionId}`} rows={3} value={question.expectedAnswer ?? ""} onChange={(event) => updateQuestion(question.questionId, { expectedAnswer: event.target.value })} />
          </div>

          <fieldset className="criteria-fieldset">
            <legend>Criteria <span className="label-hint">question max: {questionMax(question)} points</span></legend>
            {question.criteria.map((criterion, criterionIndex) => (
              <div className="criterion-row" key={criterion.id}>
                <div className="field criterion-description">
                  <label htmlFor={`criterion-${criterion.id}`}>Criterion {criterionIndex + 1}</label>
                  <input id={`criterion-${criterion.id}`} value={criterion.description} onChange={(event) => updateCriterion(question.questionId, criterion.id, { description: event.target.value })} required />
                </div>
                <div className="field points-field">
                  <label htmlFor={`points-${criterion.id}`}>Points</label>
                  <input id={`points-${criterion.id}`} type="number" min={0} max={100} step="any" value={criterion.points} onChange={(event) => updateCriterion(question.questionId, criterion.id, { points: Number(event.target.value) })} required />
                </div>
                <button type="button" className="text-button danger criterion-remove" onClick={() => updateQuestion(question.questionId, { criteria: question.criteria.filter((item) => item.id !== criterion.id) })} disabled={question.criteria.length === 1} aria-label={`Remove criterion ${criterionIndex + 1}`}>Remove</button>
              </div>
            ))}
            <button type="button" className="button small secondary" onClick={() => updateQuestion(question.questionId, { criteria: [...question.criteria, { id: `${question.questionId}-c-${crypto.randomUUID()}`, description: "", points: 1 }] })}>+ Add criterion</button>
          </fieldset>

          <div className="rubric-notes-grid">
            <div className="field">
              <label htmlFor={`partial-${question.questionId}`}>Partial credit</label>
              <textarea id={`partial-${question.questionId}`} rows={3} value={question.partialCredit} onChange={(event) => updateQuestion(question.questionId, { partialCredit: event.target.value })} />
            </div>
            <div className="field">
              <label htmlFor={`alternatives-${question.questionId}`}>Acceptable alternatives <span className="label-hint">one per line</span></label>
              <textarea id={`alternatives-${question.questionId}`} rows={3} value={question.alternatives.join("\n")} onChange={(event) => updateQuestion(question.questionId, { alternatives: event.target.value.split("\n") })} />
            </div>
            <div className="field">
              <label htmlFor={`mistakes-${question.questionId}`}>Common mistakes <span className="label-hint">one per line</span></label>
              <textarea id={`mistakes-${question.questionId}`} rows={3} value={question.commonMistakes.join("\n")} onChange={(event) => updateQuestion(question.questionId, { commonMistakes: event.target.value.split("\n") })} />
            </div>
          </div>
        </article>
      ))}
      <div className="rubric-footer">
        <div><span>Total points</span><strong>{rubricMax(rubric)}</strong></div>
        <div className="button-group">
          <button type="button" className="button secondary" onClick={onSave} disabled={busy !== null}>{busy === "save" ? "Saving…" : "Save draft"}</button>
          <button type="button" className="button primary" onClick={onApprove} disabled={busy !== null}>{busy === "approve" ? "Publishing…" : "Approve & publish"}</button>
        </div>
      </div>
    </div>
  );
}

export function ReadonlyRubric({ rubric }: { rubric: Rubric }) {
  return (
    <div className="readonly-rubric">
      {rubric.questions.map((question, index) => (
        <article className="card rubric-question" key={question.questionId}>
          <div className="rubric-question-heading"><div><span className="question-number">Question {index + 1}</span><h3>{question.prompt}</h3></div>{answerSource(question)}</div>
          <dl className="rubric-details">
            <div><dt>Expected answer</dt><dd>{question.expectedAnswer || "No single expected answer."}</dd></div>
            <div><dt>Criteria · {questionMax(question)} points</dt><dd><ul>{question.criteria.map((criterion) => <li key={criterion.id}>{criterion.description} <strong>{criterion.points} pts</strong></li>)}</ul></dd></div>
            <div><dt>Partial credit</dt><dd>{question.partialCredit || "None specified."}</dd></div>
            {question.alternatives.length > 0 && <div><dt>Acceptable alternatives</dt><dd><ul>{question.alternatives.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul></dd></div>}
            {question.commonMistakes.length > 0 && <div><dt>Common mistakes</dt><dd><ul>{question.commonMistakes.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul></dd></div>}
          </dl>
        </article>
      ))}
    </div>
  );
}
