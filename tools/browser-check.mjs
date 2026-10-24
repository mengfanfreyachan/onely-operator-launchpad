import { createRequire } from "node:module";
import { mkdir, stat } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await mkdir("demo/screenshots", { recursive: true });
await page.goto(process.env.APP_URL || "http://127.0.0.1:4173");
await page.waitForSelector(".hero-strip");
assert.equal(await page.locator(".metrics strong").first().textContent(), "30");
await page.screenshot({
  path: "demo/screenshots/overview.png",
  fullPage: true,
});
await page.click('[data-view="leads"]');
await page.click("[data-import]");
await page.click("#import-fixture");
await page.waitForSelector(".result-grid");
assert.deepEqual(await page.locator(".result-grid strong").allTextContents(), [
  "6",
  "3",
  "2",
  "1",
]);
await page.click("#import-fixture");
await page.waitForFunction(
  () => document.querySelector(".result-grid strong")?.textContent === "0",
);
assert.deepEqual(await page.locator(".result-grid strong").allTextContents(), [
  "0",
  "9",
  "2",
  "1",
]);
await page.keyboard.press("Escape");
await page.click("#grade-filter");
await page.selectOption("#grade-filter", "A");
await page.screenshot({ path: "demo/screenshots/leads.png", fullPage: true });
await page.selectOption("#grade-filter", "all");
await page.fill("#search", "Demo Applicant 31");
await page.locator("tr[data-lead]").first().click();
await page.click("#draft-a");
await page.check("#permission");
await page.check("#approval");
await page.click("#save-draft");
await page.click("#next-stage");
assert.equal(
  await page
    .locator("#detail .detail-tags")
    .innerText()
    .then((t) => t.includes("已触达")),
  true,
);
await page.click("#next-stage");
await page.click("#next-stage");
await page.click("#next-stage");
assert.match(await page.locator("#toast").textContent(), /须核验/);
for (const k of ["us_verified", "english_verified", "age18", "terms"])
  await page.check(`[data-check="${k}"]`);
await page.fill("#task-score", "88");
await page.click("#save-checks");
await page.click("#next-stage");
await page.click("#next-stage");
for (const k of ["training", "first_task"])
  await page.check(`[data-check="${k}"]`);
await page.fill("#account-id", "demo-account-31");
await page.click("#save-checks");
await page.click("#next-stage");
assert.match(await page.locator("#detail .detail-tags").innerText(), /已激活/);
await page.click("#record-work");
await page.click("#close-drawer");
await page.click('[data-view="cohort"]');
await page.screenshot({ path: "demo/screenshots/cohort.png", fullPage: true });
await page.click('[data-view="overview"]');
await page.fill('[data-rate="2"]', "20");
assert.equal(await page.locator("#projection>b").textContent(), "51");
await page.reload();
await page.waitForSelector(".hero-strip");
const stored = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("onely-launchpad-v1")),
);
assert.equal(stored.leads.length, 36);
assert.equal(
  stored.leads.find((l) => l.name === "Demo Applicant 31").status,
  "activated",
);
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto(process.env.APP_URL || "http://127.0.0.1:4173");
await mobile.waitForSelector(".hero-strip");
await mobile.screenshot({
  path: "demo/screenshots/mobile.png",
  fullPage: true,
});
assert.equal(
  await mobile.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
  true,
);
assert.deepEqual(errors, []);
console.log(
  "PASS: import twice, filters, personalized draft, sequential gates, activation, persistence, forecast, mobile layout, no page errors.",
);
await browser.close();
const alreadyRendered = await stat("demo/walkthrough.mp4").then(
  () => true,
  () => false,
);
if (!alreadyRendered) await import("./record-demo.mjs");
