import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getLocalAssignments } from "../api.ts";

export function LandingPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const assignments = getLocalAssignments();

  function enterClass(event: FormEvent) {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(normalized)) {
      setError("Enter the 6-character class code from your teacher.");
      return;
    }
    navigate(`/s/${normalized}`);
  }

  return (
    <div className="landing">
      <section className="hero">
        <p className="eyebrow">Less grading. More teaching.</p>
        <h1>A clear path from questions to useful feedback.</h1>
        <p className="hero-copy">Build a rubric before student work arrives, then review every AI-assisted grade with confidence.</p>
      </section>

      <div className="action-grid">
        <section className="card action-card">
          <span className="card-icon" aria-hidden="true">✎</span>
          <h2>For teachers</h2>
          <p>Create an assignment, approve its rubric, and share one class code.</p>
          <Link className="button primary" to="/new">Create an assignment</Link>
        </section>
        <section className="card action-card">
          <span className="card-icon" aria-hidden="true">→</span>
          <h2>For students</h2>
          <p>Have a class code? Open your assignment and submit your work.</p>
          <form onSubmit={enterClass}>
            <label htmlFor="class-code">Class code</label>
            <div className="code-entry">
              <input
                id="class-code"
                value={code}
                onChange={(event) => { setCode(event.target.value.toUpperCase().replace(/\s/g, "")); setError(""); }}
                placeholder="ABC123"
                maxLength={6}
                autoCapitalize="characters"
                autoComplete="off"
                aria-describedby={error ? "class-code-error" : undefined}
              />
              <button className="button secondary" type="submit">Enter class code</button>
            </div>
            {error && <p className="field-error" id="class-code-error" role="alert">{error}</p>}
          </form>
        </section>
      </div>

      <section className="your-assignments">
        <h2>Your assignments</h2>
        {assignments.length ? (
          <div className="assignment-list">
            {assignments.map((assignment) => (
              <Link className="assignment-link" to={`/t/${assignment.id}`} key={assignment.id}>
                <span>{assignment.title}</span><span aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="muted">Assignments you create on this device will appear here.</p>
        )}
      </section>
    </div>
  );
}
