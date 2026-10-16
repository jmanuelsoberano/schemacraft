import { FileCode, FileText, Globe, Image, Moon, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRef } from "react";

import { describeOperationError } from "@/shared/errors/describeOperationError";
import { useProjectStore } from "@/features/project/projectStore";
import type { DetailLevel, ExportFormat } from "@/shared/contracts";
import { useI18n } from "@/shared/i18n/useI18n";
import { useAppInfo } from "@/shared/ipc/useAppInfo";
import { Alert } from "@/shared/ui/Alert";
import { Button } from "@/shared/ui/Button";
import { Checkbox } from "@/shared/ui/Checkbox";
import { Dialog } from "@/shared/ui/Dialog";
import { ProgressBar } from "@/shared/ui/ProgressBar";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import type { SegmentedOption } from "@/shared/ui/SegmentedControl";

import styles from "./ExportDialog.module.css";
import {
  EMBEDDED_FONTS_BYTES,
  MAX_RASTER_SIDE,
  estimateFileBytes,
  fitsRasterLimit,
  formatBytes,
  pageSizeMillimetres,
  rasterSize,
} from "./exportSizing";
import { EXPORT_FORMATS, PNG_SCALES } from "./exportSpecification";
import type { PngScale } from "./exportSpecification";
import { useExportStore } from "./exportStore";
import type { ExportTheme } from "./svg/palette";

const FORMAT_ICONS: Record<ExportFormat, LucideIcon> = {
  svg: FileCode,
  html: Globe,
  pdf: FileText,
  png: Image,
};
const DETAIL_LEVELS: readonly DetailLevel[] = ["compact", "keys", "full"];
const SCALE_VALUES = PNG_SCALES.map(String);

/** Format, detail level, theme and scale of an export, with its size, then progress and result. */
export function ExportDialog() {
  const { t, tCount, locale } = useI18n();
  const isOpen = useExportStore((state) => state.isOpen);
  const choices = useExportStore((state) => state.choices);
  const extent = useExportStore((state) => state.extent);
  const phase = useExportStore((state) => state.phase);
  const progress = useExportStore((state) => state.progress);
  const outcome = useExportStore((state) => state.outcome);
  const failure = useExportStore((state) => state.failure);
  const close = useExportStore((state) => state.close);
  const updateChoices = useExportStore((state) => state.updateChoices);
  const runExport = useExportStore((state) => state.runExport);
  const cancel = useExportStore((state) => state.cancel);
  const reveal = useExportStore((state) => state.reveal);
  const exportAnother = useExportStore((state) => state.exportAnother);
  const appInfo = useAppInfo();
  const canvasLevel = useProjectStore((state) => state.project?.content.canvas.detailLevel ?? null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const isExporting = phase === "exporting";
  const isEmpty = extent === null || extent.entityCount === 0;
  const isTooLarge =
    choices.format === "png" && extent !== null && !fitsRasterLimit(extent, choices.scale);
  const canExport = !isEmpty && !isTooLarge && !isExporting;
  const generator =
    appInfo.status === "ready" ? `SchemaCraft ${appInfo.info.version}` : "SchemaCraft";

  const formatOptions: SegmentedOption<ExportFormat>[] = EXPORT_FORMATS.map((format) => ({
    value: format,
    label: t(`export.format.${format}`),
    hint: t(`export.format.${format}.hint`),
    icon: FORMAT_ICONS[format],
  }));
  const levelOptions: SegmentedOption<DetailLevel>[] = DETAIL_LEVELS.map((level) => ({
    value: level,
    label: t(`export.detailLevel.${level}`),
  }));
  const themeOptions: SegmentedOption<ExportTheme>[] = [
    { value: "light", label: t("theme.light"), icon: Sun },
    { value: "dark", label: t("theme.dark"), icon: Moon },
  ];
  const scaleOptions: SegmentedOption<string>[] = PNG_SCALES.map((scale) => ({
    value: String(scale),
    label: t("export.scale.value", { scale }),
  }));

  const start = () => {
    void runExport({
      dialogTitle: t("export.dialog.title"),
      fileTypeName: t(`export.file.${choices.format}`),
      generator,
    });
  };

  let summary: string | null = null;
  if (extent !== null && !isEmpty) {
    const size =
      choices.format === "pdf"
        ? t("export.summary.page", sizeParameters(pageSizeMillimetres(extent)))
        : t(
            "export.summary.pixels",
            sizeParameters(choices.format === "png" ? rasterSize(extent, choices.scale) : extent),
          );
    const estimate = formatBytes(
      estimateFileBytes(choices.format, extent, choices.scale, choices.embedFonts),
      locale,
    );
    summary = `${size} · ${t("export.summary.estimate", { size: estimate })}`;
  }

  const footer = outcome ? (
    <>
      <Button
        onClick={() => {
          void reveal();
        }}
      >
        {t("export.action.reveal")}
      </Button>
      <Button ref={primaryRef} variant="primary" onClick={close}>
        {t("export.action.close")}
      </Button>
    </>
  ) : isExporting ? (
    <Button
      onClick={() => {
        void cancel();
      }}
      disabled={progress?.isCancelling === true}
    >
      {progress?.isCancelling === true
        ? t("export.progress.cancelling")
        : t("export.action.cancel")}
    </Button>
  ) : (
    <>
      <Button onClick={close}>{t("export.action.cancel")}</Button>
      <Button ref={primaryRef} variant="primary" onClick={start} disabled={!canExport}>
        {t("export.action.export")}
      </Button>
    </>
  );

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
      title={t("export.dialog.title")}
      closeLabel={t("export.action.close")}
      isDismissable={!isExporting}
      initialFocusRef={primaryRef}
      width={560}
      footer={footer}
    >
      {outcome ? (
        <div className={styles.outcome}>
          <Alert
            variant="success"
            title={t("export.success.title")}
            action={<Button onClick={exportAnother}>{t("export.action.again")}</Button>}
          >
            <span className={styles.path}>
              {t("export.success.detail", {
                path: outcome.path,
                size: formatBytes(outcome.bytes, locale),
              })}
            </span>
          </Alert>
          {failure ? <FailureAlert failure={failure} /> : null}
        </div>
      ) : isExporting ? (
        <div className={styles.progress}>
          <ProgressBar label={t(`export.progress.${progress?.stage ?? "preparing"}`)} />
        </div>
      ) : (
        <div className={styles.form}>
          <p className={styles.description}>{t("export.dialog.description")}</p>
          {failure ? <FailureAlert failure={failure} /> : null}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>{t("export.format")}</span>
            <SegmentedControl
              ariaLabel={t("export.format")}
              value={choices.format}
              options={formatOptions}
              onValueChange={(format) => {
                updateChoices({ format });
              }}
            />
          </div>
          <div className={styles.row}>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t("export.detailLevel")}</span>
              <SegmentedControl
                ariaLabel={t("export.detailLevel")}
                value={choices.detailLevel}
                options={levelOptions}
                onValueChange={(detailLevel) => {
                  updateChoices({ detailLevel });
                }}
              />
              {canvasLevel !== null && choices.detailLevel !== canvasLevel ? (
                <p className={styles.hint}>{t("export.detailLevel.spread")}</p>
              ) : null}
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t("export.theme")}</span>
              <SegmentedControl
                ariaLabel={t("export.theme")}
                value={choices.theme}
                options={themeOptions}
                onValueChange={(theme) => {
                  updateChoices({ theme });
                }}
              />
            </div>
          </div>
          {choices.format === "png" ? (
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t("export.scale")}</span>
              <SegmentedControl
                ariaLabel={t("export.scale")}
                value={String(choices.scale)}
                options={scaleOptions}
                onValueChange={(value) => {
                  if (SCALE_VALUES.includes(value)) {
                    updateChoices({ scale: Number(value) as PngScale });
                  }
                }}
              />
            </div>
          ) : null}
          {choices.format === "svg" || choices.format === "html" ? (
            <Checkbox
              label={t("export.embedFonts")}
              description={t("export.embedFonts.hint", {
                size: formatBytes(EMBEDDED_FONTS_BYTES, locale),
              })}
              checked={choices.embedFonts}
              onCheckedChange={(embedFonts) => {
                updateChoices({ embedFonts });
              }}
            />
          ) : null}
          {isEmpty ? (
            <Alert variant="warning" title={t("export.warning.empty")} />
          ) : isTooLarge ? (
            <Alert
              variant="warning"
              title={t("export.warning.tooLarge", {
                scale: choices.scale,
                ...rasterSize(extent, choices.scale),
                limit: MAX_RASTER_SIDE.toLocaleString(locale),
              })}
            />
          ) : null}
          {summary !== null && extent !== null ? (
            <div className={styles.summary} aria-live="polite">
              <span className={styles.summaryStrong}>{summary}</span>
              <span>
                {tCount("export.summary.entities", extent.entityCount)} ·{" "}
                {tCount("export.summary.relations", extent.relationCount)}
              </span>
            </div>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

function sizeParameters(size: { width: number; height: number }) {
  return { width: size.width, height: size.height };
}

function FailureAlert({
  failure,
}: {
  failure: NonNullable<ReturnType<typeof useExportStore.getState>["failure"]>;
}) {
  const translator = useI18n();
  const presentation = describeOperationError(failure, translator);
  return (
    <Alert variant="danger" title={presentation.title} detail={presentation.detail}>
      {presentation.hint}
    </Alert>
  );
}
