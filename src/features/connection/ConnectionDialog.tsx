import { Check, DatabaseZap, PlugZap, X } from "lucide-react";
import { useRef } from "react";

import { useProjectStore } from "@/features/project/projectStore";
import { useI18n } from "@/shared/i18n/useI18n";
import { Alert } from "@/shared/ui/Alert";
import { Button } from "@/shared/ui/Button";
import { Dialog } from "@/shared/ui/Dialog";

import { ConnectionForm } from "./ConnectionForm";
import { InspectionProgressPanel } from "./InspectionProgressPanel";
import { ReviewChangesPanel } from "./ReviewChangesPanel";
import { canReadSchema, useConnectionStore } from "./connectionStore";
import { describeOperationError } from "@/shared/errors/describeOperationError";
import { hasObjectChanges, isUpToDate } from "./reviewChanges";

/**
 * Connect to a SQL Server instance and read its schema, with progress and cancellation. The
 * same dialog refreshes an open project: the fresh schema is reviewed before it is applied.
 */
export function ConnectionDialog() {
  const translator = useI18n();
  const { t } = translator;
  const isDialogOpen = useConnectionStore((state) => state.isDialogOpen);
  const mode = useConnectionStore((state) => state.mode);
  const phase = useConnectionStore((state) => state.phase);
  const inspection = useConnectionStore((state) => state.inspection);
  const review = useConnectionStore((state) => state.review);
  const failure = useConnectionStore((state) => state.failure);
  const canRead = useConnectionStore(canReadSchema);
  const authenticationMode = useConnectionStore((state) => state.draft.authenticationMode);
  const closeDialog = useConnectionStore((state) => state.closeDialog);
  const testConnection = useConnectionStore((state) => state.testConnection);
  const inspect = useConnectionStore((state) => state.inspect);
  const cancel = useConnectionStore((state) => state.cancel);
  const applyReview = useConnectionStore((state) => state.applyReview);
  const discardReview = useConnectionStore((state) => state.discardReview);
  const projectDatabase = useProjectStore(
    (state) => state.project?.content.snapshot.databaseName ?? "",
  );
  const serverFieldRef = useRef<HTMLInputElement>(null);
  const passwordFieldRef = useRef<HTMLInputElement>(null);

  const isInspecting = phase === "inspecting" && inspection !== null;
  const isReviewing = (phase === "reviewing" || phase === "applying") && review !== null;
  const isApplying = phase === "applying";
  const isBusy = phase !== "idle";
  // A review with no schema change can still teach the project something: items it could not
  // check, texts that became readable, facts recorded for the first time or another access
  // verdict. Only a review with none of these is up to date and offers nothing to apply; Rust
  // decides both verdicts with the diff.
  const reviewIsEmpty = review !== null && isUpToDate(review.diff);
  const reviewHasChanges = review !== null && hasObjectChanges(review.diff);

  const title = isReviewing
    ? t("review.title", { database: review.snapshot.databaseName })
    : mode === "refresh"
      ? t("connection.refresh.title")
      : t("connection.dialog.title");
  const description = isReviewing
    ? t("review.description")
    : mode === "refresh"
      ? t("connection.refresh.description", { database: projectDatabase })
      : t("connection.dialog.description");

  const footer = isInspecting ? (
    <Button
      leadingIcon={X}
      disabled={inspection.isCancelling}
      onClick={() => {
        void cancel();
      }}
    >
      {inspection.isCancelling
        ? t("connection.progress.cancelling")
        : t("connection.action.cancel")}
    </Button>
  ) : isReviewing ? (
    reviewIsEmpty ? (
      <Button onClick={discardReview}>{t("review.action.close")}</Button>
    ) : (
      <>
        <Button disabled={isApplying} onClick={discardReview}>
          {t("review.action.discard")}
        </Button>
        <Button
          variant="primary"
          leadingIcon={Check}
          disabled={isApplying}
          onClick={() => {
            void applyReview();
          }}
        >
          {isApplying
            ? t("review.status.applying")
            : reviewHasChanges
              ? t("review.action.apply")
              : t("review.action.update")}
        </Button>
      </>
    )
  ) : (
    <>
      <Button
        leadingIcon={PlugZap}
        disabled={isBusy}
        onClick={() => {
          void testConnection();
        }}
      >
        {t("connection.action.test")}
      </Button>
      <Button
        variant="primary"
        leadingIcon={DatabaseZap}
        disabled={isBusy || !canRead}
        onClick={() => {
          void inspect();
        }}
      >
        {t("connection.action.connect")}
      </Button>
    </>
  );

  const reviewFailure =
    isReviewing && failure !== null
      ? describeOperationError(failure.error, translator, {
          usesIntegratedAuthentication: authenticationMode === "integrated",
        })
      : null;

  return (
    <Dialog
      open={isDialogOpen}
      onOpenChange={(open) => {
        if (!open) {
          closeDialog();
        }
      }}
      title={title}
      description={description}
      closeLabel={t("connection.action.close")}
      isDismissable={!isInspecting && !isApplying}
      initialFocusRef={
        mode === "refresh" && authenticationMode === "sqlLogin" ? passwordFieldRef : serverFieldRef
      }
      width={620}
      footer={footer}
    >
      {isInspecting ? (
        <InspectionProgressPanel inspection={inspection} />
      ) : isReviewing ? (
        <>
          {reviewFailure ? (
            <Alert variant="danger" title={reviewFailure.title} detail={reviewFailure.detail}>
              {reviewFailure.hint}
            </Alert>
          ) : null}
          <ReviewChangesPanel diff={review.diff} capture={review.snapshot} />
        </>
      ) : (
        <ConnectionForm serverFieldRef={serverFieldRef} passwordFieldRef={passwordFieldRef} />
      )}
    </Dialog>
  );
}
