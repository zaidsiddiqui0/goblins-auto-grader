import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { SubmissionStatus } from "../shared/schema.ts";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="site-header">
        <Link to="/" className="brand" aria-label="Goblins home">
          <span className="brand-mark" aria-hidden="true">G</span>
          <span>Goblins <span className="brand-subtitle">auto-grader</span></span>
        </Link>
      </header>
      <main className="page">{children}</main>
      <footer className="site-footer">Demo: grades are AI-assisted and may be wrong. Teachers can review and override.</footer>
    </div>
  );
}

export function Stepper({ current }: { current: 1 | 2 | 3 }) {
  const steps = ["Questions", "Rubric", "Share"];
  return (
    <ol className="stepper" aria-label="Assignment setup">
      {steps.map((label, index) => {
        const step = (index + 1) as 1 | 2 | 3;
        return (
          <li key={label} className={step === current ? "current" : step < current ? "complete" : ""} aria-current={step === current ? "step" : undefined}>
            <span className="step-number">{step < current ? "✓" : step}</span>
            <span>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "error" | "success" | "warning" }) {
  return <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}

export function Loading({ children = "Loading…" }: { children?: ReactNode }) {
  return <div className="loading" role="status"><span className="spinner" aria-hidden="true" />{children}</div>;
}

export function StatusPill({ status }: { status: SubmissionStatus }) {
  return <span className={`status status-${status}`}>{status}</span>;
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty-state"><h3>{title}</h3><p>{children}</p></div>;
}

export function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
