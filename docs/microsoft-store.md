# Microsoft Store preparation

The dated observations below are the historical preparation record for the original 1.2.0
submission, not a live availability report. Later feature work must not alter that package.

Status observed on **2026-10-22**: the first private submission was received by Microsoft and
entered preprocessing in the certification workflow. The Individual account and product identity
are verified, and the uploaded MSIX passed initial portal validation. Approval for `runFullTrust`,
installed-package acceptance and the certification outcome remain pending. Publication is held
until the maintainer selects **Publish now**; there is no public Store release.

Official requirements were reviewed on **2026-10-19** and the applicable policy references were
rechecked on **2026-10-22**. [Microsoft Store Policies 7.20](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies)
took effect on 2026-10-22. See the [policy history](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies-change-history).

## Scope and distribution contract

The original Store preparation used the single `feat/microsoft-store` branch and its pull
request; support/reporting was a separate change. Future releases keep the independent
distribution contract below and repeat the applicable runtime acceptance gates.

The Store package is an additional distribution output:

- The existing GitHub release continues to produce the portable executable, per-user NSIS
  installer and checksums, without Store credentials or a Store account.
- Store identity and packaging belong at the distribution boundary. The Rust core, React
  features and `.scraft` format remain shared across channels.
- Prepare the MSIX manually from the checksum-verified portable executable of a **published
  release**, preserving its bytes. Do not rebuild a Store-specific application or use the NSIS
  setup executable as the application payload.
- Record the source tag, commit, asset name and SHA-256 alongside the package, its manifest,
  SDK/MakeAppx version and package SHA-256. Package checks must verify the embedded executable
  against that source and reject missing identity or a version mismatch.
- Store preparation must not change existing release assets, require Store APIs in the
  application, or make the portable/installer builds depend on Store configuration.
- Packaging does not upload, submit, publish, create an account or manage certificates. These
  are separate maintainer actions. No local certificate creation, import or trust changes are
  part of this preparation.

Microsoft's agreement is nonexclusive; it allows distribution through other marketplaces.
See [App Developer Agreement 8.11, section 12(m)](https://go.microsoft.com/fwlink/?linkid=528905).

## Maintainer account and costs

The maintainer completed an **Individual account for a personal project published under their
own name**, including personal identity verification and developer-agreement acceptance. The
confirmed public publisher name is **Manuel Soberano**. Personal contact details, credentials
and identity documents do not belong in this repository.

1. Start at [storedeveloper.microsoft.com](https://storedeveloper.microsoft.com/), choose the
   individual account flow and sign in with a personal Microsoft account.
2. Enter the actual legal residence and profile details. Complete Microsoft's government-ID
   and selfie verification personally. Keep identity documents and credentials out of this
   repository and its issues.
3. Review and accept the agreement, finish verification and open **Apps & Games** in Partner
   Center. Do not substitute an account, address or country to bypass a verification problem.

Both Individual and Company registration are free through the new entry point. Company
registration's former USD99 fee was removed in May 2026. A Company account is for organizations
and professional/business activity, including relevant freelance activity; it requires business
and contact verification. Individual accounts cannot later be converted to Company accounts.
See [account registration](https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account)
and the [company registration announcement](https://blogs.windows.com/windowsdeveloper/2026/05/07/publish-to-microsoft-store-as-a-company-now-with-free-registration-and-faster-onboarding/).

Mexico appears in Microsoft's [publisher country list](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/supported-countries-regions)
and [Store consumer markets](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/market-selection).
These lists do not confirm an individual account's approval or which document its verification
flow will accept. For an exclusively free offer, Partner Center does not require a payout
profile or tax forms; see [payout and tax profiles](https://learn.microsoft.com/en-us/partner-center/account-settings/set-up-your-payout-account).

## Reserve the product and copy its identity

1. In Partner Center, open **Apps & Games → New product → MSIX or PWA app**.
2. Enter `SchemaCraft`, select **Check availability**, and reserve it only if available. The
   public Store search cannot establish name availability. An unused reservation expires after
   three months; see [name reservations](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/reserve-your-apps-name).
3. Open the product's **Product management → Product identity** page.
4. Copy the values below exactly, including case, punctuation and spaces. Record the Store ID
   and package family name for reference. Do not derive them from the Tauri application ID,
   GitHub user name, display name or a sample manifest.

| Partner Center value                    | MSIX destination                          | Current value                              |
| --------------------------------------- | ----------------------------------------- | ------------------------------------------ |
| Package/Identity/Name                   | `Identity Name`                           | `ManuelSoberano.SchemaCraft`               |
| Package/Identity/Publisher              | `Identity Publisher`                      | `CN=694356F4-87C7-4BE3-8344-FAE641137995`  |
| Package/Properties/PublisherDisplayName | `Properties/PublisherDisplayName`         | `Manuel Soberano`                          |
| Store ID                                | Submission record and eventual Store link | `9N5HMQ02KP3S`                             |
| Package Family Name                     | Installation/update verification record   | `ManuelSoberano.SchemaCraft_8p2rqfsespz7a` |

These values establish the package family and must remain consistent for updates. Microsoft's
[product identity guide](https://learn.microsoft.com/en-us/windows/apps/publish/view-app-identity-details)
describes their source. A sample identity is suitable only for package-structure tests and is
never evidence that the submission identity is ready.

The name is reserved and these values were copied from the product identity page. The eventual
[Store link](https://apps.microsoft.com/detail/9N5HMQ02KP3S) identifies the product; it does not
establish public availability.

## Run the preparation

The [packager](../distribution/microsoft-store/package.mjs) requires Windows, Node.js 24 or
newer and the Windows SDK's x64 MakeAppx. It selects the newest installed SDK tool, or accepts
an explicit `--makeappx` path. It does not install an SDK, run the application or import a
certificate. The output directory must not already exist, and its parent directory must exist.

### Manual workflow

The [Prepare Microsoft Store package workflow](../.github/workflows/microsoft-store.yml) has
only a `workflow_dispatch` trigger. GitHub exposes manual dispatch after the workflow exists on
the default branch; use the local CLI below while this pull request is unmerged.

Once available, open **Actions → Prepare Microsoft Store package → Run workflow** and supply:

| Input                    | Value                                                               |
| ------------------------ | ------------------------------------------------------------------- |
| `release_tag`            | Published stable release tag, such as `v1.2.0`                      |
| `identity_name`          | Exact `Package/Identity/Name` from Partner Center                   |
| `identity_publisher`     | Exact `Package/Identity/Publisher` from Partner Center              |
| `publisher_display_name` | Exact `Package/Properties/PublisherDisplayName` from Partner Center |

The workflow checks that the release is published and stable, its source commit belongs to
`main`, and its source version matches the tag. It downloads the portable and `SHA256SUMS.txt`,
requiring the file checksum, checksum entry and GitHub asset digest to agree. It needs only
repository read permissions and never accesses Partner Center.

Download the `microsoft-store-submission` artifact after a successful run. It contains the
unsigned `.msix`, `report.json` and `provenance.json`; retention is 30 days, so retain the package
and evidence needed for submission. The provenance records the source release tag/commit, the
packaging commit, asset name, release URL and input hash. The workflow has not yet been dispatched as part
of the local validation reported below.

### Local CLI before or after merge

Download the published portable and verify its SHA-256 against the release checksum file and
asset digest first. The local CLI checks PE architecture, file version and payload integrity;
it does **not** authenticate the input against GitHub or create the workflow provenance record.
Record the source release and packaging commit separately for a local submission candidate.

Create a UTF-8 identity JSON file without a byte-order mark, with exactly these keys. The empty template below is
intentionally invalid: fill each value from Partner Center before using `--identity`.

```json
{
  "name": "",
  "publisher": "",
  "publisherDisplayName": ""
}
```

From the repository root, substitute the two input paths and choose a new output directory.
Create its parent if needed; the output itself must remain new:

```powershell
New-Item -ItemType Directory -Path target -Force | Out-Null
node distribution/microsoft-store/package.mjs --executable "<verified-portable.exe>" --version 1.2.0 --identity "<completed-identity.json>" --output-dir target/store-submission
```

To exercise package creation before receiving a real identity, use explicit validation mode:

```powershell
node distribution/microsoft-store/package.mjs --executable "<verified-portable.exe>" --version 1.2.0 --validation --output-dir target/store-validation
```

Use exactly one of `--identity` or `--validation`. Validation mode produces a clearly named
validation package and sets `validation: true` in its report; it cannot substitute for a Store
submission. Both commands map release `1.2.0` to package version `1.2.0.0` and reject a different
executable file version. Replace the version when selecting another published release.

Local output includes `staging/`, `extracted/`, the unsigned MSIX and `report.json`. The payload
is restricted to `schemacraft.exe`, `AppxManifest.xml`, `LICENSE`, `SOURCE.txt` and three package
icons. The source notice links to the selected release's corresponding source. MakeAppx packs
with semantic validation enabled, unpacks the result, and the packager compares the inventory
and each payload hash; only recognized SDK metadata may be added. The report records identity,
validation mode, versions, executable hashes, package hash and per-file payload hashes. Review
its identity and `validation` field before treating an artifact as a submission candidate.

## Package and signing boundary

After identity is available, stage the published x64 application with the Store manifest,
required images and license material, then create the package with the Windows SDK's
MakeAppx tool. Validate the manifest, version, architecture and payload before considering an
upload. Retain the generated package and its provenance for review. Merely generating staging
files or a ZIP archive does not demonstrate a valid MSIX or a successful installation.

Before requesting public availability, complete the applicable desktop-package tests in the
[Windows App Certification Kit](https://learn.microsoft.com/en-us/windows/uwp/debug-test-perf/windows-app-certification-kit)
and retain its HTML/XML reports with the tested package hash, Windows and kit versions. Record
any unavailable tests and resolve failures before public availability. MakeAppx validation does not replace
these tests or Microsoft's certification. The kit has not been run for this preparation; its
deployment, active-session and privilege requirements must be met in the acceptance environment.
For the first private candidate below, tests that require a trusted installed package remain
explicitly pending while the maintainer obtains a Store-signed build. The private route does
not turn package validation into a passed installation or certification-kit result.

The current manifest targets x64 Windows desktop build 19041 or later and declares
`packagedClassicApp`, `mediumIL` and `runFullTrust`. It carries English and Spanish resources,
without adding an elevation request or bundled WebView2 runtime. These declarations are a
package contract, not evidence of runtime compatibility; see [ADR-045](architecture.md#adr-045-distribution-channels-wrap-the-same-application-and-remain-independent).

Microsoft signs MSIX/AppX packages after certification; a CA-trusted certificate is not required
for their Store submission. The Store does **not** re-sign MSI/EXE installers or supply a
reusable certificate for GitHub releases. Signing the existing portable and installer remains
governed by the [code signing policy](../README.md#code-signing-policy). See Microsoft's
[package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements).

An unsigned preparation package is not a trusted end-user installation. For acceptance that
needs a Store-signed package, the maintainer can authorize a private Store submission and test
updates before public availability. This still requires certification and an explicit submission;
preparation scripts do neither. See [private audiences and testing](https://learn.microsoft.com/en-us/windows/apps/publish/beta-testing-and-targeted-distribution).

## Listing, licensing and review material

The [listing and certification draft](microsoft-store-listing.md) provides concrete EN/ES copy,
the capability justification and reviewer steps using existing synthetic fixtures. Its wording
and portal selections require maintainer review before submission.

- The maintainer confirmed **Free** for the first Store publication.
  The maintainer selects markets and publication visibility in Partner Center; preparation
  does not assume those choices or schedule a release date.
- Provide accurate English and Spanish descriptions, system requirements, category, age-rating
  answers and screenshots. State that live capture requires access to a supported SQL Server
  and that existing projects can be opened offline.
- Reuse the synthetic English/light and Spanish/dark screenshots retained from 1.2 acceptance,
  including the code inspector and canvas. Before upload, review their content for private
  details and check current Store size/crop requirements. Existing captures are source material,
  not approved Store screenshots; none are added by this guide. The versioned
  [canvas screenshot](images/canvas-keys-light.png) is another available source.
- The current public privacy URL candidate is
  [README privacy policy](https://github.com/jmanuelsoberano/schemacraft#privacy-policy).
  Review it against the final package before submitting: describe local configuration, logs,
  saved projects and remembered credentials accurately, and distinguish SchemaCraft's handling
  from WebView2 and Microsoft's Store services. Final privacy wording and URL acceptance remain
  pending. Win32 products require a privacy policy under Store policy 10.5.1.
- Supply synthetic projects and clear certification steps. The application must be testable;
  required server access must work, and any needed review login must be a dedicated demo
  account. An offline project demonstrates offline features, not successful SQL capture.
  See [Store policies 10.2.4, 10.3 and 10.5.1](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies).
- Preserve **AGPL-3.0-only**, third-party notices and access to the corresponding source for the
  submitted release. Provide the project's license as the listing's license terms rather than
  silently relying on default application terms. The agreement accommodates FOSS and assigns
  license/source compliance to the publisher; this is not a guarantee that Microsoft will
  accept this application. See [App Developer Agreement, sections 4(c) and 4(i)](https://go.microsoft.com/fwlink/?linkid=528905).

Create a submission only when the maintainer is ready to review those materials. Complete its
required fields, package upload and any restricted-capability explanation; review publication
controls before **Submit for certification**. Certification and public publication are distinct
from creating a draft. See the [MSIX submission checklist](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/create-app-submission).

## Acceptance gates

Package preparation and its contract checks have evidence below. Account, deployment and Store
acceptance remain separate gates. Update each with actual evidence rather than inferring it
from an unpackaged application test or from successful package creation.

| Gate                                | Evidence required                                                                                                                                                                       | Status                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Account and product identity        | Individual account verified; name reserved; exact manifest identity and Store ID recorded                                                                                               | Passed; official identity recorded above                    |
| Independent distribution            | Portable and NSIS build without Store credentials/configuration; shared core and project format remain independent                                                                      | Contract, tests and full local release/NSIS build passed    |
| MakeAppx and payload validation     | Real SDK package created and validated; source release checksum, embedded executable, manifest, version and architecture checked                                                        | Passed with real identity; initial portal validation passed |
| Windows App Certification Kit       | Applicable desktop-package tests on the intended package; retain HTML/XML reports, versions and package hash, and review failures or unavailable tests                                  | Pending                                                     |
| Actual MSIX installation            | Install and launch through the intended trusted distribution route on the target Windows environment; record account/privilege scope and version                                        | Pending                                                     |
| MSIX update and coexistence         | Update an installed package of the same family; verify saved projects, preferences and remembered credentials; inspect coexistence with the existing portable/NSIS channel              | Pending                                                     |
| MSIX uninstallation                 | Verify removal of package registration/application files and record actual handling of package data and external user projects                                                          | Pending                                                     |
| WebView2                            | Verify packaged startup with the runtime and the actual missing-runtime experience; record whether absence was natural or simulated                                                     | Pending                                                     |
| Credentials and data paths          | Test SQL-login connect/remember/forget, restart, save/reopen, logs and effective configuration paths under package identity; no connection passwords in project/configuration/log files | Pending                                                     |
| SQL and Windows authentication      | Check packaged SQL capture against 2019/2022 and Windows authentication on an authorized Windows SQL instance; state local-account/domain scope explicitly                              | Pending                                                     |
| Listing, privacy and license        | Review EN/ES material, privacy URL, AGPL/source links, dependencies and synthetic certification instructions                                                                            | Pending                                                     |
| Store certification and publication | Microsoft accepts the submitted package; record outcome and maintainer authorization for public availability                                                                            | Submitted 2026-10-22; outcome and publication pending       |

Each real-app test must back up and restore existing preferences after confirmed application
termination. Package-specific state and credentials used for tests must be synthetic. A local
Windows-authentication result does not establish domain authentication, and a hosted Server
environment does not establish consumer Windows behavior beyond what was actually checked.

### First private candidate

The maintainer chose a first private distribution for their own account, with all available
markets and price zero. The `SchemaCraft private testing` group contains one member; its email
is kept in Partner Center. Automatic conversion to a public audience is off. The submission is
held until the maintainer selects **Publish now**, even after certification.

The product uses the **Developer tools** category and **English (United States)** and
**Spanish (Spain)** listings, the two locales required by the package. The maintainer chose
the same neutral English/Spanish copy and no additional generic-language listings.
Windows automatic OneDrive backup of application data is disabled in the product
declarations; this does not control project files users save in their own synchronized folders.
The IARC questionnaire and the maintainer's personal acceptance are saved: PEGI 3, ESRB Everyone
and global IARC 3, with regional ratings supplied by IARC.

Both required listings contain the approved neutral text, seven features, license/source links
and one actual 1.2.0 synthetic screenshot with a localized caption. Partner Center marks both
complete. The extra generic English/Spanish listings were removed; no private connection
details or credentials were supplied as reviewer material.

Private reviewer instructions are prepared with a direct download of the existing synthetic
offline sample and an optional reviewer-controlled SQL setup. Partner Center did not save them:
it returned **Unable to save. Please try again.**, and reopening the page showed an empty field.
The maintainer explicitly authorized the first private submission without these optional notes.
The instructions remain available in the [reviewer material](microsoft-store-listing.md#certification-material-and-proposed-reviewer-steps);
an edited form is not evidence that Microsoft received them.

The real-identity candidate wraps the published 1.2.0 portable, with source and extracted
executable SHA-256 `765dd024aeb87b8536ebf40b62f8d1a3faaee64a8133ca892ceed584ad08b033`.
MakeAppx `10.0.28000.1839` passed semantic packing, unpacking and closed-payload verification;
the report has `validation: false`. Candidate MSIX SHA-256:
`45be7de3b9a805d8d072305e8f5d91e2479118c39961a97913743527e8155c14`.
Local provenance records the source release, packaging commit, GitHub asset digest and hashes.

Partner Center accepted the upload as version `1.2.0.0`, x64, Windows.Desktop minimum
`10.0.19041.0`, and shows Packages complete. Only the desktop family is selected; automatic
addition to future device families is off. The portal still requires approval for
`runFullTrust`; its saved justification describes the native host, normal user privilege,
SQL metadata reads, local project/export files and optional Credential Manager use.

The maintainer authorized the private certification submission and retains the publication
actions. The private candidate can obtain a trusted Store-signed package for the installed-package
gates; it is not acceptance for public rollout. Finish those gates and review their actual evidence
before changing to a public audience. No installed-MSIX test, WACK result or Store approval is
claimed by the successful upload.

### Certification submission, 2026-10-22

The maintainer authorized sending Submission 1 without the optional certification notes.
Partner Center confirmed **In certification** for the existing `1.2.0.0` x64 package, with
submission complete, preprocessing in progress, and certification and publication not started.
This records receipt into the workflow, not a certification result or capability approval.
The package and published GitHub release assets were unchanged.

Before submission, persisted settings were read back: private audience, only the existing
private testing group selected, automatic public conversion off, price zero, and manual
publication hold. The accepted-submission page explicitly states that publication starts only
after **Publish now**. No publication was authorized or performed.

The note-saving failure reproduced after a fresh personal sign-in with the approved text below
the displayed length limit. Microsoft documents [certification notes as optional](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/manage-submission-options#notes-for-certification).
The support request remains open as last checked on this date, independently of certification.
Reviewers may still require more information to test SQL features; no hosted database or review
credentials were supplied. Respond to the actual review result rather than claiming that the
missing instructions have been accepted.

After approval, obtain maintainer authorization to make the package available to the existing
private audience and download it through Store. Complete the acceptance gates above with that
trusted package before requesting public availability. An update test requires a newer package
of the same family; reinstalling the same version does not prove that updates preserve state.
Keep further Store work in this branch and pull request. Support/reporting changes belong in a
separate pull request and do not alter this submitted candidate.

### Preparation evidence, 2026-10-19

The published `schemacraft-v1.2.0-windows-x64.exe` was packed and unpacked using MakeAppx
**10.0.26100.8249** with explicit `--validation` mode. The input and extracted executable were
byte-identical. The resulting package is unsigned and uses the validation identity; it was not
installed or submitted to Microsoft.

| Recorded artifact                        | SHA-256                                                            |
| ---------------------------------------- | ------------------------------------------------------------------ |
| Source and extracted portable executable | `765dd024aeb87b8536ebf40b62f8d1a3faaee64a8133ca892ceed584ad08b033` |
| Validation MSIX from this run            | `096929947c0535988efc7fe20e16fe66b0c25ea4a82725dd10ed4f3a05f19645` |

`npm run distribution:check` and all 14 distribution/packaging tests passed. They check the
independent release boundary, identity and version validation, manifest declarations, the
payload allowlist, byte preservation and rejected inputs. The frontend's 817 tests, production
build and documentation check also passed. Rust formatting and Clippy passed, the workspace
tests passed twice, and 64 integration checks passed against each local SQL Server 2022 and 2019. The workflow's retrieval step was also exercised locally against the published release:
tag ancestry, source version, checksum file and GitHub asset digest agreed. The three PowerShell
workflow blocks passed parsing. These checks do not establish any pending installed-package gate.

The ordinary `npm run tauri build` also completed with the existing base configuration, producing
the optimized executable and per-user NSIS installer without Store identity or account settings.
These local outputs did not replace the published 1.2.0 assets.

[CI run 39341425363](https://github.com/jmanuelsoberano/schemacraft/actions/runs/39341425363)
also passed both required checks, including real MakeAppx validation on Windows and all 11
portable-application smoke checks. The hosted application test covers opening, About 1.2.0,
language/theme changes and keyboard behavior; it does not run the application under MSIX identity.

## What the 1.2 release already established

The [1.2.0 release](https://github.com/jmanuelsoberano/schemacraft/releases/tag/v1.2.0) records
checksum verification of both Windows assets, 75 real-application checks against each of SQL
Server 2022 and 2019, 18 checks with the previous reader, and a successful local installer →
installed application → uninstall check. The maintainer accepted the features and Spanish UI
using SQL login. Preferences were restored after the application tests.

That release explicitly deferred Windows authentication in 1.2, a fresh standard-account/clean
environment, missing WebView2, and exported HTML on another machine without SchemaCraft. Its
publication exception is **specific to 1.2's existing distribution**. It neither closes any
Store gate above nor demonstrates MSIX installation, updates, credential access, data isolation,
uninstallation or certification. The [release checklist](release-checklist.md) retains the
feature-level verification context; the release notes record the publication exception.
