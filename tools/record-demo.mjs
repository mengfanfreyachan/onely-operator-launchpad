import { readFile, mkdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
await mkdir("/tmp/onely-video-raw", { recursive: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: {
    dir: "/tmp/onely-video-raw",
    size: { width: 1280, height: 720 },
  },
});
const page = await context.newPage(),
  scenes = JSON.parse(
    await readFile("/tmp/onely-video-voice/timing.json", "utf8"),
  ),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const pause = (ms) => page.waitForTimeout(ms);
const click = async (selector) => {
  await page.locator(selector).first().click({ timeout: 5000 });
  await pause(700);
};
await page.goto(process.env.APP_URL || "http://127.0.0.1:4173");
await page.waitForSelector(".hero-strip");
await page.evaluate(() => {
  const d = document.createElement("div");
  d.id = "video-caption";
  d.style.cssText =
    "position:fixed;z-index:9999;right:17px;bottom:16px;padding:9px 13px;border-radius:7px;background:#ddfa83;color:#29321f;box-shadow:0 10px 40px #0003;font:700 13px sans-serif;pointer-events:none";
  document.body.append(d);
});
for (const [i, s] of scenes.entries()) {
  const start = Date.now();
  await page.evaluate(
    (t) =>
      (document.getElementById("video-caption").textContent =
        `演示 ${t.n}/9 · ${t.title} · 虚构数据`),
    { n: i + 1, title: s.title },
  );
  switch (s.scene) {
    case "overview":
      await page.evaluate(() => scrollTo(0, 0));
      await pause(1500);
      await page.locator(".hero-strip").hover();
      await pause(1000);
      break;
    case "funnel":
      await page.locator(".scenario").scrollIntoViewIfNeeded();
      await pause(1500);
      await page.locator('[data-rate="2"]').fill("20");
      await pause(2300);
      await page.locator('[data-rate="2"]').fill("40");
      await pause(1600);
      break;
    case "playbook":
      await click('[data-view="playbook"]');
      await pause(1100);
      await page.locator(".channel-grid").first().scrollIntoViewIfNeeded();
      await pause(1100);
      await page.evaluate(() => scrollTo({ top: 0, behavior: "smooth" }));
      break;
    case "import":
      await click('[data-view="leads"]');
      await click("[data-import]");
      await pause(900);
      await click("#import-fixture");
      await page.waitForFunction(
        () =>
          document.querySelector(".result-grid strong")?.textContent === "6",
      );
      await pause(1100);
      await click("#import-fixture");
      await page.waitForFunction(
        () =>
          document.querySelector(".result-grid strong")?.textContent === "0",
      );
      await pause(1400);
      await page.keyboard.press("Escape");
      break;
    case "scoring":
      await page.fill("#search", "Demo Applicant 31");
      await click("tr[data-lead]");
      await click(".score-detail summary");
      await pause(1200);
      break;
    case "outreach":
      await click("#close-drawer");
      await click('[data-view="outreach"]');
      await page
        .locator("tr[data-lead]")
        .filter({ hasText: "Demo Applicant 31" })
        .click();
      await click("#draft-a");
      await pause(2300);
      await click("#draft-b");
      await pause(900);
      await page.check("#permission");
      await page.check("#approval");
      await click("#save-draft");
      break;
    case "pipeline":
      await click("#next-stage");
      await pause(600);
      await click("#next-stage");
      await pause(600);
      await click("#next-stage");
      await pause(600);
      await click("#next-stage");
      await pause(800);
      for (const k of ["us_verified", "english_verified", "age18", "terms"])
        await page.check(`[data-check="${k}"]`);
      await page.fill("#task-score", "88");
      await click("#save-checks");
      await click("#next-stage");
      await click("#next-stage");
      await page.check('[data-check="training"]');
      await page.check('[data-check="first_task"]');
      await page.fill("#account-id", "demo-account-31");
      await click("#save-checks");
      await click("#next-stage");
      break;
    case "cohort":
      await click("#close-drawer");
      await click('[data-view="cohort"]');
      await pause(1200);
      await page.locator(".channel-grid").scrollIntoViewIfNeeded();
      await pause(1800);
      await page.evaluate(() => scrollTo({ top: 0, behavior: "smooth" }));
      break;
    case "scope":
      await click('[data-view="playbook"]');
      await page.locator(".two-col").last().scrollIntoViewIfNeeded();
      await pause(2500);
      await page.evaluate(() => scrollTo({ top: 0, behavior: "smooth" }));
      break;
  }
  const remaining = Math.round(s.duration * 1000) - (Date.now() - start);
  if (remaining > 0) await pause(remaining);
  console.log(
    `Scene ${i + 1}/${scenes.length} ${s.title} (${((Date.now() - start) / 1000).toFixed(1)}s)`,
  );
}
if (errors.length) throw Error("Browser page errors: " + errors.join(" | "));
const video = page.video();
await context.close();
await copyFile(await video.path(), "/tmp/onely-video-raw/walkthrough.webm");
await browser.close();
console.log("RAW_VIDEO=/tmp/onely-video-raw/walkthrough.webm");
