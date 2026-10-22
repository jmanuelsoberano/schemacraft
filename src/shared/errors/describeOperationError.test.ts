import { describe, expect, it } from "vitest";

import { messageCatalogs } from "@/shared/i18n/messages/catalogs";
import { createCatalogTranslator } from "@/shared/i18n/translator";
import { OperationError } from "@/shared/ipc/operationError";

import { describeOperationError } from "./describeOperationError";

const english = createCatalogTranslator(messageCatalogs.en, "en");

const rejectedLogin = new OperationError(
  { type: "inspector", value: "authenticationFailed" },
  "the server rejected the login: Login failed for user 'reporting'.",
);

describe("describeOperationError", () => {
  it("offers local save guidance for a diagnostic failure without suggesting certificate trust", () => {
    const error = new OperationError(
      { type: "support", value: "writeFailed" },
      "report write failed",
    );
    const presentation = describeOperationError(error, english);
    expect(presentation.title).toBe("Could not save the diagnostic file");
    expect(presentation.hint).toContain("writable folder");
    expect(presentation.offersCertificateTrust).toBe(false);
  });
  it("advises on the login name and password when a SQL login is rejected", () => {
    const presentation = describeOperationError(rejectedLogin, english, {
      usesIntegratedAuthentication: false,
    });
    expect(presentation.title).toBe("The login was rejected");
    expect(presentation.hint).toContain("login name and password");
    expect(presentation.detail).toBe(rejectedLogin.message);
    expect(presentation.offersCertificateTrust).toBe(false);
  });

  it("advises on the Windows account when integrated authentication is rejected", () => {
    const presentation = describeOperationError(rejectedLogin, english, {
      usesIntegratedAuthentication: true,
    });
    expect(presentation.title).toBe("The login was rejected");
    expect(presentation.hint).toContain("Windows account");
    expect(presentation.hint).toContain("SQL Server Authentication");
  });

  it("offers to trust the certificate only for certificate failures", () => {
    const certificate = new OperationError(
      { type: "inspector", value: "untrustedCertificate" },
      "the server certificate could not be verified",
    );
    const presentation = describeOperationError(certificate, english, {
      usesIntegratedAuthentication: true,
    });
    expect(presentation.title).toBe("The server certificate is not trusted");
    expect(presentation.offersCertificateTrust).toBe(true);
  });

  it("describes failures that do not come from the inspector", () => {
    const unknownJob = new OperationError({ type: "unknownJob" }, "no such job");
    const presentation = describeOperationError(unknownJob, english, {
      usesIntegratedAuthentication: false,
    });
    expect(presentation.title).toBe("Nothing to cancel");
    expect(presentation.hint).toBe("The operation had already finished.");
  });
});
