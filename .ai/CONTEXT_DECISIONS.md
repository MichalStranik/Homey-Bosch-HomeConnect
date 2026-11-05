# Context & Decisions

### [2026-11-05] Washer usage statistics
- **Status:** Done
- **Objective:** Persist wash cycles and show device counters plus an app-settings dashboard with periods, monthly counts, program ranking and history.
- **Sources & Ingestion:**
  - **Figma:** None
  - **Slack / Communications:** User approved the statistics proposal in this conversation.
  - **Base Components Reused:** `lib/appliance-device.ts`, `drivers/washer/device.ts`, `settings/index.html`, `api.ts`
- **Decisions & Rationale (Why & How):**
  - Use the existing Homey TypeScript architecture; Android/Compose rules do not apply.
  - Store per-device statistics locally; distinguish completed, aborted and unverified cycles. Never infer successful completion from power-off.
  - Keep lifetime/monthly aggregates and the latest 500 cycle records. No reconstruction of pre-install program history or inferred energy/water measurements.
  - Preserve existing uncommitted spin-limit changes in the washer device.
  - Verification: all 16 automated tests passed (including headless Edge dashboard and mocked persistence/restart); Homey build and debug validation passed. No live Homey installation or appliance test performed.
- **Touched Files:**
  - `lib/wash-statistics.ts`
  - `lib/appliance-device.ts`
  - `drivers/washer/device.ts`
  - `settings/index.html`
  - `settings/statistics.js`
  - `api.ts`

### [2026-11-05] Project documentation
- **Status:** Done
- **Objective:** Document the project for developers: overview, setup, architecture, protocol, extension guide.
- **Sources & Ingestion:**
  - **Figma:** None
  - **Slack / Communications:** None
  - **Base Components Reused:** Existing `README.txt`, `docs/homey-flow-playbook.md`, `docs/official-client-test-plan.md`, source comments in `lib/`
- **Decisions & Rationale (Why & How):**
  - Written in English to match the code, commits and existing docs.
  - `README.md` is the developer entry point; `README.txt` stays the Homey App Store text. `*.md` is excluded from the app bundle via `.homeyignore`.
  - Deep technical content lives in `docs/architecture.md` to keep the README short.
  - AGENTS.md targets Android/Compose; this repo is a Homey TypeScript app, so the Android-specific rules (Compose, StateFlow, DESIGN_SYSTEM, LOCALIZATION) don't apply here.
- **Touched Files:**
  - `README.md`
  - `docs/architecture.md`
  - `.ai/PROJECT_MAP.md`
  - `.ai/CONTEXT_DECISIONS.md`

### [2026-11-05] [Homey test-only publication]
- **Status:** Completed
- **Objective:** Publish this application only as a test version using its existing com.msd. ID.
- **Sources & Ingestion:**
  - **Figma:** None
  - **Slack / Communications:** Explicit user request; https://tools.developer.homey.app/apps ; namespace com.msd.
  - **Base Components Reused:** Existing application manifests and Homey CLI 4.5.2.
- **Decisions & Rationale (Why & How):**
  - Retain app ID/version. No live release, no hardware writes, no Git push.
  - Passed offline tests and publish validation. CLI account is not verified; optional verified check on HomeConnect needs support metadata and is not the applicable publication level.
  - Exclude HomeConnect private devices.json and SALUS internal research docs from app archives; add public SALUS README.txt. HomeConnect npm metadata synchronized with its app ID/version.
  - Supported AthomAppsAPI provides getBuilds/getBuild/updateBuildChannel and createSubmission(autoRelease=false); use test channel only. New apps may require Athom certification.
- **Touched Files:**
  - .ai/CONTEXT_DECISIONS.md

### [2026-11-05] Test publication completed - final readback
- All three build 1 releases are in state test: com.msd.bosch.homeconnect 1.2.0, com.msd.salus 0.6.1, com.msd.smartthings 4.0.2.
- Authenticated getMyApps readback confirms matching testVersion/testBuild and liveVersion=null for every application.
- No live-channel call or certification submission was made. User reiterated test only; do not submit for live publication.
- Public test-page availability was not independently verified (web fetch unavailable). Developer portal state is verified through the supported Apps API.
- Tests passed: HomeConnect 16 tests, SALUS 19 tests, SmartThings 15 regression scripts. All publish validations and builds passed.
- Local preparation: synchronized HomeConnect npm name/version; excluded private devices.json from its archive; excluded SALUS docs/.ai/AGENTS; added public SALUS README.txt. No runtime behavior changed, no hardware commands, no commit or push.
- Earlier SALUS CLI --path build attempt failed before publication with Cannot copy to a subdirectory of itself. Resolved by running in the actual apps/salus working directory; build and validation passed.
- No pending publication operations. Upload sessions shell-121/122/123 and API sessions shell-125/126 completed successfully.
- Publication correction: CLI --path used from Solax copied source Solax into HomeConnect. Initial build 1 included it. Adding ignore alone retains stale .homeybuild content; clear generated build before correction. API channel=draft did not change state=test. Reusing 1.2.0 rejected; create patch 1.2.1, sanitized fresh build, switch TEST to new build. No live release.

### [2026-11-05] Final correction supersedes prior publication checkpoint
- HomeConnect final TEST release is com.msd.bosch.homeconnect 1.2.1 BUILD 3. SALUS remains 0.6.1 BUILD 1; SmartThings remains 4.0.2 BUILD 1. All liveVersion fields are null.
- Corrected accidental CLI --path source copy. The ignore-walk directory exclusion alone did not remove it. Moved generated HomeConnect/Solax out of the source tree, cleared generated .homeybuild, rebuilt, asserted Solax and devices.json absent, uploaded build 3, and switched TEST to build 3.
- Prior HomeConnect build 1 is superseded; build 2 was never released. The draft-channel request did not unpublish build 1; do not claim it did. Never submitted for certification or live.
- Generated recovery copy retained locally under ignored Solax/.homeybuild/.publication-recovery-HomeConnect-Solax. It is not part of any current app source/bundle. No original source removed.
- Final API readback confirms TEST pointers and no LIVE release. Earlier HomeConnect 1.2.0 completion statements are superseded.

- 2026-11-05: User authorized committing and pushing pending changes in HomeConnect, SALUS and SmartThings. Final test versions: 1.2.1 / 0.6.1 / 4.0.2; no live release. Store installation remains blocked by the Bridge confirmation dialog unsupported by this client. SALUS and SmartThings share origin/master; synchronize both checkouts after sequential commits.
