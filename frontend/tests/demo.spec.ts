import { test, expect } from "@playwright/test";
import fs from "node:fs";
const login = async (page: any, name = "alex") => {
  await page.goto("/");
  await page.getByLabel("Demo account").selectOption(name);
  await page.getByRole("button", { name: "Open operations workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Campus overview", exact: true }),
  ).toBeVisible();
};

test("all screens render, navigation and mobile layout work", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  fs.mkdirSync("../docs/screenshots", { recursive: true });
  for (const [route, title] of [
    ["overview", "Campus overview"],
    ["logbook", "Operations logbook"],
    ["rounds", "Operator rounds"],
    ["tasks", "Corrective actions"],
    ["handovers", "Shift handover"],
    ["assets", "Equipment register"],
    ["designer", "Form designer"],
    ["workflow", "Workflow editor"],
    ["workspace", "Developer workspace"],
    ["config", "Configuration controls"],
    ["integrations", "Integrations"],
    ["audit", "Audit trail"],
  ]) {
    await page.goto("/#" + route);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `../docs/screenshots/${route}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#overview");
  await expect(
    page.getByRole("heading", { name: "Campus overview", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../docs/screenshots/mobile-overview.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.goto("/#designer");
  await expect(
    page.getByRole("heading", { name: "Form designer", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../docs/screenshots/mobile-designer.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("technician completes an inspection; supervisor approves and closes it", async ({
  page,
}) => {
  await login(page, "maya");
  await page
    .getByRole("button", { name: "New inspection", exact: true })
    .click();
  const title = "Browser validation " + Date.now();
  await page.getByLabel("Inspection title").fill(title);
  await page
    .getByRole("button", { name: "Create inspection", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.getByLabel("Discharge temperature", { exact: true }).fill("24");
  await page
    .getByLabel("Equipment condition", { exact: true })
    .selectOption("Normal");
  await page.getByLabel("Access route is clear and safe").check();
  await page
    .getByLabel("Inspection observations")
    .fill("Equipment checked during browser validation.");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve inspection", exact: true }),
  ).toBeDisabled();
  const ref = await page.locator(".page-heading h1").textContent();
  await page
    .getByRole("button", { name: "Switch account", exact: true })
    .click();
  await page.getByLabel("Demo account").selectOption("james");
  await page.getByRole("button", { name: "Open operations workspace" }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Approve inspection", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Close inspection", exact: true })
    .click();
  await expect(
    page.getByText("Inspection closed", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: ref!, exact: true }).first().click();
  await expect(
    page.getByText("Inspection closed", { exact: true }),
  ).toBeVisible();
});

test("designer edits survive navigation and published versions affect new work", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#designer");
  await page.getByLabel("Upper operating limit", { exact: true }).fill("44");
  await page
    .getByRole("button", { name: "Workflow editor", exact: true })
    .click();
  await page.getByLabel("Require transition comment").check();
  await page
    .getByRole("button", { name: "Publish version", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Configuration published" }),
  ).toContainText("Configuration published");
  await page
    .getByRole("button", { name: "Campus overview", exact: true })
    .click();
  await page
    .getByRole("button", { name: "New inspection", exact: true })
    .click();
  await page
    .getByLabel("Inspection title")
    .fill("Published form browser validation " + Date.now());
  await page
    .getByRole("button", { name: "Create inspection", exact: true })
    .click();
  await expect(
    page.getByText("Upper operating limit: 44°C", { exact: true }),
  ).toBeVisible();
  // Restore the working baseline for the walkthrough without modifying existing versions.
  const boot = await (await page.request.get("/api/bootstrap")).json();
  const original = await (await page.request.get("/api/config/1")).json();
  expect(
    (
      await page.request.post("/api/config", {
        data: { definition: original.definition, base_version: boot.config.id },
      })
    ).status(),
  ).toBe(201);
});

test("sensor integration retries over HTTP, then carries work into an acknowledged handover", async ({
  page,
}) => {
  await login(page, "james");
  await page.goto("/#integrations");
  await page.getByLabel("Temperature (°C)", { exact: true }).fill("39");
  const responsePromise = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/sensor-events") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Send sensor event", exact: true })
    .click();
  const job = await (await responsePromise).json();
  let sensorRecord: number;
  await expect
    .poll(
      async () => {
        const boot = await (await page.request.get("/api/bootstrap")).json();
        const event = boot.audit.find(
          (a: any) =>
            a.action === "Sensor exception created" &&
            a.detail.job_id === job.id,
        );
        if (!event) return false;
        sensorRecord = event.record_id;
        const integration = boot.jobs.find(
          (j: any) =>
            j.kind === "integration" && j.payload.record_id === sensorRecord,
        );
        return (
          integration?.status === "Completed" && integration.attempts === 2
        );
      },
      { timeout: 20000, intervals: [1000] },
    )
    .toBe(true);
  await page.goto("/#handovers");
  await page
    .getByLabel("Handover briefing")
    .fill("Browser validation: incoming team to verify sensor cooling alert.");
  await page
    .getByRole("button", { name: "Issue handover report", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Acknowledge receipt", exact: true })
    .first()
    .click();
  await expect(
    page.getByText(/Acknowledged by James Wilson/).first(),
  ).toBeVisible();
});

test("classic designer rules and custom workflow run against the server", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#designer");
  await page.getByLabel("Default value", { exact: true }).fill("24");
  await page
    .getByRole("button", { name: "+ Add Invalid If rule", exact: true })
    .click();
  await page.getByLabel("Invalid If operator 1").selectOption("lt");
  await page.getByLabel("Invalid If value 1").fill("0");
  await page
    .getByLabel("Invalid If message 1")
    .fill("Reading cannot be negative.");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByLabel("Discharge temperature", { exact: true }).fill("-1");
  await page
    .getByRole("button", { name: "Validate preview submission" })
    .click();
  await expect(page.locator(".j5-status")).toHaveText(
    /Reading cannot be negative/,
  );
  await page.reload();
  await expect(page.getByLabel("Invalid If value 1")).toHaveValue("0");
  await page
    .getByRole("button", { name: "Workflow editor", exact: true })
    .click();
  await page.getByRole("button", { name: "Add state", exact: true }).click();
  await page
    .getByLabel("State name", { exact: true })
    .fill("Engineering review");
  await page.getByLabel("State name", { exact: true }).blur();
  await page.getByLabel("Allow form editing in this state").check();
  await page
    .locator(".j5-transition-list")
    .getByRole("button", { name: /Approve inspection/ })
    .click();
  await page
    .getByLabel("Target", { exact: true })
    .selectOption("Engineering review");
  await page
    .getByRole("button", { name: "Add transition", exact: true })
    .click();
  await page.getByLabel("Action label", { exact: true }).fill("Release review");
  await page
    .getByLabel("Source", { exact: true })
    .selectOption("Engineering review");
  await page.getByLabel("Target", { exact: true }).selectOption("Approved");
  await page.getByLabel("Require transition comment").check();
  await page
    .getByRole("button", { name: "+ Add Guard conditions rule", exact: true })
    .click();
  await page.getByLabel("Guard conditions field 1").selectOption("temperature");
  await page.getByLabel("Guard conditions operator 1").selectOption("lte");
  await page.getByLabel("Guard conditions value 1").fill("28");
  await page
    .getByLabel("Guard conditions message 1")
    .fill("Temperature must be below 28.");
  await page
    .getByRole("button", { name: "Publish version", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Configuration published" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Edit simulation field values" })
    .click();
  await page.getByLabel("Discharge temperature", { exact: true }).fill("24");
  await page
    .getByLabel("Equipment condition", { exact: true })
    .selectOption("Normal");
  await page.getByLabel("Access route is clear and safe").check();
  await page
    .getByLabel("Inspection observations")
    .fill("Simulated routine check.");
  const sim = page.locator(".j5-simulation");
  await sim
    .getByRole("button", { name: "Submit for review →", exact: true })
    .click();
  await expect(page.locator(".j5-status")).toContainText("Draft → Submitted");
  await sim
    .getByRole("button", { name: "Approve inspection →", exact: true })
    .click();
  await expect(page.locator(".j5-status")).toContainText(
    "does not have permission",
  );
  await page
    .getByLabel("Acting role", { exact: true })
    .selectOption("supervisor");
  await sim
    .getByRole("button", { name: "Approve inspection →", exact: true })
    .click();
  await expect(page.locator(".j5-status")).toContainText(
    "Submitted → Engineering review",
  );
  await sim
    .getByRole("button", { name: "Release review →", exact: true })
    .click();
  await expect(page.locator(".j5-status")).toContainText("requires a comment");
  await page
    .getByLabel("Comment", { exact: true })
    .fill("Engineering checks complete.");
  await sim
    .getByRole("button", { name: "Release review →", exact: true })
    .click();
  await expect(page.locator(".j5-status")).toContainText(
    "Engineering review → Approved",
  );
  const boot = await (await page.request.get("/api/bootstrap")).json();
  expect(boot.config.definition.states).toContain("Engineering review");
  const record = await (
    await page.request.post("/api/records", {
      data: { title: "Custom workflow browser validation", asset_id: "AHU-01" },
    })
  ).json();
  expect(record.values_json.temperature).toBe(24);
  const original = await (await page.request.get("/api/config/1")).json();
  expect(
    (
      await page.request.post("/api/config", {
        data: { definition: original.definition, base_version: boot.config.id },
      })
    ).status(),
  ).toBe(201);
});

test("logbook entry, flags, filters, timeline, calendar and CSV export persist", async ({
  page,
}) => {
  await login(page, "james");
  await page.goto("/#logbook");
  await page.getByRole("button", { name: "New Entry", exact: true }).click();
  const message = "Property handover browser test " + Date.now();
  await page.getByLabel("Operational message", { exact: true }).fill(message);
  await page.getByLabel("Status", { exact: true }).selectOption("On Hold");
  await page.getByLabel("Priority", { exact: true }).selectOption("High");
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Logbook entry saved");
  await page
    .getByLabel("Add note or flag")
    .fill("Inspect this equipment before the night shift.");
  await page.getByLabel("Raise flag", { exact: true }).check();
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(page.locator(".j5-notes")).toContainText(
    "Inspect this equipment",
  );
  await page.getByRole("button", { name: /Show Audit History/ }).click();
  await expect(page.locator(".j5-audit")).toContainText("Flag added");
  await page.getByRole("button", { name: "Back to list", exact: true }).click();
  await page.getByLabel("Search logbook").fill(message);
  await page
    .locator(".j5-search")
    .getByRole("button", { name: "Search", exact: true })
    .click();
  await expect(page.locator(".j5-log-table tbody tr")).toHaveCount(1);
  await page.getByLabel("Filter status").selectOption("Closed");
  await expect(page.getByText("No entries match these filters.")).toBeVisible();
  await page.getByLabel("Filter status").selectOption("On Hold");
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await page.getByLabel("Flagged entries", { exact: true }).check();
  await expect(page.locator(".j5-log-table tbody tr")).toHaveCount(1);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  const downloaded = await download;
  const contents = fs.readFileSync((await downloaded.path())!, "utf8");
  expect(contents).toContain(message);
  expect(contents).toContain("On Hold");
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.locator(".j5-timeline")).toContainText(message);
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.locator(".j5-calendar")).toContainText(message);
  await page.locator(".j5-calendar .j5-event").click();
  await expect(
    page.getByLabel("Operational message", { exact: true }),
  ).toHaveText(message);
  await expect(page.locator(".j5-notes")).toContainText(
    "Inspect this equipment",
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../docs/screenshots/logbook-detail.png",
    fullPage: true,
  });
});

test("spreadsheet authoring, formulas, packages and controlled releases", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#designer");
  await page.locator('[data-cell="A8"]').click();
  await page.getByLabel("Cell value or formula").fill("Calculated reading");
  await page.locator('[data-cell="B8"]').click();
  await page.getByLabel("Cell value or formula").fill("=SUM(2,3,4)");
  await expect(page.locator('[data-cell="B8"]')).toHaveText("9");
  await page.locator('[data-cell="A8"]').click();
  await page.locator('[data-cell="B8"]').click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../docs/screenshots/spreadsheet-authoring.png",
    fullPage: true,
  });
  await page.goto("/#workspace");
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Browser spreadsheet project");
  await page
    .getByRole("button", { name: "New from working definition", exact: true })
    .click();
  await expect(page.getByLabel("Project source")).toHaveValue(
    /Calculated reading/,
  );
  await page
    .getByRole("button", { name: "Validate project", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Valid project");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Project saved");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../docs/screenshots/developer-workspace.png",
    fullPage: true,
  });
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download saved ZIP" }).click();
  const zip = await download,
    zipPath = (await zip.path())!;
  await page
    .getByRole("button", { name: "Packages & API", exact: true })
    .click();
  await page.getByLabel("Inspect project ZIP").setInputFiles({
    name: "project.zip",
    mimeType: "application/zip",
    buffer: fs.readFileSync(zipPath),
  });
  await expect(page.getByRole("status")).toContainText(
    "Validated local project package",
  );
  await page
    .getByRole("button", { name: "Run local query", exact: true })
    .click();
  await expect(page.getByLabel("API response")).toContainText("INS-");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../docs/screenshots/packages-api.png",
    fullPage: true,
  });
  await page.goto("/#config");
  await page.getByLabel("Release name").fill("Browser reviewed spreadsheet");
  await page
    .getByRole("button", { name: "Create controlled draft", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve release", exact: true }),
  ).toBeDisabled();
  // Separate reviewer session, using the same public endpoints as the UI.
  const list = await (await page.request.get("/api/config-items")).json();
  const item = list.items.find(
    (x: any) => x.name === "Browser reviewed spreadsheet",
  );
  const reviewer = await page
    .context()
    .browser()!
    .newContext({ baseURL: process.env.DEMO_URL || "http://localhost:8088" });
  await reviewer.request.post("/api/session", {
    data: { username: "james", password: "campus-demo" },
  });
  const reviewed = await reviewer.request.post(
    `/api/config-items/${item.id}/approve`,
    {
      data: {
        revision: item.revision,
        note: "Checked browser spreadsheet and workflow.",
      },
    },
  );
  expect(reviewed.status()).toBe(200);
  await reviewer.close();
  await page
    .getByRole("button", { name: "Refresh releases", exact: true })
    .click();
  await page
    .locator(".j5-release-layout aside")
    .getByRole("button", { name: /Browser reviewed spreadsheet/ })
    .click();
  await page
    .getByRole("button", { name: "Publish approved release", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Published");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../docs/screenshots/controlled-release.png",
    fullPage: true,
  });
  await page.goto("/#overview");
  await page
    .getByRole("button", { name: "New inspection", exact: true })
    .click();
  await page
    .getByLabel("Inspection title")
    .fill("Spreadsheet runtime browser inspection");
  await page
    .getByRole("button", { name: "Create inspection", exact: true })
    .click();
  await expect(page.locator(".j5-sheet-runtime")).toContainText(
    "Calculated reading",
  );
  await expect(page.locator(".j5-sheet-runtime")).toContainText("9");
  await page.getByLabel("Discharge temperature", { exact: true }).fill("24");
  await page
    .getByLabel("Equipment condition", { exact: true })
    .selectOption("Normal");
  await page.getByLabel("Access route is clear and safe").check();
  await page
    .getByLabel("Inspection observations")
    .fill("Spreadsheet runtime verified.");
  await page
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve inspection", exact: true }),
  ).toBeVisible();
  const boot = await (await page.request.get("/api/bootstrap")).json(),
    original = await (await page.request.get("/api/config/1")).json();
  expect(
    (
      await page.request.post("/api/config", {
        data: { definition: original.definition, base_version: boot.config.id },
      })
    ).status(),
  ).toBe(201);
});

test("parallel workflow authoring and simulation complete both approvals", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#workflow");
  await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
  await page.getByLabel("Hierarchy node").selectOption("Submitted");
  await page
    .getByRole("button", { name: "Make parallel", exact: true })
    .click();
  await expect(page.locator(".j5-hierarchy-canvas")).toContainText(
    "Facilities approval",
  );
  await page
    .getByRole("button", { name: "Edit simulation field values" })
    .click();
  await page.getByLabel("Discharge temperature", { exact: true }).fill("24");
  await page
    .getByLabel("Equipment condition", { exact: true })
    .selectOption("Normal");
  await page.getByLabel("Access route is clear and safe").check();
  await page
    .getByLabel("Inspection observations")
    .fill("Parallel approval validation.");
  const sim = page.locator(".j5-simulation");
  await sim
    .getByRole("button", { name: "Submit for review →", exact: true })
    .click();
  await expect(page.locator(".j5-status")).toContainText("Draft → Submitted");
  await page
    .getByLabel("Acting role", { exact: true })
    .selectOption("supervisor");
  await sim
    .getByRole("button", { name: "Approve facilities →", exact: true })
    .click();
  await expect(page.locator(".j5-active-branches")).toContainText(
    "approval_1_done_1",
  );
  await sim
    .getByRole("button", { name: "Approve safety →", exact: true })
    .click();
  await expect(page.locator(".j5-status")).toContainText(
    "Submitted → Approved",
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../docs/screenshots/parallel-workflow.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../docs/screenshots/mobile-workflow.png",
    fullPage: true,
  });
});

test("rich-text logbook formatting and attachment survive reload", async ({
  page,
}) => {
  await login(page, "james");
  await page.goto("/#logbook");
  await page.getByRole("button", { name: "New Entry", exact: true }).click();
  const editor = page.getByLabel("Operational message", { exact: true });
  await editor.fill("Formatted facilities handover");
  await editor.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Logbook entry saved");
  await expect(editor.locator("b,strong")).toContainText(
    "Formatted facilities handover",
  );
  await page.getByLabel("Attach logbook files").setInputFiles({
    name: "handover.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Facilities checks and handover evidence."),
  });
  await expect(page.getByRole("status")).toContainText("Attachment saved");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "handover.txt", exact: true }).click();
  expect(fs.readFileSync((await (await download).path())!, "utf8")).toContain(
    "Facilities checks",
  );
  const entries = await (await page.request.get("/api/logbook")).json();
  const entry = entries.find(
    (x: any) => x.message === "Formatted facilities handover",
  );
  await page.reload();
  await page.getByLabel(`Edit log entry ${entry.id}`).click();
  await expect(
    page.getByRole("link", { name: "handover.txt", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Operational message", { exact: true }).locator("b,strong"),
  ).toContainText("Formatted facilities handover");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../docs/screenshots/rich-logbook.png",
    fullPage: true,
  });
  await page.getByLabel("Remove attachment handover.txt").click();
  await expect(
    page.getByRole("link", { name: "handover.txt", exact: true }),
  ).toHaveCount(0);
});

test("repeating tables, shared lists and XLSX interchange work in the designer", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#designer");
  await page.getByRole("button", { name: "Tables", exact: true }).click();
  await page
    .getByRole("button", { name: "Add repeating table", exact: true })
    .click();
  await expect(page.getByLabel("Table ID", { exact: true })).toHaveValue(
    "checks_1",
  );
  await page.getByRole("button", { name: "Libraries", exact: true }).click();
  await page.getByLabel("New option list name").fill("property_checks");
  await page
    .getByRole("button", { name: "Add option list", exact: true })
    .click();
  await expect(
    page.getByText("property_checks", { exact: true }).first(),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export XLSX", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("inspection.xlsx");
  await page
    .getByLabel("Import XLSX", { exact: true })
    .setInputFiles((await file.path())!);
  await expect(
    page.getByText("Workbook imported.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Tables", exact: true }).click();
  await expect(page.getByLabel("Table ID", { exact: true })).toHaveValue(
    "checks_1",
  );
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page
    .getByRole("button", { name: "Add row to Equipment checks", exact: true })
    .click();
  const table = page.locator(".j5-repeat");
  await table.getByLabel("Equipment", { exact: true }).fill("AHU-01");
  await table.getByLabel("Result", { exact: true }).selectOption("Pass");
  await expect(table.getByLabel("Equipment", { exact: true })).toHaveValue(
    "AHU-01",
  );
  await page.screenshot({
    path: "../docs/screenshots/repeating-preview.png",
    fullPage: true,
  });
});

test("developer Python execution, trace and documented API explorer", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#workspace");
  await page
    .getByRole("button", {
      name: "Load property handover example",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "services/inspection_service.py",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Run Python", exact: true }).click();
  await expect(page.getByLabel("Python stdout")).toContainText(
    "'exceptions': 1",
  );
  await page.getByRole("button", { name: "Trace Python", exact: true }).click();
  await expect(page.getByLabel("Trace step")).toBeVisible();
  await page.screenshot({
    path: "../docs/screenshots/python-trace.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Packages & API", exact: true })
    .click();
  await page
    .getByLabel("API endpoint")
    .selectOption("/restserver/30/area_hierarchy/areas");
  await page
    .getByRole("button", { name: "Run local query", exact: true })
    .click();
  await expect(page.getByLabel("API response")).toContainText(
    '"responseCode": 200',
  );
  await page
    .getByLabel("API endpoint")
    .selectOption("/ssf/datastore/predefined/area_hierarchy");
  await page.getByLabel("API query parameters").fill("flathierarchy=true");
  await page
    .getByRole("button", { name: "Run local query", exact: true })
    .click();
  await expect(page.getByLabel("API response")).toContainText(
    '"type": "flathierarchy"',
  );
});

test("building grants are editable and enforce immediate server access", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#workspace");
  await page.getByRole("button", { name: "Governance", exact: true }).click();
  await expect(page.getByLabel("maya campus-wide access")).toBeChecked();
  await page.getByLabel("maya campus-wide access").uncheck();
  const group = page.locator("fieldset").filter({ hasText: "Maya Chen" });
  await group
    .getByRole("button", { name: "Save Maya Chen access", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("saved");
  const technician = await page.context().browser()!.newContext();
  const req = technician.request;
  await req.post(new URL("/api/session", page.url()).href, {
    data: { username: "maya", password: "campus-demo" },
  });
  const boot = await (
    await req.get(new URL("/api/bootstrap", page.url()).href)
  ).json();
  expect(boot.buildings).toEqual([]);
  expect(boot.records).toEqual([]);
  await technician.close();
  await page.getByLabel("maya campus-wide access").check();
  await group
    .getByRole("button", { name: "Save Maya Chen access", exact: true })
    .click();
  await expect(page.getByLabel("maya campus-wide access")).toBeChecked();
});
