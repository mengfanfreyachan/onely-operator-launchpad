import {
  STAGES,
  LABELS,
  esc,
  normalize,
  SignalModel,
  assess,
  parseCSV,
  importLeads,
  draftMessage,
  transition,
  stopLead,
  followups,
  funnel,
  forecast,
  exportDrafts,
  retention,
} from "./core.js";
const $ = (s) => document.querySelector(s),
  STORE = "onely-launchpad-v1";
const [samples, seed] = await Promise.all([
  fetch("data/training.json").then((r) => r.json()),
  fetch("data/demo.json").then((r) => r.json()),
]);
const model = new SignalModel(samples);
let leads = [],
  issues = [],
  lastImport = null,
  view = "overview",
  selected = null,
  query = "",
  gradeFilter = "all",
  stageFilter = "all";
const rates = [
  { label: "可联系", rate: 0.75 },
  { label: "成功触达", rate: 0.75 },
  { label: "积极回复", rate: 0.4 },
  { label: "完成申请", rate: 0.7 },
  { label: "能力审核通过", rate: 0.6 },
  { label: "接受入驻", rate: 0.8 },
  { label: "完成激活", rate: 0.85 },
];
let forecastBase = 1600;
function makeSeed() {
  return seed.map((raw, i) => {
    const l = normalize(raw),
      idx = STAGES.indexOf(raw.demo_stage || "sourced");
    l.id = "demo-" + (i + 1);
    if (idx >= 4)
      Object.assign(l, {
        us_verified: true,
        english_verified: true,
        task_score: 84 + (i % 10),
        terms: true,
      });
    if (idx >= 6)
      Object.assign(l, {
        training: true,
        first_task: true,
        account_id: `demo-account-${i + 1}`,
      });
    l.status = STAGES[Math.max(idx, 0)];
    for (let j = 1; j <= idx; j++)
      l.events.push({
        type: STAGES[j],
        at: new Date(
          Date.now() - (idx >= 6 ? 10 : 2) * 86400000 + j * 3600000,
        ).toISOString(),
        note: "预置虚构演示事件",
      });
    if (idx === 1) {
      l.draft = draftMessage(l);
      l.draft_approved = true;
      l.next_followup = new Date(Date.now() - 3600000).toISOString();
    }
    if (idx >= 6 && i % 2 === 0) {
      const a = new Date(l.events.at(-1).at).getTime();
      l.events.push(
        {
          type: "work",
          at: new Date(a + 1.2 * 86400000).toISOString(),
          note: "虚构 D1 作业",
        },
        {
          type: "work",
          at: new Date(a + 7.2 * 86400000).toISOString(),
          note: "虚构 D7 作业",
        },
      );
    }
    return l;
  });
}
function save() {
  try {
    localStorage.setItem(
      STORE,
      JSON.stringify({ version: 1, leads, issues, lastImport }),
    );
  } catch {
    toast("浏览器存储空间不足，请先导出备份");
  }
}
function load() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORE));
    if (stored?.version === 1 && Array.isArray(stored.leads)) {
      leads = stored.leads;
      issues = stored.issues || [];
      lastImport = stored.lastImport;
      return;
    }
  } catch {}
  leads = makeSeed();
  save();
}
load();
function toast(s) {
  $("#toast").textContent = s;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast").classList.remove("show"), 3200);
}
function download(name, content, type = "text/plain") {
  const u = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
const tag = (text, cls = "") => `<span class="tag ${cls}">${esc(text)}</span>`;
const avatar = (l) =>
  `<span class="avatar c${l.id.charCodeAt(l.id.length - 1) % 4}">${esc(
    l.name
      .split(" ")
      .map((x) => x[0])
      .slice(0, 2)
      .join(""),
  )}</span>`;
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "—");
function heading(k, title, subtitle, actions = "") {
  return `<section class="page-heading"><div><div class="eyebrow">${k}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></section>`;
}
function table(rows, compact = false) {
  return `<div class="table-wrap"><table><thead><tr><th>运营人员 / 来源</th><th>市场与经验</th><th>预筛选</th><th>跟进状态</th>${compact ? "" : "<th>下步动作</th>"}</tr></thead><tbody>${
    rows
      .map((l) => {
        const a = assess(l, model);
        return `<tr data-lead="${esc(l.id)}" tabindex="0"><td><div class="person">${avatar(l)}<div><b>${esc(l.name)}</b><small>${esc(l.country)} · ${esc(l.source)}</small></div></div></td><td><b>${esc(l.markets || "待补充")}</b><small>${esc(l.platforms)} · ${l.months} 月</small></td><td>${tag(a.grade + " · " + a.score, "grade-" + a.grade)}<small>${a.eligible ? "人工核验通过" : "自述信号 · 待核验"}</small></td><td>${tag(LABELS[l.status], l.status === "activated" ? "green" : "")}<small>${l.permission ? "渠道可联系" : "待确认联系许可"}</small></td>${compact ? "" : `<td><button class="text-btn" data-open="${esc(l.id)}">${l.status === "sourced" ? "生成文案" : l.status === "applied" ? "能力审核" : l.status === "accepted" ? "完成激活" : "查看记录"} ↗</button></td>`}</tr>`;
      })
      .join("") ||
    `<tr><td colspan="5" class="empty">暂无匹配线索。可以导入文件或调整筛选。</td></tr>`
  }</tbody></table></div>`;
}
function overview() {
  const f = funnel(leads),
    active = f.at(-1).count,
    a = leads.filter((l) => assess(l, model).grade === "A").length,
    queue = followups(leads).length,
    projection = forecast(forecastBase, rates);
  return (
    heading(
      "COHORT 001 / 72-HOUR SPRINT",
      "100 位运营者，从一个清晰的漏斗开始。",
      "以美国社媒运营能力为核心，连接创作者增长与有边界的粉丝陪伴。",
      `<button class="btn" data-go="playbook">查看行动书 ↗</button><button class="btn primary" data-import>＋ 导入线索</button>`,
    ) +
    `<div class="hero-strip"><div><span class="eyebrow">NORTH STAR · 激活而非进群</span><h2>${active}<span> / 100</span></h2><p>完成审核、培训与首个任务的运营人员<br><small>以下所有人数为虚构演示记录</small></p></div><div class="hero-line"><div class="progress"><i style="width:${Math.min(100, active)}%"></i></div><div class="progress-label"><span>当前演示进度 ${active}%</span><span>72h 招募目标 100</span></div></div><div class="hero-note">START WITH PEOPLE.<br><span>SCALE WITH SYSTEMS.</span></div></div>
<div class="metrics"><article><span>唯一线索</span><strong>${leads.length}</strong><small>邮箱 / 个人主页跨渠道去重</small></article><article><span>A 级优先跟进</span><strong>${a}</strong><small>≥ 80 分 · 自述与模型信号</small></article><article><span>积极回复率</span><strong>${pct(f[2].count, f[1].count)}</strong><small>手工记录的回复 / 触达人数</small></article><article><span>到期待跟进</span><strong>${queue}<em> →</em></strong><small>24h 后提醒 · 最多一次</small></article></div>
<div class="two-col"><section class="panel"><div class="panel-title"><div><h3>漏斗的每一步，都留有记录。</h3><p>按历史事件去重计数；退订不会抹去此前触达。</p></div>${tag("演示实际记录", "outline")}</div><div class="funnel">${f.map((x, i) => `<div class="funnel-row"><span>${i === 0 ? "已收集" : LABELS[x.stage]}</span><div class="funnel-track"><i style="width:${Math.max(2, (x.count / (leads.length || 1)) * 100)}%;background:${i === 6 ? "#9bff8a" : ""}"></i></div><b>${x.count}</b><small>${i ? pct(x.count, f[i - 1].count) : "100%"}</small></div>`).join("")}</div></section>
<section class="panel"><div class="panel-title"><div><h3>哪些来源值得继续投入？</h3><p>原始来源归因，按人去重；多人协作暂未实现。</p></div></div><div class="source-list">${[
      ...new Set(leads.map((l) => l.source)),
    ]
      .map((s) => {
        const ls = leads.filter((l) => l.source === s);
        return `<div><span>${esc(s)}</span><b>${ls.length}</b><small>${ls.filter((l) => l.events.some((e) => e.type === "activated")).length} 激活</small></div>`;
      })
      .join(
        "",
      )}</div><div class="callout">下一步先复核渠道质量，再扩量。预筛选分数不能替代美国运营证据和英文实操测评。</div></section></div>
<section class="panel scenario"><div class="panel-title"><div><div class="eyebrow">PLANNING ASSUMPTIONS</div><h3>100 人，需要多大的起始线索池？</h3><p>修改任意假设，实时查看结果。无真实转化数据支持。</p></div>${tag("假设模拟 · 非执行结果", "amber")}</div><div class="assumptions"><label>原始线索<input type="number" id="base" value="${forecastBase}" min="0" max="100000"></label>${rates.map((r, i) => `<label>${r.label}<input data-rate="${i}" type="number" value="${Math.round(r.rate * 100)}" min="0" max="100"><span>%</span></label>`).join("")}</div><div class="forecast-output" id="projection"><b>${Math.floor(projection.at(-1).value + 1e-8)}</b><span>预计完成激活</span><div>${projection.map((x) => `<span>${x.label} <b>${Math.floor(x.value + 1e-8)}</b></span>`).join(" → ")}</div></div><div class="fine muted">按未取整值逐级计算，展示向下取整；上线前须先确定试点准入、佣金与收款条件，确保容量能承接 100 人。</div></section>`
  );
}
function leadsView() {
  const rows = leads.filter(
    (l) =>
      (gradeFilter === "all" || assess(l, model).grade === gradeFilter) &&
      (stageFilter === "all" || l.status === stageFilter) &&
      `${l.name} ${l.source} ${l.country} ${l.platforms}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    heading(
      "SOURCE → DEDUPE → SCORE",
      "线索多一点，重复工作少一点。",
      "先看来源与能力证据，再决定谁值得优先跟进。",
      `<button class="btn" id="blank-template">空白 CSV 模板 ↓</button><button class="btn primary" data-import>＋ 导入线索</button>`,
    ) +
    `${lastImport ? `<div class="import-summary"><b>最近一次导入 ${lastImport.total} 行</b><span>新增 ${lastImport.added}</span><span>重复 ${lastImport.duplicates}</span><span>无效 ${lastImport.invalid}</span><span>身份冲突 ${lastImport.conflicts}</span></div>` : ""}<section class="panel no-pad"><div class="filters"><label><input id="search" type="search" placeholder="搜索姓名、来源、地区或平台" value="${esc(query)}"></label><select id="grade-filter"><option value="all">所有分级</option>${["A", "B", "C"].map((g) => `<option ${gradeFilter === g ? "selected" : ""}>${g}</option>`).join("")}</select><select id="stage-filter"><option value="all">所有阶段</option>${Object.entries(
      LABELS,
    )
      .map(
        ([k, v]) =>
          `<option value="${k}" ${stageFilter === k ? "selected" : ""}>${v}</option>`,
      )
      .join(
        "",
      )}</select><span>${rows.length} / ${leads.length} 人</span></div>${table(rows)}</section>${issues.length ? `<section class="panel"><h3>导入待复核 / 无效记录</h3>${issues.map((i) => `<p class="fine">第 ${i.row} 行：${esc(i.reason)}</p>`).join("")}<p class="muted fine">修正原始文件后再次导入。冲突记录尚未计入唯一线索。</p></section>` : ""}`
  );
}
function outreachView() {
  const due = followups(leads),
    ready = leads.filter(
      (l) => l.status === "sourced" && l.permission && l.draft_approved,
    );
  return (
    heading(
      "PERSONALIZE → REVIEW → FOLLOW UP",
      "把每次触达，写成有根据的邀请。",
      "引用资料中的真实字段；不虚构业绩、不承诺收入。发送与回复由操作员记录。",
      `<button class="btn" id="export-drafts">导出已审核文案 ↓</button><button class="btn primary" id="batch-drafts">为 A / B 级批量起草</button>`,
    ) +
    `<div class="metrics"><article><span>可导出首触达文案</span><strong>${ready.length}</strong><small>渠道允许 + 人工审核 + 尚未触达</small></article><article><span>需要文案审核</span><strong>${leads.filter((l) => l.draft && !l.draft_approved && l.status === "sourced").length}</strong><small>模板生成不代表可以自动发送</small></article><article><span>24h 到期提醒</span><strong>${due.length}</strong><small>已回复 / 退订自动退出队列</small></article><article><span>已停止联系</span><strong>${leads.filter((l) => ["unsubscribed", "rejected"].includes(l.status)).length}</strong><small>停止状态不可继续推进</small></article></div>
<div class="two-col"><section class="panel"><div class="panel-title"><div><h3>两种开场，一个清楚的下一步。</h3><p>A：经验关联；B：减少重复操作。版本记录可供后续实验。</p></div></div><div class="message-preview"><span class="eyebrow">VARIANT A · EXPERIENCE FIRST</span><p>“Your profile mentions managing Instagram for US audiences…”</p><span class="eyebrow">VARIANT B · WORKFLOW FIRST</span><p>“Looking for a creator-operations workflow with less repetitive work?”</p></div><div class="callout">邀请内容需说明：情感陪伴的工作范围、审核要求、培训和下一步；薪酬及付款条件确认后再执行正式招募。</div></section><section class="panel"><h3>到期跟进队列</h3><p class="muted">初次触达 24h 后提示；最多一次补充。这里只生成文案和记录事件。</p>${due.map((l) => `<div class="queue-row">${avatar(l)}<div><b>${esc(l.name)}</b><small>${esc(l.source)} · 等待回复</small></div><button class="btn small" data-open="${esc(l.id)}">处理 ↗</button></div>`).join("") || '<div class="empty">暂无到期跟进</div>'}</section></div>
<section class="panel no-pad"><div class="panel-title padded"><div><h3>文案准备与触达记录</h3><p>点击人员，审核文案并记录下一步。</p></div></div>${table(leads.filter((l) => !["rejected", "unsubscribed"].includes(l.status)))}</section>`
  );
}
function cohortView() {
  const cohort = leads.filter((l) =>
      ["qualified", "accepted", "activated"].includes(l.status),
    ),
    ret = retention(leads);
  return (
    heading(
      "VERIFY → TRAIN → ACTIVATE",
      "进入群聊，只是开始。",
      "每 25 人一个小组。让审核、培训、首任务和持续活跃都可以追踪。",
    ) +
    `<div class="metrics"><article><span>已通过能力审核</span><strong>${cohort.length}</strong><small>美国运营证据 + 英文 + 测评</small></article><article><span>已接受入驻</span><strong>${cohort.filter((l) => l.events.some((e) => e.type === "accepted")).length}</strong><small>条款、角色和工作范围确认</small></article>${ret.map((r) => `<article><span>D${r.days} 任务留存</span><strong>${r.eligible ? pct(r.retained, r.eligible) : "—"}</strong><small>${r.retained} / ${r.eligible} 人 · 仅成熟观察窗口</small></article>`).join("")}</div>
<div class="three-col"><section class="panel step-card"><span class="step-num">01</span><h3>能力审核</h3><p>验证 US 账号运营证据；英文回复与文化语境；30 分钟实操 ≥75 分。</p>${tag("人工确认门槛", "outline")}</section><section class="panel step-card"><span class="step-num">02</span><h3>异步培训</h3><p>产品与身份披露、内容生产、DM 边界、数据记录。录播 + 8 题测验。</p>${tag("Discord 方案 · 未接 Bot", "amber")}</section><section class="panel step-card"><span class="step-num">03</span><h3>首个任务与激活</h3><p>提交 US 内容计划与 3 条粉丝回复；审核通过后激活，并记录账号 ID。</p>${tag("原型可记录检查项", "green")}</section></div>
<section class="panel no-pad"><div class="panel-title padded"><div><h3>Founding operators · 成员工作台</h3><p>群角色和课程任务为方案；下列审核 / 首任务 / 留存事件可实际记录。</p></div></div>${table(cohort)}</section><section class="panel"><h3>规模化管理，不靠 100 个私聊。</h3><div class="channel-grid"><div><b>#start-here</b><p>统一须知、补偿规则、入驻清单。</p></div><div><b>#training-library</b><p>按角色分课程，测验后解锁。</p></div><div><b>#cohort-01…04</b><p>4 × 25 人；组长与固定答疑。</p></div><div><b>#wins-and-feedback</b><p>质量案例、D1/D7 反馈与推荐。</p></div></div><p class="muted fine">Telegram 作为自选通知入口；Discord 为课程和协作主阵地。Bot 不可主动联系未启动会话的用户。成员身份、权限、自动同步和发薪未实现。</p></section>`
  );
}
function playbook() {
  return (
    heading(
      "72 HOURS / 100 QUALIFIED OPERATORS",
      "快，建立在可信的渠道和可兑现的机会之上。",
      "以下是可执行的招募设计；伙伴响应、触达量、转化率与预算均需真实试跑验证。",
      `<a href="docs/GROWTH_PLAN.md" target="_blank" class="btn primary">完整增长方案 ↗</a>`,
    ) +
    `<section class="strategy-hero"><div class="eyebrow">THE WEDGE</div><h2>从“为别人运营账号”，<br>到“用一套系统经营粉丝关系”。</h2><p>给有欧美创作者经验的运营者一个清楚的试点机会：AI 辅助内容和互动，运营者负责美国语境、质量与边界。补偿、平台访问和商业条件须在正式招募前确认。</p></section>
<div class="three-col"><section class="panel day-card"><span class="eyebrow">DAY 01 · 0—24H</span><h3>渠道验证 / 种子线索</h3><ul><li>接洽 40 家 VA / 创作者运营机构。</li><li>联系 12 位社群管理员，争取批准的招募帖。</li><li>200 人小批试跑，核实 US 能力与积极回复。</li><li>原始线索目标：600；累计首触达：300。</li></ul><div class="callout">24h 决策：伙伴不响应或积极回复 <20%，重估 100 人目标。</div></section><section class="panel day-card"><span class="eyebrow">DAY 02 · 24—48H</span><h3>扩量 / 实操测评</h3><ul><li>复制表现最好的两类渠道。</li><li>滚动申请、英文与实操审核。</li><li>两场培训，菲律宾 / 尼日利亚时区友好。</li><li>原始线索累计 1,200；首触达累计 650。</li></ul><div class="callout">若积极回复累计不足 200，优先追加温热推荐并更新预测。</div></section><section class="panel day-card"><span class="eyebrow">DAY 03 · 48—72H</span><h3>激活 / 首次留存</h3><ul><li>线索累计 1,600；首触达累计 900。</li><li>申请目标 252，审核通过目标 151。</li><li>入驻目标 120，完成激活预计 102。</li><li>核实 100 个唯一账号与首任务记录。</li></ul><div class="callout">D1 目标 ≥70%、D7 ≥50% 为后续验证指标；72h 无法验证 D7。</div></section></div>
<section class="panel"><div class="panel-title"><div><h3>渠道组合与获取方式</h3><p>国家用于寻找渠道和安排时间；不参与能力评分。</p></div>${tag("规模为计划量", "amber")}</div><div class="channel-grid"><div><b>400 · 伙伴转介绍</b><p>机构管理员邀请现有 US creator operators 自愿申请；10 个伙伴 × 40 人为假设。</p></div><div><b>500 · 社群自愿报名</b><p>菲律宾 VA / OFM / creator ops，尼日利亚远程营销群；管理员批准的公开帖和表单。</p></div><div><b>350 · 人才平台检索</b><p>OnlineJobs.ph / Upwork，按平台许可联系。免费账户和付费额度限制纳入预算。</p></div><div><b>350 · 内容与推荐入站</b><p>岗位说明、运营演示、现有运营者推荐；200 位有效申请者各 1.75 个推荐是假设。</p></div></div></section>
<div class="two-col"><section class="panel"><h3>已实现</h3><ul class="check-list"><li>CSV / JSON 导入、身份去重与冲突报告</li><li>本地朴素贝叶斯经验信号 + 可解释分级</li><li>个性化模板、人工审核和首触达 CSV 导出</li><li>状态门槛、退订抑制、24h 跟进与事件统计</li><li>入驻检查、任务记录、成熟窗口留存</li><li>情景预测、浏览器持久化与备份</li></ul></section><section class="panel"><h3>仍需验证 / 尚未实现</h3><ul><li>100 人目标、渠道容量与转化率。</li><li>大模型语义评分 / 自由生成文案。</li><li>真实发送、投递回执、自动获取申请。</li><li>Onely API、Discord / Telegram Bot 与发薪。</li><li>多用户数据库、认证与生产权限。</li><li>效率节省与留存目标，尚无真实运营测量。</li></ul></section></div>`
  );
}
const pages = {
  overview,
  leads: leadsView,
  outreach: outreachView,
  cohort: cohortView,
  playbook,
};
function render() {
  $("#content").innerHTML = pages[view]();
  $("#view-label").textContent = {
    overview: "增长总览",
    leads: "线索工作台",
    outreach: "触达与跟进",
    cohort: "入驻与培训",
    playbook: "72 小时行动书",
  }[view];
  document
    .querySelectorAll("#nav button")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === view));
}
function go(v) {
  view = v;
  location.hash = v;
  render();
  window.scrollTo(0, 0);
}
function openLead(id) {
  selected = id;
  detail();
  if (!$("#drawer").open) $("#drawer").showModal();
}
function detail() {
  const l = leads.find((x) => x.id === selected);
  if (!l) return;
  const a = assess(l, model),
    idx = STAGES.indexOf(l.status),
    next = STAGES[idx + 1],
    stopped = ["unsubscribed", "rejected"].includes(l.status),
    due = followups(leads).some((x) => x.id === l.id);
  $("#detail").innerHTML =
    `<button class="close" id="close-drawer" aria-label="关闭">×</button><div class="eyebrow">OPERATOR PROFILE · ${esc(l.id)}</div><div class="detail-person">${avatar(l)}<div><h2>${esc(l.name)}</h2><p>${esc(l.country)} / ${esc(l.source)}</p></div></div><div class="detail-tags">${tag(a.grade + " · " + a.score, "grade-" + a.grade)}${tag(LABELS[l.status])}${tag(a.eligible ? "人工核验通过" : "能力待核验", a.eligible ? "green" : "amber")}</div><div class="bio">${esc(l.bio)}</div><div class="mini-facts"><div>邮箱<b>${esc(l.email || "未提供")}</b></div><div>US / 欧美市场<b>${esc(l.markets || "未提供")}</b></div><div>运营经验<b>${l.months} 个月 · ${l.hours}h / 周</b></div><div>主要平台<b>${esc(l.platforms || "未提供")}</b></div></div>
<details class="score-detail"><summary>查看分级依据 · ${a.score} / 100</summary>${a.pieces.map(([k, v]) => `<div><span>${esc(k)}</span><b>${v}</b></div>`).join("")}<p>本地模型：${a.signal.label === "operator" ? "更接近运营经历" : "更接近泛化简介"}。信号词 ${esc(a.signal.hints.join(", ") || "不足")}。24 条虚构训练文本，未经真实验证，模型输出不是能力概率。</p></details>
<section class="detail-section"><div class="panel-title"><h3>个性化触达草稿</h3>${tag("字段模板 · 非 LLM", "outline")}</div><div class="draft-actions"><button class="btn small" id="draft-a" ${stopped ? "disabled" : ""}>生成 A 版</button><button class="btn small" id="draft-b" ${stopped ? "disabled" : ""}>生成 B 版</button><button class="btn small" id="draft-followup" ${!due ? "disabled" : ""}>生成一次跟进</button></div><textarea id="draft-text" rows="9" ${stopped ? "disabled" : ""} placeholder="点击生成文案，核实事实后修改。">${esc(l.draft)}</textarea><label class="checkbox"><input type="checkbox" id="permission" ${l.permission ? "checked" : ""} ${stopped ? "disabled" : ""}> 已确认此来源允许联系 / 已获自愿报名</label><label class="checkbox"><input type="checkbox" id="approval" ${l.draft_approved ? "checked" : ""} ${stopped ? "disabled" : ""}> 已人工审核文案事实、试点条件与 CTA</label><div class="draft-actions"><button class="btn" id="save-draft" ${stopped ? "disabled" : ""}>保存草稿与审核</button><button class="btn" id="copy-draft">复制文案</button>${due ? '<button class="btn" id="log-followup">记录已跟进</button>' : ""}</div><p class="muted fine">保存、复制和导出不会发送消息。渠道没有联系权限时，不可记录首触达。</p></section>
<section class="detail-section"><h3>能力审核与入驻清单</h3><p class="muted fine">能力字段在“已申请”阶段可修改；培训字段在“已接受入驻”阶段可修改。审核事件为演示人员手工确认。</p><div class="check-grid">${[
      ["us_verified", "核验美国创作者账号运营证据"],
      ["english_verified", "英文与美国语境测试通过"],
      ["age18", "确认年满 18 岁"],
      ["terms", "工作范围、补偿及条款已确认"],
      ["training", "培训与知识测验通过"],
      ["first_task", "首个任务审核通过"],
    ]
      .map(([k, t]) => {
        const allow = ["training", "first_task"].includes(k)
          ? l.status === "accepted"
          : l.status === "applied";
        return `<label class="checkbox"><input data-check="${k}" type="checkbox" ${l[k] ? "checked" : ""} ${allow ? "" : "disabled"}>${t}</label>`;
      })
      .join(
        "",
      )}</div><div class="check-inputs"><label>实操评分 / 100<input id="task-score" type="number" min="0" max="100" value="${l.task_score}" ${l.status === "applied" ? "" : "disabled"}></label><label>入驻账号 ID（人工记录）<input id="account-id" value="${esc(l.account_id)}" ${l.status === "accepted" ? "" : "disabled"}></label></div><button class="btn" id="save-checks" ${!["applied", "accepted"].includes(l.status) ? "disabled" : ""}>保存核验记录</button></section>
<section class="detail-section"><h3>下一步与活动记录</h3><div class="draft-actions">${next && !stopped ? `<button class="btn primary" id="next-stage">确认：${LABELS[next]} →</button>` : ""}${l.status === "activated" ? '<button class="btn primary" id="record-work">记录今日合格任务</button>' : ""}<button class="btn" id="unsubscribe" ${stopped ? "disabled" : ""}>退订 / 停止联系</button><button class="btn danger" id="reject" ${stopped ? "disabled" : ""}>未通过</button></div><ol class="timeline">${
      [...l.events]
        .reverse()
        .map(
          (e) =>
            `<li><b>${esc(LABELS[e.type] || { followup: "补充跟进", work: "合格任务", checks: "能力 / 培训检查更新" }[e.type] || e.type)}</b><small>${new Date(e.at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} · ${esc(e.note || "手工确认")}</small></li>`,
        )
        .join("") || "<li>新线索，尚未发生触达。</li>"
    }</ol></section>`;
  $("#close-drawer").onclick = () => $("#drawer").close();
  const persist = () => {
    save();
    detail();
    render();
  };
  const generate = (variant, followup = false) => {
    l.variant = variant;
    l.draft = draftMessage(l, variant, followup);
    l.draft_approved = false;
    l.draft_kind = followup ? "followup" : "initial";
    persist();
    toast("已生成字段模板，请人工审核");
  };
  $("#draft-a").onclick = () => generate("A");
  $("#draft-b").onclick = () => generate("B");
  $("#draft-followup").onclick = () => generate(l.variant, true);
  $("#draft-text").oninput = () => {
    $("#approval").checked = false;
  };
  $("#save-draft").onclick = () => {
    l.draft = $("#draft-text").value;
    l.permission = $("#permission").checked;
    l.draft_approved = $("#approval").checked && !!l.draft.trim();
    persist();
    toast("草稿和审核已保存；未发送");
  };
  $("#copy-draft").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("#draft-text").value);
      toast("已复制文案");
    } catch {
      toast("请在文本框中全选复制");
    }
  };
  $("#save-checks").onclick = () => {
    document
      .querySelectorAll("[data-check]:not(:disabled)")
      .forEach((c) => (l[c.dataset.check] = c.checked));
    if (l.status === "applied")
      l.task_score = Math.max(
        0,
        Math.min(100, Number($("#task-score").value) || 0),
      );
    if (l.status === "accepted")
      l.account_id = $("#account-id").value.trim().slice(0, 160);
    l.events.push({
      type: "checks",
      at: new Date().toISOString(),
      note: "操作员手工确认；未接外部验证",
    });
    persist();
    toast("核验已保存");
  };
  if ($("#next-stage"))
    $("#next-stage").onclick = () => {
      try {
        transition(l, next, model);
        persist();
        toast(`已记录 ${LABELS[next]}（手工演示）`);
      } catch (e) {
        toast(e.message);
      }
    };
  if ($("#log-followup"))
    $("#log-followup").onclick = () => {
      if (!l.draft_approved || l.draft_kind !== "followup") {
        toast("请生成跟进文案并保存审核");
        return;
      }
      if (!followups(leads).includes(l)) {
        toast("不在可跟进队列");
        return;
      }
      l.events.push({
        type: "followup",
        at: new Date().toISOString(),
        note: "人工确认发送（演示）",
      });
      l.next_followup = null;
      persist();
      toast("已记录一次跟进；后续不再提醒");
    };
  if ($("#record-work"))
    $("#record-work").onclick = () => {
      l.events.push({
        type: "work",
        at: new Date().toISOString(),
        note: "操作员确认今日任务合格（演示）",
      });
      persist();
      toast("今日任务已记录；留存仅在观察窗口成熟后统计");
    };
  $("#unsubscribe").onclick = () => {
    stopLead(l, "unsubscribed");
    persist();
    toast("已停止联系并退出所有触达队列");
  };
  $("#reject").onclick = () => {
    stopLead(l, "rejected");
    persist();
    toast("已记录未通过");
  };
}
function doImport(rows) {
  if (!Array.isArray(rows) || rows.length > 10000)
    throw Error("需要数组格式，单次最多 10,000 行");
  if (rows.some((r) => !r || typeof r !== "object" || Array.isArray(r)))
    throw Error("每一行必须是对象");
  const r = importLeads(leads, rows);
  leads = r.leads;
  lastImport = r.report;
  issues = r.report.issues;
  save();
  render();
  $("#import-result").innerHTML =
    `<div class="result-grid"><div><strong>${r.report.added}</strong>新增</div><div><strong>${r.report.duplicates}</strong>重复</div><div><strong>${r.report.invalid}</strong>无效</div><div><strong>${r.report.conflicts}</strong>冲突待复核</div></div><p class="fine">读取 ${rows.length} 行；唯一线索现为 ${leads.length} 人。再次导入同一文件不会新增人员。</p>`;
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button,a,tr");
  if (!b) return;
  if (b.dataset.view) go(b.dataset.view);
  if (b.dataset.go) go(b.dataset.go);
  if (b.hasAttribute("data-import")) {
    $("#import-result").innerHTML = "";
    $("#import-dialog").showModal();
  }
  if (b.dataset.lead) openLead(b.dataset.lead);
  if (b.dataset.open) openLead(b.dataset.open);
  if (b.id === "batch-drafts") {
    let count = 0;
    for (const l of leads)
      if (l.status === "sourced" && assess(l, model).grade !== "C") {
        l.draft = draftMessage(l, l.variant);
        l.draft_approved = false;
        l.draft_kind = "initial";
        count++;
      }
    save();
    render();
    toast(`已生成 ${count} 条草稿，请逐条审核`);
  }
  if (b.id === "export-drafts") {
    download(
      "reviewed-outreach.csv",
      exportDrafts(leads),
      "text/csv;charset=utf-8",
    );
    toast("已导出允许联系且审核通过的待触达文案");
  }
  if (b.id === "blank-template")
    download(
      "leads-template.csv",
      "name,email,profile_url,source,country,timezone,bio,months,platforms,markets,english,hours,portfolio,community,age18,permission\r\n",
      "text/csv",
    );
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches("tr[data-lead]"))
    openLead(e.target.dataset.lead);
});
document.addEventListener("input", (e) => {
  if (e.target.id === "search") {
    query = e.target.value;
    const pos = e.target.selectionStart;
    render();
    $("#search").focus();
    $("#search").setSelectionRange(pos, pos);
  }
  if (e.target.id === "base" || e.target.hasAttribute("data-rate")) {
    if (e.target.id === "base")
      forecastBase = Math.max(0, Math.min(100000, Number(e.target.value) || 0));
    else
      rates[Number(e.target.dataset.rate)].rate = Math.max(
        0,
        Math.min(1, Number(e.target.value) / 100 || 0),
      );
    const p = forecast(forecastBase, rates);
    $("#projection").innerHTML =
      `<b>${Math.floor(p.at(-1).value + 1e-8)}</b><span>预计完成激活</span><div>${p.map((x) => `<span>${x.label} <b>${Math.floor(x.value + 1e-8)}</b></span>`).join(" → ")}</div>`;
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "grade-filter") {
    gradeFilter = e.target.value;
    render();
  }
  if (e.target.id === "stage-filter") {
    stageFilter = e.target.value;
    render();
  }
});
$("#upload").onchange = async (e) => {
  try {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) throw Error("文件过大，最多 10 MB");
    const text = await f.text();
    doImport(f.name.endsWith(".json") ? JSON.parse(text) : parseCSV(text));
  } catch (err) {
    $("#import-result").textContent = err.message;
  }
  e.target.value = "";
};
$("#import-fixture").onclick = async () => {
  try {
    doImport(
      parseCSV(await fetch("data/import-example.csv").then((r) => r.text())),
    );
  } catch (e) {
    $("#import-result").textContent = e.message;
  }
};
$("#export-json").onclick = () =>
  download(
    "onely-local-backup.json",
    JSON.stringify({ version: 1, leads, issues, lastImport }, null, 2),
    "application/json",
  );
$("#reset").onclick = () => {
  if (confirm("重置当前浏览器中的演示数据？请先备份需要保留的记录。")) {
    leads = makeSeed();
    issues = [];
    lastImport = null;
    save();
    render();
    toast("已恢复虚构演示数据");
  }
};
const hash = location.hash.slice(1);
if (pages[hash]) view = hash;
render();
window.addEventListener("hashchange", () => {
  const v = location.hash.slice(1);
  if (pages[v]) {
    view = v;
    render();
  }
});
