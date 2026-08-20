import { create } from 'zustand';
import type { SplatEntry } from '../engine/splats/SplatManager';

export type Theme = 'dark' | 'light';

/** Engine lifecycle as seen by the UI. */
export type EngineStatus = 'booting' | 'ready' | 'error';

interface StudioState {
  theme: Theme;
  engineStatus: EngineStatus;
  engineError: string | null;
  /** Mirror of SplatManager entries for reactive UI. */
  splats: SplatEntry[];
  busyMessage: string | null;

  setTheme(theme: Theme): void;
  setEngineStatus(status: EngineStatus, error?: string): void;
  setSplats(entries: SplatEntry[]): void;
  setBusy(message: string | null): void;
}

export const useStore = create<StudioState>((set) => ({
  theme: 'dark',
  engineStatus: 'booting',
  engineError: null,
  splats: [],
  busyMessage: null,

  setTheme: (theme) => set({ theme }),
  setEngineStatus: (engineStatus, error) =>
    set({ engineStatus, engineError: error ?? null }),
  setSplats: (splats) => set({ splats }),
  setBusy: (busyMessage) => set({ busyMessage }),
}));
