import type { AccessProfile } from "@/shared/contracts";
import { useI18n } from "@/shared/i18n/useI18n";

import styles from "./AccessReportDialog.module.css";

/** PostgreSQL catalog evidence is not translated into SQL Server's permission lattice. */
export function PostgreSqlAccessEvidence({ access }: { access: AccessProfile }) {
  const { t } = useI18n();
  const evidence = access.postgresql;
  const flag = (value: boolean) => t(value ? "review.value.yes" : "review.value.no");
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("access.postgresql.title")}</h3>
      <p className={styles.note}>{t("access.postgresql.description")}</p>
      {evidence === undefined ? (
        <p>{t("access.postgresql.noEvidence")}</p>
      ) : (
        <>
          <dl className={styles.facts}>
            <dt>{t("access.postgresql.objectCatalog")}</dt>
            <dd>{flag(evidence.objectCatalogRead)}</dd>
            <dt>{t("access.postgresql.programmabilityCatalog")}</dt>
            <dd>{flag(evidence.programmabilityCatalogRead)}</dd>
            <dt>{t("access.postgresql.definitionState")}</dt>
            <dd>
              {evidence.definitions.status === "read"
                ? t("review.value.yes")
                : evidence.definitions.status === "notRead"
                  ? t(`access.code.${evidence.definitions.reason}`)
                  : t("access.code.unknown")}
            </dd>
          </dl>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t("access.report.schemas.name")}</th>
                <th scope="col">{t("access.postgresql.usage")}</th>
              </tr>
            </thead>
            <tbody>
              {evidence.schemas.map((schema) => (
                <tr key={schema.name}>
                  <th scope="row" className={styles.mono}>
                    {schema.name}
                  </th>
                  <td>{flag(schema.hasUsage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
