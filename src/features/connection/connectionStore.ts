import { create } from "zustand";
import { persist } from "zustand/middleware";

import { useSchemaStore } from "@/features/schema/schemaStore";
import type {
  ConnectionSettings,
  InspectionEvent,
  InspectionOptions,
  InspectionStage,
  ServerInformation,
} from "@/shared/contracts";
import { getConnectionBackend } from "@/shared/ipc/connectionBackend";
import { inspectorErrorKind, toOperationError } from "@/shared/ipc/operationError";
import type { OperationError } from "@/shared/ipc/operationError";

import { draftToInspectionOptions, draftToSettings, emptyConnectionDraft } from "./connectionDraft";
import type { ConnectionDraft, DraftValidationError } from "./connectionDraft";

/** Result of a successful "Test connection". */
export interface TestedConnection {
  server: ServerInformation;
  databases: string[];
  /** Schemas of the selected database; empty until a database is chosen. */
  schemas: string[];
}

/** Stages reported so far; the value is the object count, or `null` for stages without one. */
export type StageProgress = Partial<Record<InspectionStage, number | null>>;

export interface RunningInspection {
  jobId: string | null;
  database: string;
  stages: StageProgress;
  isCancelling: boolean;
}

export interface ConnectionFailure {
  error: OperationError;
  /** Which step to repeat after the user fixes the cause. */
  retry: "test" | "inspect";
}

export type ConnectionPhase = "idle" | "testing" | "loadingSchemas" | "inspecting";

interface ConnectionState {
  draft: ConnectionDraft;
  isDialogOpen: boolean;
  phase: ConnectionPhase;
  tested: TestedConnection | null;
  inspection: RunningInspection | null;
  failure: ConnectionFailure | null;
  validation: DraftValidationError | null;
  openDialog: () => void;
  closeDialog: () => void;
  updateDraft: (patch: Partial<ConnectionDraft>) => void;
  testConnection: () => Promise<void>;
  selectDatabase: (database: string) => Promise<void>;
  inspect: () => Promise<void>;
  refresh: () => Promise<void>;
  cancel: () => Promise<void>;
  trustCertificateAndRetry: () => Promise<void>;
  dismissFailure: () => void;
}

const CONNECTION_STORAGE_KEY = "schemacraft.connection";

/** Draft fields that do not invalidate a successful test when they change. */
const FIELDS_KEPT_AFTER_TEST: ReadonlySet<keyof ConnectionDraft> = new Set([
  "database",
  "schemas",
  "includeViews",
]);

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set, get) => {
      const runInspection = async (
        settings: ConnectionSettings,
        options: InspectionOptions,
        target: string,
        database: string,
      ): Promise<void> => {
        set({
          phase: "inspecting",
          failure: null,
          inspection: { jobId: null, database, stages: {}, isCancelling: false },
        });

        const handleEvent = (event: InspectionEvent) => {
          set((state) => {
            if (state.inspection === null) {
              return {};
            }
            if (event.event === "started") {
              return { inspection: { ...state.inspection, jobId: event.data.jobId } };
            }
            return {
              inspection: {
                ...state.inspection,
                stages: { ...state.inspection.stages, [event.data.stage]: event.data.count },
              },
            };
          });
        };

        try {
          const backend = await getConnectionBackend();
          const snapshot = await backend.inspectDatabase(settings, options, handleEvent);
          useSchemaStore
            .getState()
            .setSnapshot(snapshot, { target, database, settings, loadedAt: new Date() });
          set({ phase: "idle", inspection: null, isDialogOpen: false });
        } catch (caught: unknown) {
          const error = toOperationError(caught);
          const wasCancelled = inspectorErrorKind(error) === "cancelled";
          set({
            phase: "idle",
            inspection: null,
            failure: wasCancelled ? null : { error, retry: "inspect" },
          });
        }
      };

      return {
        draft: emptyConnectionDraft,
        isDialogOpen: false,
        phase: "idle",
        tested: null,
        inspection: null,
        failure: null,
        validation: null,

        openDialog: () => {
          set({ isDialogOpen: true, failure: null, validation: null });
        },

        closeDialog: () => {
          if (get().phase === "inspecting") {
            return;
          }
          set({ isDialogOpen: false, failure: null, validation: null });
        },

        updateDraft: (patch) => {
          const invalidatesTest = Object.keys(patch).some(
            (field) => !FIELDS_KEPT_AFTER_TEST.has(field as keyof ConnectionDraft),
          );
          set((state) => ({
            draft: { ...state.draft, ...patch },
            tested: invalidatesTest ? null : state.tested,
            failure: null,
            validation: null,
          }));
        },

        testConnection: async () => {
          const { draft } = get();
          const built = draftToSettings(draft, null);
          if (!built.ok) {
            set({ validation: built.error });
            return;
          }
          set({ phase: "testing", failure: null, validation: null, tested: null });

          try {
            const backend = await getConnectionBackend();
            const server = await backend.testConnection(built.settings);
            const databases = await backend.listDatabases(built.settings);
            set({ phase: "idle", tested: { server, databases, schemas: [] } });

            const preferred =
              draft.database !== null && databases.includes(draft.database)
                ? draft.database
                : databases.length === 1
                  ? databases[0]
                  : null;
            if (preferred !== undefined && preferred !== null) {
              await get().selectDatabase(preferred);
            } else {
              set((state) => ({ draft: { ...state.draft, database: null, schemas: [] } }));
            }
          } catch (caught: unknown) {
            set({ phase: "idle", failure: { error: toOperationError(caught), retry: "test" } });
          }
        },

        selectDatabase: async (database) => {
          const { draft, tested } = get();
          set({ draft: { ...draft, database, schemas: [] }, failure: null });
          if (tested === null) {
            return;
          }
          const built = draftToSettings({ ...draft, database }, database);
          if (!built.ok) {
            set({ validation: built.error });
            return;
          }
          set({ phase: "loadingSchemas" });

          try {
            const backend = await getConnectionBackend();
            const schemas = await backend.listSchemas(built.settings);
            set((state) => ({
              phase: "idle",
              tested: state.tested === null ? null : { ...state.tested, schemas },
            }));
          } catch (caught: unknown) {
            set({ phase: "idle", failure: { error: toOperationError(caught), retry: "test" } });
          }
        },

        inspect: async () => {
          const { draft, tested } = get();
          if (tested === null || draft.database === null) {
            return;
          }
          const built = draftToSettings(draft, draft.database);
          if (!built.ok) {
            set({ validation: built.error });
            return;
          }
          await runInspection(
            built.settings,
            draftToInspectionOptions(draft),
            built.target,
            draft.database,
          );
        },

        refresh: async () => {
          const source = useSchemaStore.getState().source;
          if (source === null || get().phase !== "idle") {
            return;
          }
          set({ isDialogOpen: true });
          await runInspection(
            source.settings,
            draftToInspectionOptions(get().draft),
            source.target,
            source.database,
          );
        },

        cancel: async () => {
          const { inspection } = get();
          if (!inspection?.jobId || inspection.isCancelling) {
            return;
          }
          set({ inspection: { ...inspection, isCancelling: true } });
          try {
            const backend = await getConnectionBackend();
            await backend.cancelInspection(inspection.jobId);
          } catch (caught: unknown) {
            console.warn("Could not cancel the inspection", caught);
          }
        },

        trustCertificateAndRetry: async () => {
          const retry = get().failure?.retry ?? "test";
          get().updateDraft({ trustServerCertificate: true });
          await get().testConnection();
          if (retry === "inspect" && get().tested !== null && get().failure === null) {
            await get().inspect();
          }
        },

        dismissFailure: () => {
          set({ failure: null });
        },
      };
    },
    {
      name: CONNECTION_STORAGE_KEY,
      version: 1,
      partialize: (state) => ({ draft: { ...state.draft, password: "" } }),
    },
  ),
);
