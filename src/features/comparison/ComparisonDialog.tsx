import { ArrowLeftRight, Download, FolderOpen, GitCompareArrows } from "lucide-react";
import { useMemo } from "react";

import { projectDisplayName } from "@/features/project/projectPaths";
import type {
  ComparisonItem,
  ComparisonObjectKind,
  ComparisonObservation,
  ComparisonResultKind,
  ComparisonValue,
} from "@/shared/contracts";
import { describeOperationError } from "@/shared/errors/describeOperationError";
import { formatDateTime } from "@/shared/i18n/formatDate";
import { useI18n } from "@/shared/i18n/useI18n";
import { useSettingsStore } from "@/shared/settings/settingsStore";
import { resolveTheme } from "@/shared/settings/theme";
import { Alert } from "@/shared/ui/Alert";
import { Button } from "@/shared/ui/Button";
import { Dialog } from "@/shared/ui/Dialog";
import { Select } from "@/shared/ui/Select";

import {
  comparisonContextSvg,
  comparisonKey,
  comparisonObjectLabel,
  comparisonSource,
  filteredComparisonItems,
} from "./comparisonModel";
import { comparisonPropertyLabel, comparisonValueLabel } from "./comparisonPresentation";
import { buildComparisonReport } from "./comparisonReport";
import { ComparisonCaptureDetails } from "./ComparisonCaptureDetails";
import { ComparisonSourcePane } from "./ComparisonSourcePane";
import { useComparisonStore } from "./comparisonStore";
import styles from "./ComparisonDialog.module.css";

const KINDS: readonly ComparisonObjectKind[] = [
  "table",
  "view",
  "routine",
  "trigger",
  "foreignKey",
];
const OUTCOMES: readonly ComparisonResultKind[] = [
  "onlyReference",
  "onlyCompared",
  "different",
  "notComparable",
];

/** Independent offline review; every canvas/source result is isolated from the open document. */
export function ComparisonDialog() {
  const translator = useI18n();
  const { t, locale } = translator;
  const state = useComparisonStore();
  const themePreference = useSettingsStore((settings) => settings.themePreference);
  const theme = resolveTheme(
    themePreference,
    typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const items = filteredComparisonItems(state.comparison?.items ?? [], state.filters);
  const selected = items.find((item) => comparisonKey(item.object) === state.selectedKey);
  const input = state[state.contextSide];
  const labels = useMemo(
    () => ({ view: t("entity.view"), triggers: (badge: { count: number }) => String(badge.count) }),
    [t],
  );
  const context =
    input && selected
      ? comparisonContextSvg(
          input,
          [selected.object],
          labels,
          theme,
          `${t("comparison.context")} · ${t(`comparison.${state.contextSide}`)}`,
          true,
        )
      : null;
  const referenceSource =
    selected && state.reference
      ? comparisonSource(state.reference.document.project.snapshot, selected.object)
      : null;
  const comparedSource =
    selected && state.compared
      ? comparisonSource(state.compared.document.project.snapshot, selected.object)
      : null;
  const busy = state.phase !== "idle";
  const failure = state.failure ? describeOperationError(state.failure, translator) : null;
  const schemas = [
    ...new Set(state.comparison?.items.map((item) => item.object.name.schema) ?? []),
  ].sort();
  const showEvidence = (evidence: ComparisonObservation) =>
    `${t(`comparison.status.${evidence.status}`)}${evidence.readAt === null ? "" : ` · ${formatDateTime(evidence.readAt, locale)}`}`;
  const preview = () => {
    if (!state.comparison || !state.reference || !state.compared) return;
    const reportLabels = {
      title: t("comparison.title"),
      reference: t("comparison.reference"),
      compared: t("comparison.compared"),
      property: t("comparison.property"),
      scope: t("comparison.reportScope", { count: items.length }),
      limitations: t("comparison.limitations"),
      sourceChanged: t("comparison.literal"),
      filter: t("comparison.filter"),
      outcome: (value: ComparisonItem["result"]) => t(`comparison.outcome.${value}`),
      status: (value: ComparisonObservation["status"]) => t(`comparison.status.${value}`),
      propertyName: (path: readonly string[]) => comparisonPropertyLabel(path, t),
      propertyValue: (value: ComparisonValue, path: readonly string[]) =>
        comparisonValueLabel(value, t, path),
    };
    const objects = items.map((item) => item.object);
    const diagrams = (["reference", "compared"] as const).flatMap((side) => {
      const input = state[side];
      if (input === null) return [];
      const svg = comparisonContextSvg(
        input,
        objects,
        labels,
        "light",
        `${t("comparison.context")} · ${reportLabels[side]}`,
      );
      return svg === null ? [] : [{ side, svg }];
    });
    state.previewReport(
      buildComparisonReport(state.comparison, items, diagrams, reportLabels, locale),
    );
  };
  return (
    <Dialog
      open={state.isOpen}
      onOpenChange={(open) => {
        if (!open) state.close();
      }}
      title={t("comparison.title")}
      description={t("comparison.description")}
      closeLabel={t("review.action.close")}
      width={1180}
      isDismissable={state.phase !== "saving"}
      footer={
        <Button onClick={state.close} disabled={state.phase === "saving"}>
          {t("review.action.close")}
        </Button>
      }
    >
      <div className={styles.content}>
        <div className={styles.inputs}>
          {(["reference", "compared"] as const).map((side) => (
            <section key={side} className={styles.input} aria-label={t(`comparison.${side}`)}>
              <strong>{t(`comparison.${side}`)}</strong>
              <span className={styles.name}>
                {state[side] ? projectDisplayName(state[side].path) : t("comparison.noFile")}
              </span>
              {state[side] ? (
                <small>
                  {formatDateTime(state[side].document.project.snapshot.extractedAt, locale)} ·{" "}
                  {t(
                    `connection.provider.${state[side].document.project.snapshot.provider ?? "sqlServer"}`,
                  )}
                </small>
              ) : null}
              {state[side] ? (
                <ComparisonCaptureDetails
                  snapshot={state[side].document.project.snapshot}
                  capture={state.comparison?.[side]}
                  isReadOnly={state[side].document.isReadOnly}
                />
              ) : null}
              <Button
                leadingIcon={FolderOpen}
                disabled={busy}
                onClick={() => {
                  void state.pick(side, {
                    title: t(`comparison.${side}`),
                    fileTypeName: t("project.dialog.fileType"),
                  });
                }}
              >
                {t("comparison.choose")}
              </Button>
            </section>
          ))}
        </div>
        <div className={styles.actions}>
          <Button
            variant="primary"
            leadingIcon={GitCompareArrows}
            disabled={busy || !state.reference || !state.compared}
            onClick={() => {
              void state.compare();
            }}
          >
            {t("comparison.run")}
          </Button>
          <Button
            leadingIcon={ArrowLeftRight}
            disabled={busy || !state.reference || !state.compared}
            onClick={() => {
              void state.swap();
            }}
          >
            {t("comparison.swap")}
          </Button>
          {busy ? <span role="status">{t("comparison.busy")}</span> : null}
        </div>
        {failure ? (
          <Alert variant="danger" title={failure.title} detail={failure.detail}>
            {failure.hint}
          </Alert>
        ) : null}
        {state.comparison ? (
          <>
            <p className={styles.hint}>
              {t("comparison.summary", {
                count: state.comparison.summary.objectsCompared,
                different: state.comparison.summary.different,
                uncertain: state.comparison.summary.notComparable,
              })}
            </p>
            <p className={styles.hint}>{t("comparison.limitations")}</p>
            <div className={styles.filters}>
              <label>
                {t("comparison.filter")}
                <input
                  className={styles.search}
                  type="search"
                  value={state.filters.query}
                  onChange={(event) => {
                    state.filter({ query: event.target.value });
                  }}
                />
              </label>
              <Select
                label={t("comparison.schema")}
                value={state.filters.schema === "" ? "all" : JSON.stringify(state.filters.schema)}
                placeholder={t("comparison.all")}
                options={[
                  { value: "all", label: t("comparison.all") },
                  ...schemas.map((schema) => ({ value: JSON.stringify(schema), label: schema })),
                ]}
                onValueChange={(schema) => {
                  state.filter({
                    schema: schemas.find((candidate) => JSON.stringify(candidate) === schema) ?? "",
                  });
                }}
              />
              <Select
                label={t("comparison.kind")}
                value={state.filters.kind || "all"}
                placeholder={t("comparison.all")}
                options={[
                  { value: "all", label: t("comparison.all") },
                  ...KINDS.map((kind) => ({ value: kind, label: t(`comparison.kind.${kind}`) })),
                ]}
                onValueChange={(kind) => {
                  state.filter({ kind: kind === "all" ? "" : kind });
                }}
              />
              <Select
                label={t("comparison.result")}
                value={state.filters.result || "all"}
                placeholder={t("comparison.all")}
                options={[
                  { value: "all", label: t("comparison.all") },
                  ...OUTCOMES.map((result) => ({
                    value: result,
                    label: t(`comparison.outcome.${result}`),
                  })),
                ]}
                onValueChange={(result) => {
                  state.filter({ result: result === "all" ? "" : result });
                }}
              />
            </div>
            <div className={styles.review}>
              <div className={styles.results} role="region" aria-label={t("comparison.result")}>
                {items.length === 0 ? (
                  <p>
                    {t(
                      state.comparison.items.length === 0
                        ? "comparison.empty"
                        : "comparison.noMatches",
                    )}
                  </p>
                ) : (
                  items.map((item) => (
                    <button
                      key={comparisonKey(item.object)}
                      type="button"
                      className={styles.item}
                      aria-pressed={comparisonKey(item.object) === state.selectedKey}
                      onClick={() => {
                        state.select(comparisonKey(item.object));
                      }}
                    >
                      <strong>{comparisonObjectLabel(item.object)}</strong>
                      <small>
                        {t(`comparison.kind.${item.object.kind}`)} ·{" "}
                        {t(`comparison.outcome.${item.result}`)}
                      </small>
                    </button>
                  ))
                )}
              </div>
              <section className={styles.details} aria-label={t("comparison.property")}>
                {selected ? (
                  <>
                    <h3>{comparisonObjectLabel(selected.object)}</h3>
                    <p>
                      {t("comparison.reference")}: {showEvidence(selected.reference)}
                      <br />
                      {t("comparison.compared")}: {showEvidence(selected.compared)}
                    </p>
                    {selected.definitionText?.differs ? (
                      <p>
                        {t("comparison.literal")}
                        {selected.definitionText.equalUnderLegacyNormalization
                          ? ` ${t("comparison.normalized")}`
                          : ""}
                      </p>
                    ) : null}
                    <table className={styles.properties}>
                      <thead>
                        <tr>
                          <th>{t("comparison.property")}</th>
                          <th>{t("comparison.reference")}</th>
                          <th>{t("comparison.compared")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.properties.map((property) => (
                          <tr key={JSON.stringify(property.path)}>
                            <th>{comparisonPropertyLabel(property.path, t)}</th>
                            {[property.reference, property.compared].map((value, index) => (
                              <td key={index}>
                                <pre>{comparisonValueLabel(value, t, property.path)}</pre>
                                <small>{showEvidence(value.observation)}</small>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <h4>{t("comparison.context")}</h4>
                    <div className={styles.actions}>
                      {(["reference", "compared"] as const).map((side) => (
                        <Button
                          key={side}
                          aria-pressed={state.contextSide === side}
                          onClick={() => {
                            state.setContextSide(side);
                          }}
                        >
                          {t(`comparison.${side}`)}
                        </Button>
                      ))}
                    </div>
                    {context ? (
                      <iframe
                        className={styles.context}
                        sandbox=""
                        title={`${t("comparison.context")}: ${comparisonObjectLabel(selected.object)}`}
                        srcDoc={context}
                      />
                    ) : (
                      <p>{t("comparison.noContext")}</p>
                    )}
                    {selected.object.kind === "view" ||
                    selected.object.kind === "routine" ||
                    selected.object.kind === "trigger" ? (
                      <>
                        <h4>{t("comparison.source")}</h4>
                        <div className={styles.originals}>
                          <ComparisonSourcePane side="reference" text={referenceSource} t={t} />
                          <ComparisonSourcePane side="compared" text={comparedSource} t={t} />
                        </div>
                        {referenceSource === null || comparedSource === null ? (
                          <p>{t("comparison.sourceUnavailable")}</p>
                        ) : (
                          <>
                            <div className={styles.actions}>
                              <Button
                                disabled={busy}
                                onClick={() => {
                                  void state.loadSource();
                                }}
                              >
                                {t("comparison.source")}
                              </Button>
                              {state.phase === "source" ? (
                                <Button onClick={state.cancelSource}>
                                  {t("export.action.cancel")}
                                </Button>
                              ) : null}
                            </div>
                          </>
                        )}
                        {state.source ? (
                          <>
                            {state.source.status !== "complete" ? (
                              <p role="status">
                                {t(
                                  state.source.status === "limited"
                                    ? "comparison.sourceLimited"
                                    : "comparison.sourceCancelled",
                                )}
                              </p>
                            ) : null}
                            <div
                              className={styles.lines}
                              role="region"
                              aria-label={t("comparison.source")}
                              tabIndex={0}
                            >
                              {state.source.lines.map((line, index) => (
                                <div key={index} className={styles.line} data-kind={line.kind}>
                                  <span>
                                    {line.kind === "added"
                                      ? "+"
                                      : line.kind === "removed"
                                        ? "−"
                                        : " "}
                                  </span>
                                  <span>{line.referenceLine ?? ""}</span>
                                  <span>{line.comparedLine ?? ""}</span>
                                  <code>{line.text}</code>
                                  <small>{line.ending === "none" ? "∅" : line.ending}</small>
                                </div>
                              ))}
                            </div>
                            <div className={styles.actions}>
                              <Button
                                disabled={busy}
                                onClick={() => {
                                  void state.loadSource(0);
                                }}
                              >
                                {t("comparison.first")}
                              </Button>
                              {state.source.nextOffset === null ? null : (
                                <Button
                                  disabled={busy}
                                  onClick={() => {
                                    void state.loadSource(state.source?.nextOffset ?? 0);
                                  }}
                                >
                                  {t("comparison.more")}
                                </Button>
                              )}
                            </div>
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </>
                ) : null}
              </section>
            </div>
            <Button leadingIcon={Download} disabled={busy} onClick={preview}>
              {t("comparison.report")}
            </Button>
            {state.reportPreview ? (
              <section className={styles.preview}>
                <p>{t("comparison.reportScope", { count: items.length })}</p>
                <iframe title={t("comparison.report")} sandbox="" srcDoc={state.reportPreview} />
                <Button
                  disabled={busy}
                  onClick={() => {
                    void state.saveReport(t("comparison.saveReport"));
                  }}
                >
                  {t("comparison.saveReport")}
                </Button>
              </section>
            ) : null}
            {state.saved ? <p role="status">{t("comparison.saved")}</p> : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
