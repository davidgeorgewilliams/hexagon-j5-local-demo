# Product references and fidelity scope

Reference date: 12 November 2026. Target: publicly documented J5 version 30 concepts, applied to apartments, commercial offices and shared campus infrastructure.

This is an independent implementation with a local Python runtime. **It is not a licensed J5 distribution, a verified pixel-perfect clone, or a feature-complete replacement.** The public documentation establishes useful concepts and partial screenshots, but does not provide the proprietary runtime or a complete package/API specification.

| Area | Implemented locally | Remaining boundary |
|---|---|---|
| Designer | Editable 500 × 52 spreadsheet; cell values, formulas and field bindings; merged ranges; formatting; row/column insertion/deletion and sizes; range copy/paste as TSV; freeze controls; undo/redo; seven input types; field rules, roles and preview; repeating tables with row formulas and permissions; inherited option lists/themes; XLSX layout interchange | No native IndustraForm package execution, native resource inheritance, charts or full spreadsheet application parity |
| Formulas | 53 independently implemented bounded functions; arithmetic, comparisons, ranges, absolute references, field references, conditional/aggregate/text/date functions, calculated fields and event user/time; server-side recalculation and cycle detection | Not the proprietary J5 formula engine. The supported catalog is `/api/formulas`; unsupported functions fail explicitly. Coercion, date and error semantics are local |
| Workflow | Atomic, compound, parallel and final nodes; inherited parent actions; independent parallel regions; automatic completion; role/comment/evidence/task guards; formula guards; entry/exit/transition assignments; durable deadlines, blocked-timer retries, shallow/deep history, active-state persistence and simulation | No claim of complete J5 or SCXML semantics. No deferred event queue, cross-region jumps, arbitrary workflow scripts or native workflow import |
| Logbook | Rich-text authoring, safe links, headings/lists, notes/flags, attachments, audit history, list/timeline/calendar, columns, SQL filtering/sorting/pagination and CSV | Restricted formatting; pasted content is plain text. No embedded media, office-document editor or full native module parity |
| Configuration | Immutable published versions; reviewed configuration items; separate submitter/reviewer; release comments, snapshots/history, conflict checks, scoped building overrides and record version pinning | Independent local controls, not a verified implementation of proprietary Configuration Item Controls. Independent review is mandatory by default; explicit development configuration can disable the requirement |
| Developer workspace | Split form/workflow JSON editing, project validation, revision-controlled persistence, checksummed ZIP export/import, Python execution and line/locals tracing in a separate constrained container | Browser editor, not the J5 IDE. No breakpoint-driven debugger or installed native SDK. Native archives can be inventoried but not interpreted |
| API | Authenticated local OpenAPI and documentation-derived queries, areas, asset search/batch updates, data-point history and datastores; Basic/session authentication and current building grants | No licensed J5 server connection or verified native interoperability. Local names, mappings and filter extensions are disclosed at `/api/native-contract` |
| Enterprise | Per-user building grants, immediate revocation checks, scoped records/evidence/logbooks/handovers/versions and mandatory independent release review | Shared demo identities; no SSO or offline synchronisation; no production load or regulatory validation |
| Appearance | Classic grey editor chrome, compact controls, spreadsheet cells, native-style property tabs, dense operational tables, compound containers and divided parallel regions | Full window geometry and some layouts are adapted from incomplete captures. Exact visual parity is not certified |

## Primary references

- [Designer interface](https://docs.hexagonppm.com/r/en-US/j5-IndustraForm-Designer-Help/Version-30/1200092), [navigation pane](https://docs.hexagonppm.com/r/en-US/j5-IndustraForm-Designer-Help/Version-30/1199322), [properties tabs](https://docs.hexagonppm.com/r/en-US/j5-IndustraForm-Designer-Help/Version-30/1199341), [validation rules](https://docs.hexagonppm.com/r/en-US/j5-IndustraForm-Designer-Help/Version-30/1211631).
- [Export/import concepts](https://docs.hexagonppm.com/r/en-US/j5-IndustraForm-Designer-Help/Version-30/1047029). The manual describes ZIP/file operations; it does not establish native compatibility for this demo's `campus-project/v2` packages.
- [IF](https://docs.hexagonppm.com/r/en-US/j5-IndustraForm-Designer-Help/Version-30/1199048) and [SUM](https://docs.hexagonppm.com/r/en-US/j5-IndustraForm-Designer-Help/Version-30/1243551). These informed the local subset, including optional IF fallback and SUM's 1–30 arguments.
- [Workflow Editor](https://docs.hexagonppm.com/r/en-US/j5-Workflow-Editor-Help/Version-30/1412727), [parallel states](https://docs.hexagonppm.com/r/en-US/j5-Workflow-Editor-Help/Version-30/1429646), [compound states](https://docs.hexagonppm.com/r/en-US/j5-Workflow-Editor-Help/Version-30/1429862), [workflow event formulas](https://docs.hexagonppm.com/r/en-US/j5-Workflow-Editor-Help/Version-30/1429870).
- [Operations Logbook list](https://docs.hexagonppm.com/r/en-US/j5-Shift-Operations-Management-Help/Version-30/1046069) and [entry interface](https://docs.hexagonppm.com/r/en-US/j5-Shift-Operations-Management-Help/Version-30/1046070).
- [IndustraForm query API](https://docs.hexagonppm.com/r/en-US/j5-API-Reference/Version-30/1050110). See the [API contract matrix](API-CONTRACT.md) for implemented parameters, responses and explicit gaps.

## Visual provenance

The [reference gallery](../frontend/public/j5-references/index.html), served at `/j5-references/`, contains 23 unmodified official images. These include three newly verified captures: parallel approval regions, their runtime workflow pane, and a compound Preparing-state canvas. They are labelled as crops, not complete IDE windows. The [manifest](../frontend/public/j5-references/manifest.json) records sources, dimensions and hashes. See [research notes](j5-reference/README.md).

`docs/screenshots/` contains this demo's screenshots. Official originals and local implementation captures are kept distinct. Several official operational captures contain 2019 sample dates despite appearing in version 30 documentation.

## Demonstrating the work

A supported description is: “Built an independently implemented operations-management demo based on documented J5 concepts, with a Python formula/statechart runtime, spreadsheet authoring, parallel approvals, operational records, evidence and reviewed configuration releases.”

This project by itself does not establish prior commercial J5 experience or tested compatibility with a client's J5 installation.
