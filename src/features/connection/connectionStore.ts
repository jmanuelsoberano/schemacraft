import { create } from "zustand";
import { persist } from "zustand/middleware";

import { usePreferencesStore } from "@/features/preferences/preferencesStore";
import { useProjectStore } from "@/features/project/projectStore";
import { toSavedConnection } from "@/features/project/savedConnection";
import type {
  AccessProfile,
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
import { getCredentialsBackend } from "@/shared/ipc/credentialsBackend";
import { inspectorErrorKind, toOperationError } from "@/shared/ipc/operationError";
import type { OperationError } from "@/shared/ipc/operationError";
import { getProjectBackend } from "@/shared/ipc/projectBackend";

import {
  savedConnectionKey,
  savedConnectionToDraft,
  savedConnectionToSettings,
} from "./fromSavedConnection";
import { draftToInspectionOptions, draftToSettings, emptyConnectionDraft } from "./connectionDraft";
import type { ConnectionDraft, DraftValidationError } from "./connectionDraft";

/** Result of a successful "Test connection". */
export interface TestedConnection {
  server: ServerInformation;
  databases: string[];
  /** Schemas of the selected database; empty until a database is chosen. */
  schemas: string[];
  /** Schemas containing only procedures or functions, offered when code is included. */
  programmabilityOnlySchemas?: string[];
  /**
   * What the login is predicted to see in the selected database, from the access probe;
   * `null` until a database is chosen.
   */
  access: AccessProfile | null;
}

/** A read that stopped because the login sees no table or view, so there was nothing to show. */
export interface BlockedInspection {
  database: string;
  access: AccessProfile;
}

/** Stages reported so far; the value is the object count, or `null` for stages without one. */
export type StageProgress = Partial<Record<InspectionStage, number | null>>;

export interface RunningInspection {
  jobId: string | null;
  database: string;
  /** The options of this read, independent of later edits to the form. */
  options: InspectionOptions;
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
  sourceDocumentToken?: number;
  sourceSnapshot?: SchemaSnapshot;
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
  /**
   * Set when a read found that the login sees nothing. No project is created or reviewed, and
   * reading again is not offered until the connection or the database changes.
   */
  blockedInspection: BlockedInspection | null;
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

/**
 * Whether "Read schema" may run: a database is chosen, and the login is not known to see
 * nothing there, as predicted when the database was selected or found by the last read.
 */
export function canReadSchema(
  state: Pick<ConnectionState, "draft" | "tested" | "blockedInspection">,
): boolean {
  return (
    state.draft.database !== null &&
    state.tested?.access?.level !== "nothingVisible" &&
    state.blockedInspection === null
  );
}

/** Draft fields that do not invalidate a successful test when they change. */
const FIELDS_KEPT_AFTER_TEST: ReadonlySet<keyof ConnectionDraft> = new Set([
  "database",
  "schemas",
  "includeViews",
  "includeProgrammability",
  "includeModuleDefinitions",
  "includeDependencies",
  "rememberPassword",
]);

/**
 * The state with the stored draft restored over the current one, field by field, so a field the
 * stored draft predates, such as the code options of 1.2, keeps its default instead of being
 * left out.
 */
export function mergePersistedConnection<State extends { draft: ConnectionDraft }>(
  persisted: unknown,
  current: State,
): State {
  const stored =
    typeof persisted === "object" && persisted !== null && "draft" in persisted
      ? persisted.draft
      : null;
  if (typeof stored !== "object" || stored === null) {
    return current;
  }
  const values = stored as Record<string, unknown>;
  const draft = { ...current.draft, password: "" };
  for (const field of ["server", "username", "rootCertificate"] as const) {
    const value = values[field];
    if (typeof value === "string") draft[field] = value;
  }
  for (const field of [
    "rememberPassword",
    "passwordIsStored",
    "includeViews",
    "includeProgrammability",
    "includeModuleDefinitions",
    "includeDependencies",
    "trustServerCertificate",
  ] as const) {
    const value = values[field];
    if (typeof value === "boolean") draft[field] = value;
  }
  if (values.database === null || typeof values.database === "string")
    draft.database = values.database;
  if (
    Array.isArray(values.schemas) &&
    values.schemas.every((value: unknown): value is string => typeof value === "string")
  )
    draft.schemas = values.schemas;
  if (values.provider === "sqlServer" || values.provider === "postgreSql")
    draft.provider = values.provider;
  if (values.authenticationMode === "integrated" || values.authenticationMode === "sqlLogin")
    draft.authenticationMode = values.authenticationMode;
  if (
    values.encryption === "mandatory" ||
    values.encryption === "optional" ||
    values.encryption === "strict"
  )
    draft.encryption = values.encryption;
  if (
    values.postgreSqlEncryption === "verifyFull" ||
    values.postgreSqlEncryption === "require" ||
    values.postgreSqlEncryption === "disable"
  )
    draft.postgreSqlEncryption = values.postgreSqlEncryption;
  if (draft.rootCertificate.includes("PRIVATE KEY")) draft.rootCertificate = "";
  return { ...current, draft };
}

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set, get) => {
      let attempt = 0;
      const markStoredPassword = async (connection: SavedConnection): Promise<void> => {
        const key = savedConnectionKey(connection);
        try {
          const backend = await getCredentialsBackend();
          const stored = await backend.hasStoredPassword(connection);
          set((state) => {
            const current = draftToSettings(state.draft);
            if (!current.ok || savedConnectionKey(toSavedConnection(current.settings)) !== key)
              return {};
            return {
              draft: { ...state.draft, passwordIsStored: stored, rememberPassword: stored },
            };
          });
        } catch {
          console.warn("Could not check for a remembered password");
        }
      };

      // Honours the "remember password" choice once the connection proved to work.
      const syncRememberedPassword = async (
        settings: ConnectionSettings,
        draft: ConnectionDraft,
      ): Promise<void> => {
        if (settings.provider === "sqlServer" && settings.authentication.mode !== "sqlLogin") {
          return;
        }
        const connection = toSavedConnection(settings);
        const key = savedConnectionKey(connection);
        const setStoredFlag = (stored: boolean): void => {
          set((state) => {
            const current = draftToSettings(state.draft);
            if (!current.ok || savedConnectionKey(toSavedConnection(current.settings)) !== key)
              return {};
            return { draft: { ...state.draft, passwordIsStored: stored } };
          });
        };
        try {
          const backend = await getCredentialsBackend();
          if (draft.rememberPassword && draft.password !== "") {
            await backend.rememberPassword(connection, draft.password);
            setStoredFlag(true);
          } else if (!draft.rememberPassword && draft.passwordIsStored) {
            await backend.forgetPassword(connection);
            setStoredFlag(false);
          }
        } catch {
          console.warn("Could not update the remembered password");
        }
      };

      const runInspection = async (
        settings: ConnectionSettings,
        options: InspectionOptions,
        database: string,
        rememberFromForm: boolean,
      ): Promise<void> => {
        const originalDraft = get().draft;
        const origin = useProjectStore.getState().project;
        const mode = get().mode;
        const request = ++attempt;
        set({
          phase: "inspecting",
          failure: null,
          blockedInspection: null,
          inspection: {
            jobId: null,
            database,
            options: { ...options, schemas: [...options.schemas] },
            stages: {},
            isCancelling: false,
          },
        });

        const handleEvent = (event: InspectionEvent) => {
          if (request !== attempt) return;
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
          if (request !== attempt) return;
          if (rememberFromForm) {
            await syncRememberedPassword(settings, originalDraft);
          }
          if (request !== attempt) return;
          // An empty diagram, or a review that removes everything, would state a falsehood:
          // the login simply sees nothing. Stop here and say so.
          if (snapshot.access?.level === "nothingVisible") {
            set({
              phase: "idle",
              inspection: null,
              blockedInspection: { database, access: snapshot.access },
            });
            return;
          }
          const project = useProjectStore.getState().project;

          if (mode === "refresh" && project !== null) {
            if (
              project.documentToken !== origin?.documentToken ||
              project.content.snapshot !== origin?.content.snapshot
            ) {
              set({ phase: "idle", inspection: null });
              return;
            }
            const diff = await (
              await getProjectBackend()
            ).computeSchemaDiff(project.content.snapshot, snapshot);
            if (request !== attempt) return;
            set({
              phase: "reviewing",
              inspection: null,
              review: {
                diff,
                snapshot,
                settings,
                options,
                sourceDocumentToken: project.documentToken,
                sourceSnapshot: project.content.snapshot,
              },
            });
            return;
          }

          if (
            project?.documentToken !== origin?.documentToken ||
            project?.content.snapshot !== origin?.content.snapshot
          ) {
            set({ phase: "idle", inspection: null });
            return;
          }
          useProjectStore.getState().loadFromInspection(snapshot, settings, options);
          void usePreferencesStore.getState().rememberConnection(toSavedConnection(settings));
          set({ phase: "idle", inspection: null, isDialogOpen: false, mode: "connect" });
        } catch (caught: unknown) {
          if (request !== attempt) return;
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
        blockedInspection: null,

        openDialog: () => {
          set({
            isDialogOpen: true,
            mode: "connect",
            failure: null,
            validation: null,
            blockedInspection: null,
          });
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
          ++attempt;
          set({
            isDialogOpen: false,
            mode: "connect",
            failure: null,
            validation: null,
            blockedInspection: null,
            phase: "idle",
          });
        },

        updateDraft: (patch) => {
          if (patch.provider !== undefined && patch.provider !== get().draft.provider) {
            if (get().mode === "refresh") return;
            ++attempt;
            set({
              draft: {
                ...emptyConnectionDraft,
                ...patch,
                provider: patch.provider,
                authenticationMode:
                  patch.provider === "postgreSql"
                    ? "sqlLogin"
                    : (patch.authenticationMode ?? "integrated"),
                password: patch.password ?? "",
                passwordIsStored: false,
                rememberPassword: patch.rememberPassword ?? false,
              },
              tested: null,
              failure: null,
              validation: null,
              blockedInspection: null,
              phase: "idle",
              inspection: null,
            });
            return;
          }
          const invalidatesTest =
            (get().draft.provider === "postgreSql" && "database" in patch) ||
            Object.keys(patch).some(
              (field) => !FIELDS_KEPT_AFTER_TEST.has(field as keyof ConnectionDraft),
            );
          // The verdict covers the whole database: other schemas, the views option or remembering
          // the password would read the same nothing, so only another connection or database
          // lifts it.
          const unblocks = invalidatesTest || "database" in patch;
          if (invalidatesTest) ++attempt;
          set((state) => ({
            draft: {
              ...state.draft,
              ...patch,
              ...("server" in patch || "username" in patch || "authenticationMode" in patch
                ? { passwordIsStored: false, rememberPassword: patch.rememberPassword ?? false }
                : {}),
            },
            tested: invalidatesTest ? null : state.tested,
            failure: null,
            validation: null,
            blockedInspection: unblocks ? null : state.blockedInspection,
            ...(invalidatesTest && (state.phase === "testing" || state.phase === "loadingSchemas")
              ? { phase: "idle" as const }
              : {}),
          }));
        },

        applyRecentConnection: (connection) => {
          ++attempt;
          set({
            draft: savedConnectionToDraft(connection),
            tested: null,
            failure: null,
            validation: null,
            blockedInspection: null,
            phase: "idle",
          });
          void markStoredPassword(connection);
        },

        testConnection: async () => {
          const request = ++attempt;
          const { draft } = get();
          const built = draftToSettings(
            draft,
            draft.provider === "postgreSql" ? draft.database : null,
          );
          if (!built.ok) {
            set({ validation: built.error });
            return;
          }
          set({
            phase: "testing",
            failure: null,
            validation: null,
            tested: null,
            blockedInspection: null,
          });

          try {
            const backend = await getConnectionBackend();
            const server = await backend.testConnection(built.settings);
            if (request !== attempt) return;
            const databases = await backend.listDatabases(built.settings);
            if (request !== attempt) return;
            set({ phase: "idle", tested: { server, databases, schemas: [], access: null } });

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
            if (request !== attempt) return;
            set({ phase: "idle", failure: { error: toOperationError(caught), retry: "test" } });
          }
        },

        selectDatabase: async (database) => {
          const request = ++attempt;
          const { draft, tested } = get();
          set({
            draft: {
              ...draft,
              database,
              schemas: draft.database === database ? draft.schemas : [],
            },
            tested:
              tested === null
                ? null
                : { ...tested, schemas: [], programmabilityOnlySchemas: [], access: null },
            failure: null,
            blockedInspection: null,
          });
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
            const { schemas, programmabilityOnlySchemas, access } = await backend.describeDatabase(
              built.settings,
            );
            if (request !== attempt) return;
            set((state) => ({
              phase: "idle",
              tested:
                state.tested === null
                  ? null
                  : { ...state.tested, schemas, programmabilityOnlySchemas, access },
            }));
          } catch (caught: unknown) {
            if (request !== attempt) return;
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
          await runInspection(
            built.settings,
            draftToInspectionOptions(draft),
            draft.database,
            true,
          );
        },

        refresh: async () => {
          const project = useProjectStore.getState().project;
          // A newer version wrote a read-only project; a snapshot read by this one would
          // replace facts it does not understand.
          if (project === null || project.isReadOnly || get().phase !== "idle") {
            return;
          }
          const database =
            project.content.connection.database ?? project.content.snapshot.databaseName;

          if (project.liveSettings !== null) {
            set({
              isDialogOpen: true,
              mode: "refresh",
              failure: null,
              validation: null,
              blockedInspection: null,
            });
            await runInspection(project.liveSettings, project.content.inspection, database, false);
            return;
          }

          // The project came from a file: the form is prefilled, and when no password is
          // needed (Windows Authentication, or a remembered one) the schema is read right away.
          const { connection, inspection } = project.content;
          set({
            isDialogOpen: true,
            mode: "refresh",
            failure: null,
            validation: null,
            blockedInspection: null,
            tested: null,
            draft: savedConnectionToDraft(connection, inspection),
          });
          await markStoredPassword(connection);
          if (useProjectStore.getState().project?.documentToken !== project.documentToken) return;
          if (
            (connection.provider === "sqlServer" &&
              connection.authentication.mode === "integrated") ||
            get().draft.passwordIsStored
          ) {
            await runInspection(
              savedConnectionToSettings(connection, { source: "stored" }),
              inspection,
              database,
              false,
            );
          }
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
          if (get().draft.provider !== "sqlServer") return;
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
          if (
            (review.sourceDocumentToken !== undefined &&
              review.sourceDocumentToken !== project.documentToken) ||
            (review.sourceSnapshot !== undefined &&
              review.sourceSnapshot !== project.content.snapshot)
          ) {
            set({ phase: "idle", review: null });
            return;
          }
          const request = ++attempt;
          set({ phase: "applying", failure: null });
          try {
            const backend = await getProjectBackend();
            const content = await backend.refreshProjectContent(
              {
                ...project.content,
                connection: toSavedConnection(review.settings),
                inspection: review.options,
              },
              review.snapshot,
            );
            if (request !== attempt) return;
            const current = useProjectStore.getState().project;
            if (
              current === null ||
              current.documentToken !== project.documentToken ||
              current.content.snapshot !== project.content.snapshot ||
              current.editRevision !== project.editRevision
            ) {
              set({ phase: "idle", review: null });
              return;
            }
            useProjectStore.getState().applyRefreshedContent(content, review.settings);
            void usePreferencesStore
              .getState()
              .rememberConnection(toSavedConnection(review.settings));
            set({ phase: "idle", review: null, isDialogOpen: false, mode: "connect" });
          } catch (caught: unknown) {
            if (request !== attempt) return;
            set({
              phase: "reviewing",
              failure: { error: toOperationError(caught), retry: "inspect" },
            });
          }
        },

        discardReview: () => {
          ++attempt;
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
      partialize: (state) => ({
        draft: {
          ...state.draft,
          password: "",
          rootCertificate: state.draft.rootCertificate.includes("PRIVATE KEY")
            ? ""
            : state.draft.rootCertificate,
        },
      }),
      merge: mergePersistedConnection,
    },
  ),
);
