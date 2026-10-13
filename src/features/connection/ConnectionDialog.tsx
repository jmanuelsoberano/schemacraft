import { DatabaseZap, PlugZap, X } from "lucide-react";
import { useRef } from "react";

import { useI18n } from "@/shared/i18n/useI18n";
import { Button } from "@/shared/ui/Button";
import { Dialog } from "@/shared/ui/Dialog";

import { ConnectionForm } from "./ConnectionForm";
import { InspectionProgressPanel } from "./InspectionProgressPanel";
import { useConnectionStore } from "./connectionStore";

/** Connect to a SQL Server instance and read its schema, with progress and cancellation. */
export function ConnectionDialog() {
  const { t } = useI18n();
  const isDialogOpen = useConnectionStore((state) => state.isDialogOpen);
  const phase = useConnectionStore((state) => state.phase);
  const inspection = useConnectionStore((state) => state.inspection);
  const tested = useConnectionStore((state) => state.tested);
  const database = useConnectionStore((state) => state.draft.database);
  const closeDialog = useConnectionStore((state) => state.closeDialog);
  const testConnection = useConnectionStore((state) => state.testConnection);
  const inspect = useConnectionStore((state) => state.inspect);
  const cancel = useConnectionStore((state) => state.cancel);
  const serverFieldRef = useRef<HTMLInputElement>(null);

  const isInspecting = phase === "inspecting" && inspection !== null;
  const isBusy = phase !== "idle";

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
        disabled={isBusy || tested === null || database === null}
        onClick={() => {
          void inspect();
        }}
      >
        {t("connection.action.connect")}
      </Button>
    </>
  );

  return (
    <Dialog
      open={isDialogOpen}
      onOpenChange={(open) => {
        if (!open) {
          closeDialog();
        }
      }}
      title={t("connection.dialog.title")}
      description={t("connection.dialog.description")}
      closeLabel={t("connection.action.close")}
      isDismissable={!isInspecting}
      initialFocusRef={serverFieldRef}
      width={620}
      footer={footer}
    >
      {isInspecting ? (
        <InspectionProgressPanel inspection={inspection} />
      ) : (
        <ConnectionForm serverFieldRef={serverFieldRef} />
      )}
    </Dialog>
  );
}
