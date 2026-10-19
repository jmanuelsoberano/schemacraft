import { ShieldCheck, ShieldHalf, ShieldOff, ShieldQuestionMark } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useProjectStore } from "@/features/project/projectStore";
import { foreignKeyId, qualifiedNameLabel } from "@/features/schema/entities";
import { codeObjectName, groupCodeFacts } from "@/features/schema/codeFacts";
import type { AccessProfile, Completeness, SchemaSnapshot } from "@/shared/contracts";
import { formatDate, formatDateTime } from "@/shared/i18n/formatDate";
import { useI18n } from "@/shared/i18n/useI18n";
import { Button } from "@/shared/ui/Button";
import { Dialog } from "@/shared/ui/Dialog";
import { classNames } from "@/shared/ui/classNames";

import styles from "./AccessReportDialog.module.css";
import { CopyScriptButton } from "./CopyScriptButton";
import {
  accessCauses,
  codeCaptureCause,
  codeGrantHelps,
  describeAccessCause,
  grantHelps,
} from "./accessCause";
import { useAccessReportStore } from "./accessReportStore";
import { grantScript } from "./grantScript";
import { describeSnapshotFact } from "./snapshotFacts";

const COMPLETENESS_ICON: Record<Completeness, LucideIcon> = {
  complete: ShieldCheck,
  partial: ShieldHalf,
  notAvailable: ShieldQuestionMark,
};

const COMPLETENESS_CLASS: Record<Completeness, string | undefined> = {
  complete: styles.complete,
  partial: styles.partial,
  notAvailable: styles.notAvailable,
};

/**
 * What the login that read the open project could see: each kind of fact with its completeness,
 * the causes, the relations to tables it cannot see, the facts kept from an earlier read and the
 * permissions per schema. When a GRANT helps, the script to hand to the DBA comes last.
 */
export function AccessReportDialog() {
  const { t, locale } = useI18n();
  const isOpen = useAccessReportStore((state) => state.isOpen);
  const close = useAccessReportStore((state) => state.close);
  const snapshot = useProjectStore((state) => state.project?.content.snapshot ?? null);

  return (
    <Dialog
      open={isOpen && snapshot !== null}
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
      title={t("access.report.title", { database: snapshot?.databaseName ?? "" })}
      description={
        snapshot === null
          ? undefined
          : t(
              snapshot.access === undefined
                ? "access.report.description.notRecorded"
                : "access.report.description",
              { date: formatDateTime(snapshot.extractedAt, locale) },
            )
      }
      closeLabel={t("connection.action.close")}
      width={620}
      footer={<Button onClick={close}>{t("review.action.close")}</Button>}
    >
      {snapshot === null ? null : <AccessReport snapshot={snapshot} />}
    </Dialog>
  );
}

function StateLine({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <p className={styles.state}>
      <Icon className={styles.stateIcon} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  );
}

function CoverageRow({
  label,
  completeness,
  detail,
}: {
  label: string;
  completeness: Completeness;
  detail: string;
}) {
  const { t } = useI18n();
  const Icon = COMPLETENESS_ICON[completeness];
  return (
    <>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={classNames(styles.factState, COMPLETENESS_CLASS[completeness])}>
        <Icon className={styles.factIcon} aria-hidden="true" />
        {t(`access.state.${completeness}`)}
      </dd>
      <dd className={styles.factDetail}>{detail}</dd>
    </>
  );
}

function AccessReport({ snapshot }: { snapshot: SchemaSnapshot }) {
  const translator = useI18n();
  const { t } = translator;
  const { access } = snapshot;

  if (access === undefined) {
    return <StateLine icon={ShieldQuestionMark}>{t("access.report.notRecorded")}</StateLine>;
  }

  const causes = accessCauses(access);
  const hasCodePermissionGap =
    (snapshot.programmability?.capture.objects.status === "read" &&
      access.coverage.programmability !== undefined &&
      access.coverage.programmability !== "complete") ||
    (snapshot.programmability?.capture.definitions.status === "read" &&
      access.coverage.moduleDefinitions !== undefined &&
      access.coverage.moduleDefinitions !== "complete");
  return (
    <div className={styles.report}>
      <Verdict access={access} />
      {access.level === "partial" || access.level === "nothingVisible" ? (
        <ul className={styles.causes}>
          {causes.map((cause) => (
            <li key={cause.kind}>{describeAccessCause(cause, translator)}</li>
          ))}
        </ul>
      ) : null}
      <Coverage snapshot={snapshot} access={access} />
      <InvisibleTableKeys snapshot={snapshot} />
      <CarriedFacts snapshot={snapshot} />
      <CarriedCodeFacts snapshot={snapshot} />
      {access.level === "partial" || access.level === "nothingVisible" || hasCodePermissionGap ? (
        <>
          <SchemaPermissions access={access} />
          <Fix snapshot={snapshot} access={access} />
        </>
      ) : null}
    </div>
  );
}

function Verdict({ access }: { access: AccessProfile }) {
  const { t } = useI18n();
  switch (access.level) {
    case "full":
      return <StateLine icon={ShieldCheck}>{t("access.report.full")}</StateLine>;
    case "empty":
      return <StateLine icon={ShieldCheck}>{t("access.report.empty")}</StateLine>;
    case "partial":
      return <StateLine icon={ShieldHalf}>{t("access.report.partial")}</StateLine>;
    case "nothingVisible":
      return <StateLine icon={ShieldOff}>{t("access.report.nothingVisible")}</StateLine>;
  }
}

function Coverage({ snapshot, access }: { snapshot: SchemaSnapshot; access: AccessProfile }) {
  const translator = useI18n();
  const { t, tCount } = translator;
  const { counts, coverage } = access;
  const objects = [
    tCount("statusBar.tables", snapshot.tables.length),
    tCount("statusBar.views", snapshot.views.length),
  ].join(" · ");
  const readable = counts.definitions - counts.definitionsNotVisible;
  const code = snapshot.programmability;
  const procedures = code?.routines.filter((routine) => routine.kind === "procedure").length ?? 0;
  const functions =
    code?.routines.filter((routine) => routine.kind !== "procedure" && routine.kind !== "unknown")
      .length ?? 0;
  const unknown = code?.routines.filter((routine) => routine.kind === "unknown").length ?? 0;
  const codeObjects = [
    tCount("code.count.procedure", procedures),
    tCount("code.count.function", functions),
    tCount("code.count.trigger", code?.triggers.length ?? 0),
    tCount("code.count.view", code?.views.length ?? 0),
    unknown > 0 ? tCount("code.count.unknown", unknown) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const total = counts.moduleDefinitions ?? 0;
  const encrypted = counts.moduleDefinitionsEncrypted ?? 0;
  const codeTextCounts =
    code?.capture.definitions.status === "read"
      ? t("access.code.textCounts", {
          readable: Math.max(0, total - (counts.moduleDefinitionsNotVisible ?? 0) - encrypted),
          total,
          encrypted,
        })
      : null;
  const objectsCause = codeCaptureCause(snapshot, "objects", translator);
  const textsCause = codeCaptureCause(snapshot, "definitions", translator);

  return (
    <Section title={t("access.report.section.coverage")}>
      <dl className={styles.facts}>
        <CoverageRow
          label={t("access.report.objects")}
          completeness={coverage.objects}
          detail={
            coverage.objects === "complete"
              ? objects
              : t("access.report.objects.partial", { objects })
          }
        />
        <CoverageRow
          label={t("access.report.definitions")}
          completeness={coverage.definitions}
          detail={
            counts.definitions === 0
              ? t("access.report.definitions.none")
              : t("access.report.definitions.count", {
                  readable,
                  total: counts.definitions,
                })
          }
        />
        <CoverageRow
          label={t("access.report.programmability")}
          completeness={coverage.programmability ?? "notAvailable"}
          detail={[codeObjects, objectsCause].filter(Boolean).join(". ")}
        />
        <CoverageRow
          label={t("access.report.moduleDefinitions")}
          completeness={coverage.moduleDefinitions ?? "notAvailable"}
          detail={[codeTextCounts, textsCause].filter(Boolean).join(". ")}
        />
      </dl>
    </Section>
  );
}

function CarriedCodeFacts({ snapshot }: { snapshot: SchemaSnapshot }) {
  const { t, tCount, locale } = useI18n();
  const carried = snapshot.programmability?.carriedOver ?? [];
  if (carried.length === 0) return null;
  return (
    <Section title={tCount("access.code.carried", carried.length)}>
      <p className={styles.note}>{t("access.report.carried.hint")}</p>
      {groupCodeFacts(carried, snapshot).map((group) => (
        <div key={group.kind}>
          <h4 className={styles.factGroupTitle}>
            {tCount(`code.count.${group.kind}`, group.count)}
          </h4>
          <ul className={styles.list}>
            {group.entries.map((entry) => (
              <li key={JSON.stringify([entry.object, entry.part])} className={styles.item}>
                <span className={styles.itemName}>
                  {codeObjectName(entry.object) || t("code.kind.unknown")}
                </span>
                <span className={styles.itemMeta}>
                  {t("access.report.carried.entry", {
                    fact: t(`code.part.${entry.part}`),
                    date: formatDate(entry.readAt, locale),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Section>
  );
}

function InvisibleTableKeys({ snapshot }: { snapshot: SchemaSnapshot }) {
  const { tCount } = useI18n();
  const keys = snapshot.foreignKeysToInvisibleTables ?? [];
  if (keys.length === 0) {
    return null;
  }
  return (
    <Section title={tCount("access.report.invisibleKeys", keys.length)}>
      <ul className={styles.list}>
        {keys.map((key) => (
          <li key={foreignKeyId(key)} className={styles.item}>
            <span className={styles.itemName}>{key.name}</span>
            <span className={styles.itemMeta}>
              {qualifiedNameLabel(key.referencingTable)} ({key.columns.join(", ")})
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function CarriedFacts({ snapshot }: { snapshot: SchemaSnapshot }) {
  const { t, tCount, locale } = useI18n();
  const carried = snapshot.carriedOver ?? [];
  if (carried.length === 0) {
    return null;
  }
  return (
    <Section title={tCount("access.report.carried", carried.length)}>
      <p className={styles.note}>{t("access.report.carried.hint")}</p>
      <ul className={styles.list}>
        {carried.map((entry) => (
          <li key={JSON.stringify([entry.object, entry.fact])} className={styles.item}>
            <span className={styles.itemName}>{qualifiedNameLabel(entry.object)}</span>
            <span className={styles.itemMeta}>
              {t("access.report.carried.entry", {
                fact: describeSnapshotFact(entry.fact, t),
                date: formatDate(entry.readAt, locale),
              })}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function SchemaPermissions({ access }: { access: AccessProfile }) {
  const { t } = useI18n();
  const { probe } = access;
  const flag = (value: boolean) => (value ? t("review.value.yes") : t("review.value.no"));
  const denials =
    probe.explicitDenials === null
      ? t("access.report.schemas.unknown")
      : probe.explicitDenials === 0
        ? t("review.value.no")
        : String(probe.explicitDenials);

  return (
    <Section title={t("access.report.section.schemas")}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t("access.report.schemas.name")}</th>
            <th scope="col">VIEW DEFINITION</th>
            <th scope="col">SELECT</th>
            <th scope="col">DENY</th>
            <th scope="col">DENY EXECUTE</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">{t("access.report.schemas.database")}</th>
            <td>{flag(probe.canReadDefinitions)}</td>
            <td>{flag(probe.canReadData)}</td>
            <td>{denials}</td>
            <td>
              {probe.executeDenials === undefined
                ? t("access.report.schemas.unknown")
                : probe.executeDenials === 0
                  ? t("review.value.no")
                  : probe.executeDenials}
            </td>
          </tr>
          {probe.schemas.map((schema) => (
            <tr key={schema.name}>
              <th scope="row" className={styles.mono}>
                {schema.name}
              </th>
              <td>{flag(schema.canReadDefinitions)}</td>
              <td>{flag(schema.canReadData)}</td>
              <td>{flag(schema.isDenied)}</td>
              <td>
                {schema.isExecuteDenied === undefined
                  ? t("access.report.schemas.unknown")
                  : flag(schema.isExecuteDenied)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function Fix({ snapshot, access }: { snapshot: SchemaSnapshot; access: AccessProfile }) {
  const { t, locale } = useI18n();
  if (!grantHelps(access) && !codeGrantHelps(snapshot)) {
    return (
      <Section title={t("access.report.section.fix")}>
        <p className={styles.note}>{t("access.report.dbaOnly")}</p>
      </Section>
    );
  }
  const script = grantScript({
    database: snapshot.databaseName,
    principal: access.probe.databaseUser,
    locale,
  });
  return (
    <Section title={t("access.report.section.fix")}>
      <p className={styles.note}>{t("access.report.fix")}</p>
      <pre className={styles.script}>
        <code>{script}</code>
      </pre>
      <div>
        <CopyScriptButton variant="primary" script={script} />
      </div>
    </Section>
  );
}
