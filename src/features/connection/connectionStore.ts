import { create } from "zustand";
import { persist } from "zustand/middleware";

import { usePreferencesStore } from "@/features/preferences/preferencesStore";
import { useProjectStore } from "@/features/project/projectStore";
import { savedConnectionToDraft, toSavedConnection } from "@/features/project/savedConnection";
import type {
  ConnectionSettings,
  InspectionEvent,
  InspectionOptions,
  InspectionStage,
  SavedConnection,
  SchemaDiff,
  SchemaSnapshot,
  ServerInformation,
} from "@/shared/contracts";
import { getConnectionBackend } from "@/shared/ipc/connectionBackend";
import { inspectorErrorKind, toOperationError } from "@/shared/ipc/operationError";
import type { OperationError } from "@/shared/ipc/operationError";
import { getProjectBackend } from "@/shared/ipc/projectBackend";

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

/** A fresh snapshot waiting for the user to accept or discard its differences. */
export interface PendingReview {
  diff: SchemaDiff;
  snapshot: SchemaSnapshot;
  settings: ConnectionSettings;
  options: InspectionOptions;
}

/** Whether the dialog starts a project or refreshes the open one. */
export type ConnectionMode = "connect" | "refresh";

export type ConnectionPhase =
  "idle" | "testing" | "loadingSchemas" | "inspecting" | "reviewing" | "applying";

interface ConnectionState {
  draft: ConnectionDraft;
  isDialogOpen: boolean;
  mode: ConnectionMode;
  phase: ConnectionPhase;
  tested: TestedConnection | null;
  inspection: RunningInspection | null;
  review: PendingReview | null;
  failure: ConnectionFailure | null;
  validation: DraftValidationError | null;
  openDialog: () => void;
  closeDialog: () => void;
  updateDraft: (patch: Partial<ConnectionDraft>) => void;
  /** Fills the form from a history entry; the password must be typed again. */
  applyRecentConnection: (connection: SavedConnection) => void;
  testConnection: () => Promise<void>;
  selectDatabase: (database: string) => Promise<void>;
  inspect: () => Promise<void>;
  /** Reads the open project's database again and prepares the review of the differences. */
  refresh: () => Promise<void>;
  cancel: () => Promise<void>;
  trustCertificateAndRetry: () => Promise<void>;
  applyReview: () => Promise<void>;
  discardReview: () => void;
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
          const project = useProjectStore.getState().project;

          if (get().mode === "refresh" && project !== null) {
            const diff = await (
              await getProjectBackend()
            ).computeSchemaDiff(project.content.snapshot, snapshot);
            set({
              phase: "reviewing",
              inspection: null,
              review: { diff, snapshot, settings, options },
            });
            return;
          }

          useProjectStore.getState().loadFromInspection(snapshot, settings, options);
          void usePreferencesStore.getState().rememberConnection(toSavedConnection(settings));
          set({ phase: "idle", inspection: null, isDialogOpen: false, mode: "connect" });
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
        mode: "connect",
        phase: "idle",
        tested: null,
        inspection: null,
        review: null,
        failure: null,
        validation: null,

        openDialog: () => {
          set({ isDialogOpen: true, mode: "connect", failure: null, validation: null });
        },

        closeDialog: () => {
          const { phase } = get();
          if (phase === "inspecting" || phase === "applying") {
            return;
          }
          if (phase === "reviewing") {
            get().discardReview();
            return;
          }
          set({ isDialogOpen: false, mode: "connect", failure: null, validation: null });
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

        applyRecentConnection: (connection) => {
          set({
            draft: savedConnectionToDraft(connection),
            tested: null,
            failure: null,
            validation: null,
          });
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
          const { draft } = get();
          if (draft.database === null) {
            return;
          }
          const built = draftToSettings(draft, draft.database);
          if (!built.ok) {
            set({ validation: built.error });
            return;
          }
          await runInspection(built.settings, draftToInspectionOptions(draft), draft.database);
        },

        refresh: async () => {
          const project = useProjectStore.getState().project;
          if (project === null || get().phase !== "idle") {
            return;
          }
          const database =
            project.content.connection.database ?? project.content.snapshot.databaseName;

          if (project.liveSettings !== null) {
            set({ isDialogOpen: true, mode: "refresh", failure: null, validation: null });
            await runInspection(project.liveSettings, project.content.inspection, database);
            return;
          }

          // The project came from a file: the password is not known, so the form is shown
          // prefilled and the user reads the schema from it.
          set({
            isDialogOpen: true,
            mode: "refresh",
            failure: null,
            validation: null,
            tested: null,
            draft: savedConnectionToDraft(project.content.connection, project.content.inspection),
          });
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

        applyReview: async () => {
          const { review } = get();
          const project = useProjectStore.getState().project;
          if (review === null || project === null || get().phase !== "reviewing") {
            return;
          }
          set({ phase: "applying", failure: null });
          try {
            const backend = await getProjectBackend();
            const content = await backend.refreshProjectContent(project.content, review.snapshot);
            useProjectStore.getState().applyRefreshedContent(content, review.settings);
            void usePreferencesStore
              .getState()
              .rememberConnection(toSavedConnection(review.settings));
            set({ phase: "idle", review: null, isDialogOpen: false, mode: "connect" });
          } catch (caught: unknown) {
            set({
              phase: "reviewing",
              failure: { error: toOperationError(caught), retry: "inspect" },
            });
          }
        },

        discardReview: () => {
          set({ phase: "idle", review: null, isDialogOpen: false, mode: "connect", failure: null });
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
