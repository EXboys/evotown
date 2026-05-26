/** 组织日志通知 store — 接收 WS chronicle_published 事件 */
import { create } from "zustand";

interface ChronicleNotification {
  date: string;
  preview: string;
}

interface ChronicleState {
  latestPublished: ChronicleNotification | null;
  setLatestPublished: (n: ChronicleNotification) => void;
  clearLatestPublished: () => void;
}

export const useChronicleStore = create<ChronicleState>((set) => ({
  latestPublished: null,
  setLatestPublished: (n) => set({ latestPublished: n }),
  clearLatestPublished: () => set({ latestPublished: null }),
}));

