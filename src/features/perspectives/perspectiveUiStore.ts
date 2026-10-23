import { create } from "zustand";

/** Management dialog is transient; the active map and its editable content live in the project. */
export const usePerspectiveUiStore = create<{
  isOpen: boolean;
  open: () => void;
  close: () => void;
}>()((set) => ({
  isOpen: false,
  open: () => {
    set({ isOpen: true });
  },
  close: () => {
    set({ isOpen: false });
  },
}));
