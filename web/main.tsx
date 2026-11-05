import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./ui.tsx";
import { LandingPage } from "./pages/LandingPage.tsx";
import { NewAssignmentPage } from "./pages/NewAssignmentPage.tsx";
import { TeacherAssignmentPage } from "./pages/TeacherAssignmentPage.tsx";
import { TeacherSubmissionPage } from "./pages/TeacherSubmissionPage.tsx";
import { StudentPage } from "./pages/StudentPage.tsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/new" element={<NewAssignmentPage />} />
          <Route path="/t/:id" element={<TeacherAssignmentPage />} />
          <Route path="/t/:id/s/:sid" element={<TeacherSubmissionPage />} />
          <Route path="/s/:code" element={<StudentPage />} />
          <Route path="*" element={<div className="card"><h1>Page not found</h1><p>That page doesn’t exist.</p></div>} />
        </Routes>
      </Layout>
    </BrowserRouter>
  </React.StrictMode>,
);
