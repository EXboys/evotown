import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { TownLayout } from "./components/TownLayout";
import { ObserverPanel } from "./components/ObserverPanel";
import { LandingPage } from "./components/LandingPage";
import { TaskHistoryPage } from "./components/TaskHistoryPage";

function ArenaApp() {
  return (
    <div className="flex h-screen w-full min-w-0 bg-slate-900 overflow-hidden">
      <main className="flex-1 flex min-w-0 overflow-hidden">
        <TownLayout />
        <ObserverPanel />
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/arena" element={<ArenaApp />} />
        <Route path="/task-history" element={<TaskHistoryPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
