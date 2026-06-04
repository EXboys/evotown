import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { TownLayout } from "./components/TownLayout";
import { ObserverPanel } from "./components/ObserverPanel";
import { LandingPage } from "./components/LandingPage";
import { TaskHistoryPage } from "./components/TaskHistoryPage";
import { ChronicleBook } from "./components/ChronicleBook";
import { ConsoleLoginPage } from "./components/ConsoleLoginPage";
import { SkillsMarketPage } from "./components/market/SkillsMarketPage";
import { PublicKnowledgePage } from "./components/PublicKnowledgePage";
import { EnterpriseConsole } from "./components/EnterpriseConsole";
import { useEvotownStore } from "./store/evotownStore";
import { initDisplayTimezoneFromServer } from "./lib/datetime";
import { useDisplayTimezone } from "./hooks/useDisplayTimezone";

/** 定期清理间隔（毫秒） */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 小时

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
  useDisplayTimezone();

  useEffect(() => {
    void initDisplayTimezoneFromServer();
  }, []);

  useEffect(() => {
    const cleanup = useEvotownStore.getState().cleanupExpiredEvents;
    // 立即执行一次清理
    cleanup();
    // 设置定期清理
    const intervalId = setInterval(cleanup, CLEANUP_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/welcome" element={<Navigate to="/" replace />} />
        <Route path="/login" element={<ConsoleLoginPage />} />
        <Route path="/market" element={<SkillsMarketPage />} />
        <Route path="/market/:skillId" element={<SkillsMarketPage />} />
        <Route path="/dashboard" element={<EnterpriseConsole initialTab="dashboard" />} />
        <Route path="/gateway" element={<EnterpriseConsole initialTab="gateway" />} />
        <Route path="/accounts" element={<EnterpriseConsole initialTab="accounts" />} />
        <Route path="/engines" element={<EnterpriseConsole initialTab="engines" />} />
        <Route path="/dispatch" element={<EnterpriseConsole initialTab="dispatch" />} />
        <Route path="/runs" element={<EnterpriseConsole initialTab="runs" />} />
        <Route path="/assets" element={<EnterpriseConsole initialTab="assets" />} />
        <Route path="/policies" element={<EnterpriseConsole initialTab="policies" />} />
        <Route path="/skills" element={<EnterpriseConsole initialTab="skills" />} />
        <Route path="/knowledge" element={<PublicKnowledgePage />} />
        <Route path="/console/knowledge" element={<EnterpriseConsole initialTab="knowledge" />} />
        <Route path="/costs" element={<EnterpriseConsole initialTab="costs" />} />
        <Route path="/risk" element={<EnterpriseConsole initialTab="risk" />} />
        <Route path="/arena" element={<ArenaApp />} />
        <Route path="/task-history" element={<TaskHistoryPage />} />
        <Route path="/chronicle" element={<ChronicleBook />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
