import { useId } from "react";
import type { RefObject } from "react";

import type { PostgreSqlEncryptionMode } from "@/shared/contracts/generated/inspectors/PostgreSqlEncryptionMode";
import { useI18n } from "@/shared/i18n/useI18n";
import { Checkbox } from "@/shared/ui/Checkbox";
import { Select } from "@/shared/ui/Select";
import { TextField } from "@/shared/ui/TextField";

import type { ConnectionDraft, DraftValidationError } from "./connectionDraft";
import styles from "./ConnectionForm.module.css";

interface PostgreSqlFieldsProps {
  draft: ConnectionDraft;
  updateDraft: (patch: Partial<ConnectionDraft>) => void;
  disabled: boolean;
  validation: DraftValidationError | null;
  passwordHint?: string;
  serverFieldRef: RefObject<HTMLInputElement | null>;
  passwordFieldRef: RefObject<HTMLInputElement | null>;
}

/** Native PostgreSQL transport/authentication, with no named-instance or Windows-auth controls. */
export function PostgreSqlFields({
  draft,
  updateDraft,
  disabled,
  validation,
  passwordHint,
  serverFieldRef,
  passwordFieldRef,
}: PostgreSqlFieldsProps) {
  const { t } = useI18n();
  const certificateId = useId();
  const certificateHintId = useId();
  const encryptionOptions = (["verifyFull", "require", "disable"] as const).map((value) => ({
    value,
    label: t(`connection.postgresql.encryption.${value}`),
  }));
  return (
    <>
      <TextField
        ref={serverFieldRef}
        label={t("connection.field.server")}
        placeholder={t("connection.postgresql.server.placeholder")}
        hint={t("connection.postgresql.server.hint")}
        error={
          validation?.field === "server" ? t("connection.postgresql.server.invalid") : undefined
        }
        value={draft.server}
        onChange={(event) => {
          updateDraft({ server: event.currentTarget.value });
        }}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
      />
      <div className={styles.row}>
        <TextField
          label={t("connection.field.username")}
          value={draft.username}
          error={
            validation?.field === "username" ? t("connection.field.username.errorEmpty") : undefined
          }
          onChange={(event) => {
            updateDraft({ username: event.currentTarget.value });
          }}
          autoComplete="username"
          spellCheck={false}
          disabled={disabled}
        />
        <TextField
          ref={passwordFieldRef}
          label={t("connection.field.password")}
          type="password"
          hint={passwordHint}
          value={draft.password}
          onChange={(event) => {
            updateDraft({ password: event.currentTarget.value });
          }}
          autoComplete="current-password"
          disabled={disabled}
        />
      </div>
      <Checkbox
        label={t("connection.field.rememberPassword")}
        description={t("connection.field.rememberPassword.description")}
        checked={draft.rememberPassword}
        disabled={disabled}
        onCheckedChange={(rememberPassword) => {
          updateDraft({ rememberPassword });
        }}
      />
      <Select<PostgreSqlEncryptionMode>
        label={t("connection.field.encryption")}
        value={draft.postgreSqlEncryption}
        options={encryptionOptions}
        placeholder={t("connection.field.encryption")}
        disabled={disabled}
        onValueChange={(postgreSqlEncryption) => {
          updateDraft({ postgreSqlEncryption });
        }}
        hint={
          validation?.field === "postgreSqlEncryption"
            ? t("connection.postgresql.encryption.localOnly")
            : t("connection.postgresql.encryption.hint")
        }
      />
      <div className={styles.field}>
        <label htmlFor={certificateId} className={styles.fieldLabel}>
          {t("connection.postgresql.rootCertificate")}
        </label>
        <textarea
          id={certificateId}
          className={styles.certificate}
          value={draft.rootCertificate}
          disabled={disabled}
          onChange={(event) => {
            updateDraft({ rootCertificate: event.currentTarget.value });
          }}
          spellCheck={false}
          aria-invalid={validation?.field === "rootCertificate" ? true : undefined}
          aria-describedby={certificateHintId}
        />
        <p id={certificateHintId} className={styles.hint}>
          {validation?.field === "rootCertificate"
            ? t("connection.postgresql.rootCertificate.invalid")
            : t("connection.postgresql.rootCertificate.hint")}
        </p>
      </div>
    </>
  );
}
