import { TownLayout } from "./components/TownLayout";
import { ObserverPanel } from "./components/ObserverPanel";

function App() {
  return (
    <div className="flex h-screen w-full min-w-0 bg-slate-900 overflow-hidden">
      <main className="flex-1 flex min-w-0 overflow-hidden">
        <TownLayout />
        <ObserverPanel />
      </main>
    </div>
  );
}

export default App;
