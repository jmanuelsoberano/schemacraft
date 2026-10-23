import { ShieldCheck, X } from "lucide-react";
import type { RefObject } from "react";

import { usePreferencesStore } from "@/features/preferences/preferencesStore";
import type { EncryptionMode } from "@/shared/contracts";
import { useI18n } from "@/shared/i18n/useI18n";
import { Alert } from "@/shared/ui/Alert";
import { Button } from "@/shared/ui/Button";
import { Checkbox } from "@/shared/ui/Checkbox";
import { IconButton } from "@/shared/ui/IconButton";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import type { SegmentedOption } from "@/shared/ui/SegmentedControl";
import { Select } from "@/shared/ui/Select";
import type { SelectOption } from "@/shared/ui/Select";
import { Spinner } from "@/shared/ui/Spinner";
import { TextField } from "@/shared/ui/TextField";

import { AccessCheckNotice } from "./AccessCheckNotice";
import { describeSavedConnection, savedConnectionKey } from "./fromSavedConnection";
import styles from "./ConnectionForm.module.css";
import type { AuthenticationMode, ConnectionDraft } from "./connectionDraft";
import { useConnectionStore } from "./connectionStore";
import { describeOperationError } from "@/shared/errors/describeOperationError";
import { toggleSchema } from "./schemaSelection";
import { PostgreSqlFields } from "./PostgreSqlFields";

interface ConnectionFormProps {
  serverFieldRef: RefObject<HTMLInputElement | null>;
  passwordFieldRef: RefObject<HTMLInputElement | null>;
}

export function ConnectionForm({ serverFieldRef, passwordFieldRef }: ConnectionFormProps) {
  const translator = useI18n();
  const { t } = translator;
  const draft = useConnectionStore((state) => state.draft);
  const mode = useConnectionStore((state) => state.mode);
  const phase = useConnectionStore((state) => state.phase);
  const tested = useConnectionStore((state) => state.tested);
  const failure = useConnectionStore((state) => state.failure);
  const blockedInspection = useConnectionStore((state) => state.blockedInspection);
  const validation = useConnectionStore((state) => state.validation);
  const updateDraft = useConnectionStore((state) => state.updateDraft);
  const applyRecentConnection = useConnectionStore((state) => state.applyRecentConnection);
  const testConnection = useConnectionStore((state) => state.testConnection);
  const selectDatabase = useConnectionStore((state) => state.selectDatabase);
  const inspect = useConnectionStore((state) => state.inspect);
  const trustCertificateAndRetry = useConnectionStore((state) => state.trustCertificateAndRetry);
  const recentConnections = usePreferencesStore((state) => state.recentConnections);
  const forgetConnection = usePreferencesStore((state) => state.forgetConnection);

  const isBusy = phase !== "idle";
  // What the access probe predicts for the chosen database; a read that found nothing to see
  // replaces it with its own notice.
  const predictedAccess = tested?.access ?? null;
  const codeOnlySchemas = draft.includeProgrammability
    ? (tested?.programmabilityOnlySchemas ?? [])
    : [];
  const schemaOptions = [...(tested?.schemas ?? []), ...codeOnlySchemas];
  const showsHistory = mode === "connect" && recentConnections.length > 0;
  const passwordHint =
    draft.passwordIsStored && draft.password === ""
      ? t("connection.password.stored")
      : mode === "refresh"
        ? t("connection.refresh.passwordHint")
        : undefined;

  const authenticationOptions: readonly SegmentedOption<AuthenticationMode>[] = [
    {
      value: "integrated",
      label: t("connection.authentication.integrated"),
      hint: t("connection.authentication.integrated.hint"),
    },
    {
      value: "sqlLogin",
      label: t("connection.authentication.sqlLogin"),
      hint: t("connection.authentication.sqlLogin.hint"),
    },
  ];

  const encryptionOptions: readonly SelectOption<EncryptionMode>[] = [
    { value: "mandatory", label: t("connection.encryption.mandatory") },
    { value: "optional", label: t("connection.encryption.optional") },
    { value: "strict", label: t("connection.encryption.strict") },
  ];

  // Before a test, a prefilled database (from the history or a project) is the only option.
  const knownDatabases = tested?.databases ?? (draft.database === null ? [] : [draft.database]);
  const databaseOptions: readonly SelectOption<string>[] = knownDatabases.map((database) => ({
    value: database,
    label: database,
  }));

  const serverError =
    validation?.field === "server"
      ? validation.reason === "empty"
        ? t("connection.field.server.errorEmpty")
        : t("connection.field.server.errorPort")
      : undefined;
  const usernameError =
    validation?.field === "username" ? t("connection.field.username.errorEmpty") : undefined;

  const retryFailedStep = () => {
    if (failure?.retry === "inspect") {
      void inspect();
    } else {
      void testConnection();
    }
  };

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void testConnection();
      }}
    >
      {showsHistory ? (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("connection.recent.title")}</h3>
          <ul className={styles.recentList}>
            {recentConnections.map((entry) => {
              const { target, database, login } = describeSavedConnection(entry.connection);
              const details = [database, login ?? t("connection.recent.windows")]
                .filter((part): part is string => part !== null)
                .join(" · ");
              return (
                <li key={savedConnectionKey(entry.connection)} className={styles.recentItem}>
                  <button
                    type="button"
                    className={styles.recentButton}
                    aria-label={t("connection.recent.use", { target })}
                    disabled={isBusy}
                    onClick={() => {
                      applyRecentConnection(entry.connection);
                      serverFieldRef.current?.focus();
                    }}
                  >
                    <span className={styles.recentTarget}>{target}</span>
                    <span className={styles.recentMeta}>{details}</span>
                  </button>
                  <IconButton
                    label={t("connection.recent.remove", { target })}
                    icon={X}
                    disabled={isBusy}
                    onClick={() => {
                      void forgetConnection(entry.connection);
                    }}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("connection.section.server")}</h3>
        <Select<ConnectionDraft["provider"]>
          label={t("connection.provider")}
          value={draft.provider}
          options={[
            { value: "sqlServer", label: t("connection.provider.sqlServer") },
            { value: "postgreSql", label: t("connection.provider.postgreSql") },
          ]}
          placeholder={t("connection.provider")}
          disabled={isBusy || mode === "refresh"}
          onValueChange={(provider) => {
            updateDraft({ provider });
          }}
        />
        {draft.provider === "postgreSql" ? (
          <PostgreSqlFields
            draft={draft}
            updateDraft={updateDraft}
            disabled={isBusy}
            validation={validation}
            passwordHint={passwordHint}
            serverFieldRef={serverFieldRef}
            passwordFieldRef={passwordFieldRef}
          />
        ) : (
          <>
            <TextField
              ref={serverFieldRef}
              label={t("connection.field.server")}
              placeholder={t("connection.field.server.placeholder")}
              hint={t("connection.field.server.hint")}
              error={serverError}
              value={draft.server}
              onChange={(event) => {
                updateDraft({ server: event.target.value });
              }}
              autoComplete="off"
              spellCheck={false}
              disabled={isBusy}
            />
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t("connection.field.authentication")}</span>
              <SegmentedControl
                ariaLabel={t("connection.field.authentication")}
                value={draft.authenticationMode}
                options={authenticationOptions}
                onValueChange={(authenticationMode) => {
                  updateDraft({ authenticationMode });
                }}
                disabled={isBusy}
              />
            </div>
            {draft.authenticationMode === "sqlLogin" ? (
              <>
                <div className={styles.row}>
                  <TextField
                    label={t("connection.field.username")}
                    error={usernameError}
                    value={draft.username}
                    onChange={(event) => {
                      updateDraft({ username: event.target.value });
                    }}
                    autoComplete="username"
                    spellCheck={false}
                    disabled={isBusy}
                  />
                  <TextField
                    ref={passwordFieldRef}
                    label={t("connection.field.password")}
                    type="password"
                    hint={passwordHint}
                    value={draft.password}
                    onChange={(event) => {
                      updateDraft({ password: event.target.value });
                    }}
                    autoComplete="current-password"
                    disabled={isBusy}
                  />
                </div>
                <Checkbox
                  label={t("connection.field.rememberPassword")}
                  description={t("connection.field.rememberPassword.description")}
                  checked={draft.rememberPassword}
                  disabled={isBusy}
                  onCheckedChange={(rememberPassword) => {
                    updateDraft({ rememberPassword });
                  }}
                />
              </>
            ) : null}
            <div className={styles.row}>
              <Select
                label={t("connection.field.encryption")}
                value={draft.encryption}
                options={encryptionOptions}
                placeholder={t("connection.field.encryption")}
                disabled={isBusy}
                onValueChange={(encryption) => {
                  updateDraft({ encryption });
                }}
              />
              <div className={styles.checkboxCell}>
                <Checkbox
                  label={t("connection.field.trustCertificate")}
                  description={t("connection.field.trustCertificate.description")}
                  checked={draft.trustServerCertificate}
                  disabled={isBusy}
                  onCheckedChange={(trustServerCertificate) => {
                    updateDraft({ trustServerCertificate });
                  }}
                />
              </div>
            </div>
          </>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("connection.section.database")}</h3>
        {draft.provider === "postgreSql" ? (
          <TextField
            label={t("connection.field.database")}
            value={draft.database ?? ""}
            hint={t("connection.postgresql.database.hint")}
            disabled={isBusy}
            onChange={(event) => {
              updateDraft({
                database: event.currentTarget.value === "" ? null : event.currentTarget.value,
              });
            }}
            autoComplete="off"
            spellCheck={false}
          />
        ) : (
          <Select
            label={t("connection.field.database")}
            value={draft.database ?? undefined}
            options={databaseOptions}
            placeholder={t("connection.field.database.placeholder")}
            hint={tested === null ? t("connection.field.database.hint") : undefined}
            disabled={tested === null || isBusy}
            onValueChange={(database) => {
              void selectDatabase(database);
            }}
          />
        )}
        {tested !== null && draft.database !== null ? (
          <fieldset className={styles.schemas}>
            <legend className={styles.fieldLabel}>{t("connection.field.schemas")}</legend>
            {phase === "loadingSchemas" ? (
              <span className={styles.inlineStatus}>
                <Spinner size={14} />
                {t("connection.schemas.loading")}
              </span>
            ) : (
              <div className={styles.schemaList}>
                <Checkbox
                  label={t("connection.schemas.all")}
                  checked={draft.schemas.length === 0}
                  disabled={isBusy}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      updateDraft({ schemas: [] });
                    }
                  }}
                />
                {schemaOptions.map((schema) => (
                  <Checkbox
                    key={schema}
                    label={schema}
                    description={
                      codeOnlySchemas.includes(schema)
                        ? t("connection.schemas.codeOnly")
                        : undefined
                    }
                    checked={draft.schemas.length === 0 || draft.schemas.includes(schema)}
                    disabled={isBusy}
                    onCheckedChange={(checked) => {
                      updateDraft({
                        schemas: toggleSchema(schemaOptions, draft.schemas, schema, checked),
                      });
                    }}
                  />
                ))}
              </div>
            )}
          </fieldset>
        ) : null}
        <Checkbox
          label={t("connection.field.includeViews")}
          checked={draft.includeViews}
          disabled={isBusy}
          onCheckedChange={(includeViews) => {
            updateDraft({ includeViews });
          }}
        />
        <Checkbox
          label={t("connection.field.includeProgrammability")}
          checked={draft.includeProgrammability}
          disabled={isBusy}
          onCheckedChange={(includeProgrammability) => {
            updateDraft({ includeProgrammability });
          }}
        />
        <Checkbox
          label={t("connection.field.includeModuleDefinitions")}
          description={t("connection.field.includeModuleDefinitions.description")}
          checked={draft.includeModuleDefinitions}
          disabled={isBusy || !draft.includeProgrammability}
          onCheckedChange={(includeModuleDefinitions) => {
            updateDraft({ includeModuleDefinitions });
          }}
        />
        <Checkbox
          label={t("connection.field.includeDependencies")}
          description={t("connection.field.includeDependencies.description")}
          checked={draft.includeDependencies}
          disabled={isBusy}
          onCheckedChange={(includeDependencies) => {
            updateDraft({ includeDependencies });
          }}
        />
        {predictedAccess !== null &&
        draft.database !== null &&
        phase !== "loadingSchemas" &&
        blockedInspection === null ? (
          <AccessCheckNotice
            access={predictedAccess}
            database={draft.database}
            includeCode={draft.includeProgrammability && draft.includeModuleDefinitions}
          />
        ) : null}
      </section>

      {phase === "testing" ? (
        <div className={styles.inlineStatus} role="status">
          <Spinner size={14} />
          {t("connection.status.testing")}
        </div>
      ) : null}

      {blockedInspection !== null ? (
        <AccessCheckNotice
          access={blockedInspection.access}
          database={blockedInspection.database}
        />
      ) : null}

      {failure !== null
        ? (() => {
            const presentation = describeOperationError(failure.error, translator, {
              usesIntegratedAuthentication:
                draft.provider === "sqlServer" && draft.authenticationMode === "integrated",
            });
            return (
              <Alert
                variant="danger"
                title={presentation.title}
                detail={presentation.detail}
                action={
                  presentation.offersCertificateTrust && draft.provider === "sqlServer" ? (
                    <Button
                      variant="primary"
                      leadingIcon={ShieldCheck}
                      disabled={isBusy}
                      onClick={() => {
                        void trustCertificateAndRetry();
                      }}
                    >
                      {t("connection.action.trustAndRetry")}
                    </Button>
                  ) : (
                    <Button disabled={isBusy} onClick={retryFailedStep}>
                      {t("connection.action.retry")}
                    </Button>
                  )
                }
              >
                {presentation.hint}
              </Alert>
            );
          })()
        : null}

      {failure === null && tested !== null && phase !== "testing" ? (
        <Alert
          variant="success"
          title={t("connection.status.tested.title", { server: tested.server.serverName })}
        >
          {t("connection.status.tested.detail", {
            product: tested.server.product,
            edition: tested.server.edition,
          })}
        </Alert>
      ) : null}

      <button type="submit" className={styles.hiddenSubmit} tabIndex={-1} aria-hidden="true" />
    </form>
  );
}
