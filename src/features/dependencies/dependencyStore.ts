import { create } from "zustand";
import type { DependencyObjectRef } from "@/shared/contracts/generated/model/DependencyObjectRef";

interface DependencyState {
  isOpen: boolean;
  root: DependencyObjectRef | null;
  open: (root?: DependencyObjectRef) => void;
  close: () => void;
}

/** Transient viewer only; exploring known references never edits a project. */
export const useDependencyStore = create<DependencyState>()((set) => ({
  isOpen: false,
  root: null,
  open: (root) => {
    set({ isOpen: true, root: root ?? null });
  },
  close: () => {
    set({ isOpen: false });
  },
}));
