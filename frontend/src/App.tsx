import { NavLink, Routes, Route, Link, useNavigate, useParams } from "react-router-dom";
import { Overview } from "./components/Overview";
import { SessionList } from "./components/SessionList";
import { SessionDetail } from "./components/SessionDetail";
import { ProjectsList } from "./routes/ProjectsList";
import { ProjectsCompare } from "./routes/ProjectsCompare";
import { ProjectOverview } from "./routes/ProjectOverview";

function OverviewRoute() {
  const navigate = useNavigate();
  return <Overview onOpenSession={(id) => navigate(`/sessions/${id}`)} />;
}

function SessionListRoute() {
  const navigate = useNavigate();
  return <SessionList onSelect={(id) => navigate(`/sessions/${id}`)} />;
}

function SessionDetailRoute() {
  const navigate = useNavigate();
  const { id } = useParams();
  return <SessionDetail id={id!} onBack={() => navigate(-1)} />;
}

function NotFound() {
  return (
    <div className="page">
      <p className="muted">Page not found.</p>
      <Link to="/">Back to Overview</Link>
    </div>
  );
}

export function App() {
  return (
    <div className="app">
      <header className="topbar">
        <h1>Claude Code History</h1>
        <nav className="tabs">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
            Overview
          </NavLink>
          <NavLink to="/projects" className={({ isActive }) => (isActive ? "active" : "")}>
            Projects
          </NavLink>
          <NavLink to="/sessions" className={({ isActive }) => (isActive ? "active" : "")}>
            Sessions
          </NavLink>
        </nav>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<OverviewRoute />} />
          <Route path="/projects" element={<ProjectsList />} />
          <Route path="/projects/compare" element={<ProjectsCompare />} />
          <Route path="/projects/:slug" element={<ProjectOverview />} />
          <Route path="/sessions" element={<SessionListRoute />} />
          <Route path="/sessions/:id" element={<SessionDetailRoute />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}
