import { create } from "zustand";

interface AboutState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

/** Visibility of the About dialog, shared by the status bar and the action registry. */
export const useAboutStore = create<AboutState>()((set) => ({
  isOpen: false,
  open: () => {
    set({ isOpen: true });
  },
  close: () => {
    set({ isOpen: false });
  },
}));
