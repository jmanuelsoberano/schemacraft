import { create } from "zustand";

interface PaletteState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

/** Visibility of the command palette. */
export const usePaletteStore = create<PaletteState>()((set) => ({
  isOpen: false,
  open: () => {
    set({ isOpen: true });
  },
  close: () => {
    set({ isOpen: false });
  },
  toggle: () => {
    set((state) => ({ isOpen: !state.isOpen }));
  },
}));
