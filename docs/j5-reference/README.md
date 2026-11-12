# Verified J5 screenshot references

Open the local gallery at **http://localhost:8088/j5-references/** after starting/rebuilding the demo. The gallery and original images are in [frontend/public/j5-references](../../frontend/public/j5-references/). The [manifest](../../frontend/public/j5-references/manifest.json) records source pages, image dimensions, hashes and available topic modification dates.

The collection supplies visual evidence for the local implementation. It is kept separate from demo screenshots.

## Confirmed captures

- **Operations Logbook — list view** — Screen capture. [Official source](https://docs.hexagonppm.com/r/en-US/j5-Shift-Operations-Management-Help/Version-30/1046069). Compact list, List/Timeline/Calendar tabs, filter row, category add buttons, priority shading and amber status cells.
- **Operations Logbook — new entry** — Screen capture. [Official source](https://docs.hexagonppm.com/r/en-US/j5-Shift-Operations-Management-Help/Version-30/1046070). Grey action toolbar; a dense three-column form; pale-blue labels, rich-text controls, attachments and handover checkbox.
- **Work Instructions — built-in form** — Screen capture. [Official source](https://docs.hexagonppm.com/r/en-US/j5-Shift-Operations-Management-Help/Version-30/1051157). Work-order details and a task table with Done/Skip controls, comments, user and time columns. The capture shows a built-in operational form.
- **Shift Handover — list view** — Screen capture. [Official source](https://docs.hexagonppm.com/r/en-US/j5-Shift-Operations-Management-Help/Version-30/1046054). Area and report-summary columns, current-handover filtering, and status backgrounds.
- **IndustraForm Designer — navigation pane** — UI crop. [Official source](https://docs.hexagonppm.com/r/en-US/j5-IndustraForm-Designer-Help/Version-30/1199322). Native desktop navigation tree, connection scope, application folders and operational-area hierarchy. This is a pane crop, not the whole Designer window.
- **IndustraForm Designer — properties tabs** — UI crop. [Official source](https://docs.hexagonppm.com/r/en-US/j5-IndustraForm-Designer-Help/Version-30/1199341). Properties, Sections, Roles and Form Settings tabs above the cell selector.
- **IndustraForm Designer — validation and flags** — UI crop. [Official source](https://docs.hexagonppm.com/r/en-US/j5-IndustraForm-Designer-Help/Version-30/1211631). Collapsible Invalid If and Raise Flag If groups with Add Rule and compact operator controls.
- **IndustraForm Designer — mobile-layout dialog** — UI crop. [Official source](https://docs.hexagonppm.com/r/en-US/j5-IndustraForm-Designer-Help/Version-30/1490773). A native dialog with Field Label and Field ID columns. It is not the main form-design grid.
- **Workflow Editor — documented controls** — Control crops. [Official source](https://docs.hexagonppm.com/r/en-US/j5-Workflow-Editor-Help/Version-30/1390956). The documentation supplies these isolated control images. This is not a screenshot of a complete toolbar or editor window.
- **Workflow states — conceptual illustration** — Conceptual diagram. [Official source](https://docs.hexagonppm.com/r/en-US/j5-Workflow-Editor-Help/Version-30/1390958). An explanatory diagram showing Preparing, Approved, In Progress, Reviewing and Complete. The blue blocks are a documentation illustration, not evidence of the editor’s visual styling.

## Redesign implications

The operational screenshots show compact grey application chrome, thin separators, small action icons, in-line filters and dense tables. Entry forms use pale-blue label cells and muted blue section bars, with yellow/amber status fills. This provides direct visual evidence for replacing the custom card-based operations interface.

Designer captures support the native tree icons, scope selector, Properties / Sections / Roles / Form Settings tabs, validation groups and Mobile Layout dialog. They do not establish the pixel geometry of a complete Designer window.

Do not copy the blue conceptual workflow blocks as if they were the editor UI. Actual parallel/compound canvas crops and the runtime approval pane have now been verified as well as toolbar icons and behavioural documentation; full-window editor styling remains a reference gap. The public [Octave Institute course catalogue](https://institute.octave.com/Products/23) lists Workflow Editor and Designer training but says sign-in/registration is required; no gated course was accessed in this research.

Several operational captures contain 2019 sample dates despite appearing in the version 30 manual. Use these as explicit classic-J5 visual targets, not as evidence of the latest Tempo branding or every version's appearance.


## Additional workflow captures

Three unmodified images were added from the public manual:

- [Parallel states](https://docs.hexagonppm.com/r/en-US/j5-Workflow-Editor-Help/Version-30/1429646): a grey editor canvas with parallel approval regions, dashed separators and double-outline completion nodes; a separate runtime workflow tree with approval buttons.
- [Compound states](https://docs.hexagonppm.com/r/en-US/j5-Workflow-Editor-Help/Version-30/1429862): the Preparing container with nested approvals and an inherited Cancel action.

The gallery now contains 23 images. These additional captures establish nested-container styling but not a complete editor-window layout. The local hierarchical canvas adapts them to a browser interface. Source pages and hashes are recorded in the manifest.
