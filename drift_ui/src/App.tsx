import { Navigate, Route, Routes, Link, useLocation } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import TaskDetail from "./pages/TaskDetail";
import Compare from "./pages/Compare";
import NewTaskForm from "./components/NewTaskForm";

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const location = useLocation();
  const active =
    to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
  return (
    <Link
      to={to}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-slate-800 text-white"
          : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
      }`}
    >
      {children}
    </Link>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-200">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-900/90 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-[1400px] items-center gap-4 px-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-sky-600 text-xs font-bold text-white">
              D
            </span>
            <span className="text-sm font-semibold tracking-tight text-white">
              drift
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink to="/">Dashboard</NavLink>
            <NavLink to="/compare">Compare</NavLink>
          </nav>
          <div className="ml-auto">
            <Link to="/tasks/new" className="btn-primary px-3! py-1.5!">
              New Task
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/tasks/new" element={<NewTaskForm />} />
          <Route path="/tasks/:id" element={<TaskDetail />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
