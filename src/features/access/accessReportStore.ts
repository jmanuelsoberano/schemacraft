import { create } from "zustand";

interface AccessReportState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

/** Visibility of the Access report, opened from the status bar, the notices and the registry. */
export const useAccessReportStore = create<AccessReportState>()((set) => ({
  isOpen: false,
  open: () => {
    set({ isOpen: true });
  },
  close: () => {
    set({ isOpen: false });
  },
}));
