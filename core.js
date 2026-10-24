export const STAGES = [
  "sourced",
  "contacted",
  "replied",
  "applied",
  "qualified",
  "accepted",
  "activated",
];
export const LABELS = {
  sourced: "待触达",
  contacted: "已触达",
  replied: "已回复",
  applied: "已申请",
  qualified: "审核通过",
  accepted: "已接受入驻",
  activated: "已激活",
  rejected: "未通过",
  unsubscribed: "已退订",
};
export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const bool = (v) =>
  v === true || String(v).toLowerCase() === "true" || v === 1 || v === "1";
const bounded = (v, max) => Math.max(0, Math.min(max, Number(v) || 0));
export function profileKey(v) {
  try {
    const u = new URL(String(v).trim());
    if (!["http:", "https:"].includes(u.protocol)) return "";
    return (
      u.hostname.toLowerCase().replace(/^www\./, "") +
      u.pathname.toLowerCase().replace(/\/+$/, "")
    );
  } catch {
    return "";
  }
}
export function identityKeys(row) {
  const keys = [];
  const email = String(row.email || "")
    .trim()
    .toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) keys.push("email:" + email);
  const p = profileKey(row.profile_url);
  if (p) keys.push("profile:" + p);
  return keys;
}
export function normalize(raw) {
  return {
    id: raw.id || globalThis.crypto.randomUUID(),
    name: String(raw.name || "Unnamed operator")
      .trim()
      .slice(0, 120),
    email: String(raw.email || "")
      .trim()
      .toLowerCase(),
    profile_url: String(raw.profile_url || "").trim(),
    source: String(raw.source || "").trim(),
    country: String(raw.country || "Unknown").trim(),
    timezone: String(raw.timezone || "UTC").trim(),
    bio: String(raw.bio || "").slice(0, 5000),
    months: bounded(raw.months, 600),
    platforms: String(raw.platforms || ""),
    markets: String(raw.markets || ""),
    english: bounded(raw.english, 5),
    hours: bounded(raw.hours, 80),
    portfolio: bool(raw.portfolio),
    community: bool(raw.community),
    age18: bool(raw.age18),
    permission: bool(raw.permission),
    us_verified: false,
    english_verified: false,
    task_score: 0,
    terms: false,
    training: false,
    first_task: false,
    account_id: "",
    status: "sourced",
    variant: "A",
    draft: "",
    draft_approved: false,
    created_at: new Date().toISOString(),
    events: [],
    ...{ next_followup: null },
  };
}
export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "");
  let rows = [],
    row = [],
    s = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          s += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        s += c;
      }
      continue;
    }
    if (c === '"') {
      if (s || closed) throw Error("CSV 引号位置不合法");
      quoted = true;
    } else if (c === ",") {
      row.push(s);
      s = "";
      closed = false;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(s);
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
      s = "";
      closed = false;
    } else {
      if (closed) throw Error("CSV 引号后存在多余字符");
      s += c;
    }
  }
  if (quoted) throw Error("CSV 引号未闭合");
  if (s || row.length || closed) {
    row.push(s);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift().map((x) => x.trim());
  if (new Set(headers).size !== headers.length) throw Error("CSV 存在重复列名");
  return rows.map((values, i) => {
    if (values.length !== headers.length)
      throw Error(`CSV 第 ${i + 2} 行列数不符`);
    return Object.fromEntries(headers.map((h, j) => [h, values[j]]));
  });
}
export function importLeads(existing, incoming) {
  const leads = structuredClone(existing),
    index = new Map();
  for (const l of leads) for (const k of identityKeys(l)) index.set(k, l);
  const report = {
    total: incoming.length,
    added: 0,
    duplicates: 0,
    invalid: 0,
    conflicts: 0,
    issues: [],
  };
  for (const [i, raw] of incoming.entries()) {
    const keys = identityKeys(raw);
    if (!keys.length || !String(raw.source || "").trim()) {
      report.invalid++;
      report.issues.push({
        row: i + 2,
        reason: "缺少有效邮箱/主页，或缺少来源",
      });
      continue;
    }
    const matches = new Set(keys.map((k) => index.get(k)).filter(Boolean));
    if (matches.size > 1) {
      report.conflicts++;
      report.issues.push({
        row: i + 2,
        reason: "邮箱与主页指向不同人员，需人工复核",
      });
      continue;
    }
    if (matches.size === 1) {
      report.duplicates++;
      continue;
    }
    const l = normalize({ ...raw, id: undefined });
    leads.push(l);
    for (const k of keys) index.set(k, l);
    report.added++;
  }
  return { leads, report };
}
const tokenize = (text) =>
  (
    String(text)
      .toLowerCase()
      .match(/[a-z][a-z0-9]+/g) || []
  ).filter(
    (x) =>
      !new Set([
        "the",
        "and",
        "for",
        "with",
        "from",
        "that",
        "have",
        "was",
        "are",
        "this",
        "you",
        "your",
        "our",
        "their",
        "into",
        "can",
        "not",
      ]).has(x),
  );
// Multinomial Naive Bayes, trained on explicit synthetic examples. No API or model download.
export class SignalModel {
  constructor(samples) {
    this.vocab = new Set();
    this.classes = {
      operator: { docs: 0, total: 0, words: {} },
      general: { docs: 0, total: 0, words: {} },
    };
    for (const s of samples) {
      const c = this.classes[s.label];
      c.docs++;
      for (const w of tokenize(s.text)) {
        this.vocab.add(w);
        c.total++;
        c.words[w] = (c.words[w] || 0) + 1;
      }
    }
  }
  predict(text) {
    const words = tokenize(text).filter((w) => this.vocab.has(w)),
      scores = {};
    for (const [k, c] of Object.entries(this.classes)) {
      scores[k] = Math.log(
        c.docs / (this.classes.operator.docs + this.classes.general.docs),
      );
      for (const w of words)
        scores[k] += Math.log(
          ((c.words[w] || 0) + 1) / (c.total + this.vocab.size),
        );
    }
    const delta = Math.max(-30, Math.min(30, scores.operator - scores.general));
    const likelihood = 1 / (1 + Math.exp(-delta));
    const hints = [...new Set(words)]
      .map((w) => ({
        word: w,
        weight:
          Math.log(
            ((this.classes.operator.words[w] || 0) + 1) /
              (this.classes.operator.total + this.vocab.size),
          ) -
          Math.log(
            ((this.classes.general.words[w] || 0) + 1) /
              (this.classes.general.total + this.vocab.size),
          ),
      }))
      .sort((a, b) => b.weight - a.weight)
      .filter((w) => w.weight > 0)
      .slice(0, 4)
      .map((w) => w.word);
    return {
      label: likelihood >= 0.5 ? "operator" : "general",
      likelihood,
      hints,
      known: words.length,
    };
  }
}
export function assess(l, model) {
  const signal = model.predict(l.bio);
  const pieces = [
    [
      "US / 欧美经历自述",
      /\bUS\b|United States|America/i.test(l.markets)
        ? 25
        : /\bUK\b|\bEU\b|Europe/i.test(l.markets)
          ? 12
          : 0,
    ],
    ["运营时长 ≥ 6 个月", l.months >= 6 ? 15 : 0],
    ["Instagram / TikTok 实操", /instagram|tiktok/i.test(l.platforms) ? 15 : 0],
    ["作品可提供（自述）", l.portfolio ? 15 : 0],
    ["英文能力（自评）", Math.round(l.english * 2)],
    ["DM / 社群经验（自述）", l.community ? 5 : 0],
    ["每周可投入 ≥ 10h", l.hours >= 10 ? 5 : 0],
    [
      "本地模型经验信号",
      signal.known >= 3 ? Math.round(signal.likelihood * 10) : 0,
    ],
  ];
  const score = pieces.reduce((s, p) => s + p[1], 0),
    grade = score >= 80 ? "A" : score >= 60 ? "B" : "C";
  return {
    score,
    grade,
    signal,
    pieces,
    eligible:
      l.months >= 6 &&
      l.age18 &&
      l.us_verified &&
      l.english_verified &&
      l.task_score >= 75 &&
      l.terms,
  };
}
export function draftMessage(l, variant = "A", followup = false) {
  const platform = String(l.platforms || "social channels")
    .split(/[;,]/)[0]
    .trim();
  const evidence =
    l.months > 0
      ? `your profile mentions ${l.months} months managing ${platform}`
      : `your profile mentions ${platform}`;
  const intro = followup
    ? `One brief follow-up on the Onely operator pilot.`
    : variant === "B"
      ? `Looking for a creator-operations workflow with less repetitive work? ${evidence}.`
      : `I'm reaching out because ${evidence}${l.markets ? ` for ${l.markets} audiences` : ""}.`;
  return `Hi ${l.name.split(" ")[0]},\n\n${intro}\n\nOnely is an AI-powered creator business platform. This proposed founding-operator pilot focuses on social growth and emotional-companionship fan experiences for US audiences. Operators keep responsibility for brand voice, boundaries and quality; AI supports content and relationship workflows.\n\nWould you like the role brief and a short skills assessment? The brief must confirm workload, compensation, payment timing and pilot access before you commit. No earnings or hiring outcome is guaranteed. If this is not relevant, reply “no” and we will stop following up.\n\nThanks,\nOnely pilot recruiting team (assignment draft)`;
}
export function transition(l, next, model, now = new Date()) {
  if (["unsubscribed", "rejected"].includes(l.status))
    throw Error("该人员已停止跟进");
  const i = STAGES.indexOf(l.status);
  if (STAGES[i + 1] !== next) throw Error("请按顺序记录漏斗事件");
  if (next === "contacted" && (!l.permission || !l.draft_approved))
    throw Error("需要确认渠道允许联系，并审核文案");
  if (next === "qualified" && !assess(l, model).eligible)
    throw Error("须核验美国运营证据、英文、18+、条款，且实操测评分 ≥75");
  if (
    next === "activated" &&
    (!l.training || !l.first_task || !l.account_id.trim())
  )
    throw Error("须确认培训通过、首个任务及入驻账号记录");
  l.status = next;
  l.events.push({
    type: next,
    at: now.toISOString(),
    note: "操作员手工确认（演示）",
  });
  l.next_followup =
    next === "contacted"
      ? new Date(now.getTime() + 24 * 3600 * 1000).toISOString()
      : null;
  return l;
}
export function stopLead(l, type, now = new Date()) {
  if (!["rejected", "unsubscribed"].includes(type)) throw Error("无效停止状态");
  l.status = type;
  l.next_followup = null;
  l.draft_approved = false;
  l.events.push({
    type,
    at: now.toISOString(),
    note: "停止后不再进入触达队列",
  });
  return l;
}
export function followups(leads, now = new Date()) {
  return leads.filter(
    (l) =>
      l.status === "contacted" &&
      l.permission &&
      l.next_followup &&
      new Date(l.next_followup) <= now &&
      l.events.filter((e) => e.type === "followup").length < 1,
  );
}
export function funnel(leads) {
  return STAGES.map((stage) => ({
    stage,
    count: leads.filter(
      (l) => stage === "sourced" || l.events.some((e) => e.type === stage),
    ).length,
  }));
}
export function forecast(base, rates) {
  let value = base;
  return [
    { label: "原始线索", value },
    ...rates.map((r) => {
      value *= r.rate;
      return { label: r.label, value };
    }),
  ];
}
export function csvCell(v) {
  let s = String(v ?? "");
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
export function exportDrafts(leads) {
  const rows = leads.filter(
    (l) => l.permission && l.draft_approved && l.status === "sourced",
  );
  return [
    "name,email,source,variant,draft",
    ...rows.map((l) =>
      [l.name, l.email, l.source, l.variant, l.draft].map(csvCell).join(","),
    ),
  ].join("\r\n");
}
export function retention(leads, now = new Date()) {
  return [1, 7].map((days) => {
    const mature = leads.filter((l) => {
      const a = l.events.find((e) => e.type === "activated");
      return a && now - new Date(a.at) >= (days + 1) * 86400000;
    });
    const retained = mature.filter((l) => {
      const a = new Date(l.events.find((e) => e.type === "activated").at);
      return l.events.some(
        (e) =>
          e.type === "work" &&
          new Date(e.at) - a >= days * 86400000 &&
          new Date(e.at) - a < (days + 1) * 86400000,
      );
    });
    return { days, eligible: mature.length, retained: retained.length };
  });
}
