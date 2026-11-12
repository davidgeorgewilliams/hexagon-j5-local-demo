# Verification

Verified locally on 12 November 2026.

## Automated checks

- Production TypeScript compilation and Vite build pass.
- **61 backend cases pass** against the current source. Integration cases use real PostgreSQL in uniquely named temporary schemas; pure formula/package cases do not need database fixtures.
- **12 Playwright journeys pass** in a separate disposable Docker Compose environment. The suite covers all 12 application pages, desktop/mobile layouts, role switching, live inspection lifecycle, configuration/version pinning, worker HTTP retry delivery and handover acknowledgement.
- Additional browser coverage exercises spreadsheet editing and calculated cells, saved developer projects, ZIP download/import, API queries, second-person controlled release approval/publication, runtime spreadsheet forms, parallel workflow creation/simulation, rich-text formatting and authenticated attachment persistence/download/removal. New journeys exercise repeating tables, shared option lists, XLSX downloads/imports, Python execution/tracing, area/datastore contracts and building grants. A mobile workspace overflow found in the live smoke was fixed and added to browser coverage.

Backend checks cover permissions; typed and required values; stale updates; pinned definitions; evidence validation/hashes; corrective task creation and closure guards; handover snapshots; sensor jobs and retries; formula precedence/lazy branches/ranges/absolute references; range-interior and bound-cell cycles; malformed/over-budget formulas; server-authoritative calculated fields; merged-cell validation; rich-text sanitization; attachment revisions/access; compound inherited actions; independent parallel approvals; automatic completion; event-user effects; rejection of auto-closure over a task created in the same transaction; project revision conflicts; ZIP traversal/checksum rejection; unrecognized native-package inventory; reviewer separation; scoped publication; and documented-query-shaped Basic/session authentication. Additional contract cases cover repeating query rows, undefined values, signed pagination, inclusive/exclusive date bounds, CSV, staged asset transactions/cycles, data-point history, SQL logbook paging, immediate access revocation across download paths, mandatory publication review, row-level field permissions, lookup/conditional formulas, XLSX round-tripping, timer cancellation/re-entry/blocked guards, shallow/deep parallel history and Python runner authentication, timeouts and secret-free subprocess environments.

The included property-handover example has been validated through the same configuration and project validators as user-authored definitions. It includes compound preparation, two parallel review regions, formulas, field bindings, merged ranges, reviewer and event-time assignments.

## Local deployment and visual checks

The main stack is rebuilt with Docker Compose; PostgreSQL, FastAPI, the background worker, Python runner and Nginx report healthy. Database and evidence volumes are retained. A live smoke verifies the existing global version, record count and approved inspection 9 with its 34,363-byte evidence image after rebuild, plus the example's loading/calculation and five responsive editor/workspace/logbook layouts. The live smoke also confirms mandatory review, actual Python execution/tracing and representative area/query contracts. It reports no browser errors.

Demo captures are in `docs/screenshots/`. Reviewed captures include the spreadsheet designer, hierarchical workflow, developer workspace and rich-text logbook. The separate `/j5-references/` gallery holds 23 unmodified official reference images with source provenance. This checks local rendering, not pixel equality with the proprietary product.

## Reproduce

```bash
make test             # isolated PostgreSQL schemas
make test-browser     # separate disposable Compose project and volumes
```

Browser failure traces are retained under `frontend/test-results/`. The test script removes only its `octave-demo-e2e` project and volumes. Main demo data is preserved.

The legacy browser regression journeys explicitly set `REQUIRE_REVIEW=false` in their disposable environment so historical direct-publication paths remain covered. Mandatory review is independently tested at the backend and confirmed enabled in the main deployed stack.

## Limits

No licensed J5 runtime, native IndustraForm package, proprietary IDE integration or live J5 API compatibility test was executed. The formula and workflow interpreters are explicitly scoped independent implementations. No production load testing, regulatory validation or certification is claimed. Browser validation uses Chromium; other browser engines have not been tested.
