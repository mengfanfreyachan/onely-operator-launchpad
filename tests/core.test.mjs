import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalize,
  profileKey,
  parseCSV,
  importLeads,
  SignalModel,
  assess,
  draftMessage,
  transition,
  stopLead,
  followups,
  funnel,
  forecast,
  exportDrafts,
  csvCell,
  retention,
} from "../core.js";
const model = new SignalModel(
  JSON.parse(readFileSync(new URL("../data/training.json", import.meta.url))),
);
const sample = () =>
  normalize({
    name: "Demo Operator",
    email: "demo@example.com",
    profile_url: "https://example.com/demo",
    source: "Community opt-in",
    months: 18,
    platforms: "Instagram;TikTok",
    markets: "US;UK",
    english: 4,
    hours: 15,
    portfolio: true,
    community: true,
    age18: true,
    permission: true,
    bio: "Managed Instagram Reels and TikTok content calendars, fan DMs and weekly audience analytics for US creators.",
  });
test("CSV handles BOM, quoted commas, escaped quotes, embedded newlines and CRLF", () => {
  const rows = parseCSV(
    '\uFEFFname,bio\r\n"Demo, Name","said ""hi""\nand wrote posts"\r\n',
  );
  assert.equal(rows[0].name, "Demo, Name");
  assert.equal(rows[0].bio, 'said "hi"\nand wrote posts');
});
test("CSV rejects malformed quoting, duplicate headers and mismatched columns", () => {
  for (const s of [
    'a,b\n"unclosed',
    'a,b\n"value"oops,b',
    "a,a\nx,y",
    "a,b\nx",
  ])
    assert.throws(() => parseCSV(s));
});
test("Canonical email/profile dedupe; identical names alone never dedupe", () => {
  const l = sample();
  const r = importLeads(
    [l],
    [
      {
        ...l,
        email: " DEMO@EXAMPLE.COM ",
        profile_url: "https://www.example.com/demo/?utm_source=a#top",
      },
      {
        ...l,
        email: "other@example.com",
        profile_url: "https://example.com/other",
      },
    ],
  );
  assert.equal(r.report.duplicates, 1);
  assert.equal(r.report.added, 1);
  assert.equal(
    profileKey("https://www.EXAMPLE.com/demo/?q=1"),
    "example.com/demo",
  );
});
test("Import ignores forged approval, activation, identity id and verification fields", () => {
  const r = importLeads(
    [],
    [
      {
        ...sample(),
        status: "activated",
        us_verified: true,
        task_score: 100,
        id: "attacker",
        draft_approved: true,
      },
    ],
  );
  assert.equal(r.leads[0].status, "sourced");
  assert.equal(r.leads[0].us_verified, false);
  assert.equal(r.leads[0].task_score, 0);
  assert.notEqual(r.leads[0].id, "attacker");
  assert.equal(r.leads[0].draft_approved, false);
});
test("Duplicate import preserves unsubscribe, verified fields and history", () => {
  const l = sample();
  l.us_verified = true;
  stopLead(l, "unsubscribed");
  const r = importLeads([l], [{ ...l, status: "sourced", us_verified: false }]);
  assert.equal(r.leads[0].status, "unsubscribed");
  assert.equal(r.leads[0].us_verified, true);
  assert.equal(r.leads[0].events.length, 1);
});
test("Cross-key identity conflict is quarantined, missing identity/source rejected", () => {
  const x = sample(),
    y = normalize({
      ...sample(),
      email: "second@example.com",
      profile_url: "https://example.com/second",
    });
  const r = importLeads(
    [x, y],
    [
      { ...x, profile_url: y.profile_url },
      { name: "Blank", source: "X" },
      { ...x, email: "new@example.com", profile_url: "bad", source: "" },
    ],
  );
  assert.equal(r.report.conflicts, 1);
  assert.equal(r.report.invalid, 2);
  assert.equal(r.leads.length, 2);
});
test("Fixture gives 6 new/3 duplicate/2 invalid/1 conflict and is idempotent", () => {
  const initial = JSON.parse(
      readFileSync(new URL("../data/demo.json", import.meta.url)),
    ).map(normalize),
    incoming = parseCSV(
      readFileSync(
        new URL("../data/import-example.csv", import.meta.url),
        "utf8",
      ),
    );
  const a = importLeads(initial, incoming),
    b = importLeads(a.leads, incoming);
  assert.deepEqual(
    [a.report.added, a.report.duplicates, a.report.invalid, a.report.conflicts],
    [6, 3, 2, 1],
  );
  assert.deepEqual(
    [b.report.added, b.report.duplicates, b.report.invalid, b.report.conflicts],
    [0, 9, 2, 1],
  );
});
test("Local trained classifier performs inference; unknown text contributes no score", () => {
  assert.equal(model.predict(sample().bio).label, "operator");
  assert.equal(
    model.predict("Bookkeeping payroll invoices spreadsheets travel bookings")
      .label,
    "general",
  );
  const blank = sample();
  blank.bio = "zzzzxyz";
  assert.equal(assess(blank, model).pieces.at(-1)[1], 0);
});
test("Country, name and gender do not change prioritization", () => {
  const x = sample(),
    y = {
      ...x,
      name: "Different Name",
      country: "Another Country",
      gender: "different",
    };
  assert.equal(assess(x, model).score, assess(y, model).score);
  assert.equal(assess(x, model).grade, "A");
  assert.equal(assess(x, model).eligible, false);
});
test("Personalized templates cite profile fields, include boundaries and opt-out", () => {
  const text = draftMessage(sample());
  assert.match(text, /18 months/);
  assert.match(text, /Instagram/);
  assert.match(text, /emotional-companionship/);
  assert.match(text, /reply “no”/);
  assert.doesNotMatch(text, /guaranteed income/i);
  assert.notEqual(text, draftMessage(sample(), "B"));
});
test("Sequential pipeline cannot skip stages; manual contact needs permission and review", () => {
  const l = sample();
  assert.throws(() => transition(l, "applied", model));
  assert.throws(() => transition(l, "contacted", model));
  l.draft_approved = true;
  l.permission = false;
  assert.throws(() => transition(l, "contacted", model));
  l.permission = true;
  transition(l, "contacted", model);
  assert.equal(l.events.length, 1);
  assert.ok(l.next_followup);
});
test("Qualification and activation require full verified gates", () => {
  const l = sample();
  l.status = "applied";
  assert.throws(() => transition(l, "qualified", model));
  Object.assign(l, {
    us_verified: true,
    english_verified: true,
    task_score: 75,
    terms: true,
  });
  transition(l, "qualified", model);
  transition(l, "accepted", model);
  assert.throws(() => transition(l, "activated", model));
  l.training = true;
  l.first_task = true;
  l.account_id = "demo-account";
  transition(l, "activated", model);
  assert.equal(l.status, "activated");
});
test("Follow-up is due after 24h, only once, and stops on reply/opt-out", () => {
  const now = new Date("2026-10-24T00:00:00Z"),
    l = sample();
  l.draft_approved = true;
  transition(l, "contacted", model, now);
  assert.equal(
    followups([l], new Date(now.getTime() + 23 * 3600000)).length,
    0,
  );
  assert.equal(
    followups([l], new Date(now.getTime() + 24 * 3600000)).length,
    1,
  );
  l.events.push({ type: "followup", at: now.toISOString() });
  assert.equal(
    followups([l], new Date(now.getTime() + 25 * 3600000)).length,
    0,
  );
  l.events.pop();
  transition(l, "replied", model);
  assert.equal(
    followups([l], new Date(now.getTime() + 25 * 3600000)).length,
    0,
  );
});
test("Unsubscribe suppresses export and pipeline while preserving historical funnel", () => {
  const l = sample();
  l.draft = draftMessage(l);
  l.draft_approved = true;
  assert.match(exportDrafts([l]), /Demo Operator/);
  transition(l, "contacted", model);
  l.events.push({ type: "contacted", at: new Date().toISOString() });
  stopLead(l, "unsubscribed");
  assert.equal(funnel([l])[1].count, 1);
  assert.equal(followups([l], new Date(Date.now() + 86400000)).length, 0);
  assert.equal(exportDrafts([l]).split("\r\n").length, 1);
  assert.throws(() => transition(l, "replied", model));
});
test("Forecast uses unrounded stage values and reacts to response assumptions", () => {
  const rates = [0.75, 0.75, 0.4, 0.7, 0.6, 0.8, 0.85].map((rate) => ({
    rate,
  }));
  assert.ok(Math.abs(forecast(1600, rates).at(-1).value - 102.816) < 1e-8);
  rates[2].rate = 0.2;
  assert.ok(Math.abs(forecast(1600, rates).at(-1).value - 51.408) < 1e-8);
});
test("Retention waits for whole observation window; counts each person once", () => {
  const now = new Date("2026-10-24T00:00:00Z"),
    a = sample(),
    b = sample(),
    c = sample();
  a.events = [
    { type: "activated", at: "2026-10-14T00:00:00Z" },
    { type: "work", at: "2026-10-15T04:00:00Z" },
    { type: "work", at: "2026-10-21T05:00:00Z" },
    { type: "work", at: "2026-10-21T06:00:00Z" },
  ];
  b.events = [{ type: "activated", at: "2026-10-23T00:00:00Z" }];
  c.events = [{ type: "activated", at: "2026-10-14T00:00:00Z" }];
  stopLead(c, "unsubscribed");
  const r = retention([a, b, c], now);
  assert.deepEqual(r, [
    { days: 1, eligible: 2, retained: 1 },
    { days: 7, eligible: 2, retained: 1 },
  ]);
});
test("CSV export escapes formula prefixes and quotes", () => {
  assert.equal(csvCell("=SUM(A1:A2)"), '"\'=SUM(A1:A2)"');
  assert.equal(csvCell('He said "yes"'), '"He said ""yes"""');
});
