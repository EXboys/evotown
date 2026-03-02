import { TownLayout } from "./components/TownLayout";
import { ObserverPanel } from "./components/ObserverPanel";

function App() {
  return (
    <div className="flex h-screen w-full bg-slate-900">
      <main className="flex-1 flex overflow-hidden">
        <TownLayout />
        <ObserverPanel />
      </main>
    </div>
  );
}

export default App;
