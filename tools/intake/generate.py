#!/usr/bin/env python3
"""Bloom customer intake template — single source of truth.

Generates (relative to the repo root):
  - templates/customer-intake/*.csv  (one CSV per sheet: 7 customer + field map)
  - templates/customer-intake.xlsx   (8 sheets: 7 customer-facing + internal field map)
  - templates/customer-intake/README.md (filling instructions, bilingual)

Every customer-facing row carries: bilingual field name, instructions,
example, and a required flag. The internal field map is derived from the
same rows, so workbook/xlsx/CSV/map can never drift apart.
"""
import csv
import os

# Agent abbreviations used in the field map.
RI, ICP, LEAD, OUTREACH, CONV, AD, CFG = (
    "Revenue Intelligence", "ICP", "Lead", "Outreach", "Conversion", "Ad", "配置/运行时",
)

# ---------------------------------------------------------------- instructions
INSTR_ROWS = [
    ["0.1", "本表用途 Purpose",
     "本调查表用于为您定制 Bloom Agent 工作流（v1.0 单租户部署）。您填写的每一项都会进入工作流配置（每次修改均有版本记录与审计日志）。 "
     "This workbook customizes your Bloom Agent workflow (single-tenant v1.0 deployment). Every answer feeds your workflow config, which is versioned and audit-logged."],
    ["0.2", "如何填写 How to fill",
     "逐行填写最右侧“客户填写”列。所有字段均附有填写说明与示例，无需参加培训即可独立完成；不确定的项填“不确定”，我们会在定制访谈中跟进。 "
     "Fill the rightmost \"Your Answer\" column row by row. Every field has instructions and an example — no workshop needed. Write 不确定 (unsure) where applicable and we will follow up."],
    ["0.3", "必填与选填 Required vs optional",
     "“是否必填”列标注了必填（必填）与选填（选填）。必填项缺失会导致配置无法编译——编译器会准确指出缺失的表与字段。 "
     "The \"Required\" column marks 必填 (required) / 选填 (optional). A missing required field blocks config compilation — the compiler names the exact sheet and field."],
    ["0.4", "填写语言 Language",
     "可用中文或英文填写，报告语言在 Sheet 07 单独选择。 "
     "Answer in Chinese or English; report language is chosen separately in Sheet 07."],
    ["0.5", "保密承诺 Confidentiality",
     "所有信息仅用于为您定制 Bloom 工作流，按服务合同保密承诺处理；您的数据保存在您的专属部署中，不与其他客户混用。 "
     "All information is used solely to customize your Bloom workflow, under the NDA in the service contract. Your data lives in your dedicated deployment, never commingled."],
    ["0.6", "回传方式 Return",
     "填写完成后将本表回传给 Bloom 团队（xlsx 或 CSV 均可）。我们将其转换为 intake.json 并生成您的工作流配置初稿，供您审批后生效。 "
     "Return the completed workbook (xlsx or CSV) to the Bloom team. We compile it into intake.json, draft your workflow config, and activate it after your approval."],
    ["0.7", "版本与变更 Versioning",
     "每次配置变更均有版本记录；您后续补充或修改本表时，我们以新版本生效，历史版本可追溯。 "
     "Every config change is versioned. Later edits to this workbook take effect as a new version; history remains auditable."],
    ["0.8", "审批安全 Approval gates",
     "邮件发送、CRM 写入、大额导出等高风险操作永远不会在无人工审批的情况下执行——这是平台硬性约束，不可关闭。 "
     "High-risk actions (email send, CRM write, large export) are never executed without a recorded human approval — a hard platform invariant that cannot be switched off."],
    ["0.9", "咨询 Contact",
     "填写中遇到问题，请联系您的 Bloom 对接人。 "
     "For questions, contact your Bloom point of contact."],
]

# ---------------------------------------------------------------- customer sheets
COLUMNS = ["序号 No.", "字段 Field", "填写说明 Instructions", "示例 Example", "是否必填 Required", "客户填写 Your Answer"]
REQUIRED, OPTIONAL = "必填 Required", "选填 Optional"

# Each row: (id, field, instructions, example, required, intake_key, config_keys, agent, note)
# config_keys: semicolon-separated workflow-config keys this answer feeds.
S1 = ("01_公司概况", "Company Profile", [
    ("1.1", "公司名称 Company legal name", "营业执照或注册文件上的公司全称。", "深圳市某某精密制造有限公司 / ABC Precision Manufacturing Co., Ltd.", REQUIRED,
     "company.name", "knowledge_base; market_intel.seed", CFG, "市场地图与知识库种子。"),
    ("1.2", "品牌/常用名 Brand / trading name", "客户更熟悉的品牌名或缩写；无则填公司名。", "BloomTech", OPTIONAL,
     "company.brand", "knowledge_base", CFG, ""),
    ("1.3", "官网 Website", "以 http(s):// 开头的主域名。", "https://example.com", REQUIRED,
     "company.website", "knowledge_base; market_intel.seed", RI, ""),
    ("1.4", "公司性质 Business type", "制造商 / 批发商 / 品牌商 / 贸易商，可多选。", "制造商 + 出口贸易商", REQUIRED,
     "company.businessType", "icp.scoringTuning", ICP, "影响潜客匹配口径。"),
    ("1.5", "总部地址 HQ address", "城市 + 国家即可；多址请分行。", "中国深圳市南山区", REQUIRED,
     "company.hqAddress", "knowledge_base", CFG, ""),
    ("1.6", "仓库/分支机构 Warehouses / branches", "海外仓、办事处及所在城市。", "美国洛杉矶仓（Los Angeles, CA）", OPTIONAL,
     "company.branches", "knowledge_base", CFG, ""),
    ("1.7", "联系电话/邮箱 Contact phone / email", "用于报告与审批通知的联系方式，可多个。", "sales@example.com; +86-755-8888-0000", OPTIONAL,
     "company.contacts", "delivery.contactRouting", CFG, ""),
    ("1.8", "成立年份 Year founded", "四位年份。", "2012", OPTIONAL,
     "company.yearFounded", "knowledge_base", CFG, ""),
    ("1.9", "员工人数 Employee count", "区间即可，如 50–100。", "50–100", OPTIONAL,
     "company.employeeCount", "knowledge_base", CFG, ""),
    ("1.10", "年营收区间 Annual revenue band", "区间即可，可注币种。", "USD 10–30M", OPTIONAL,
     "company.revenueBand", "knowledge_base", CFG, ""),
    ("1.11", "出口经验 Export history", "出口年数 + 已出口国家/地区数量，附主要国别更佳。", "8 年，出口 12 国（美/德/日为主）", REQUIRED,
     "company.exportHistory", "market_intel.seed; regional_analysis", RI, ""),
    ("1.12", "现有市场 Current markets", "目前有销售的国家/地区，可按占比排序。", "美国 60%、德国 25%、日本 15%", REQUIRED,
     "company.currentMarkets", "market_intel.seed; market_map", RI, ""),
    ("1.13", "销售渠道 Sales channels", "官网 / Amazon / 批发目录 / 展会 / 销售团队 / 代理等。", "官网商城、阿里巴巴国际站、展会", OPTIONAL,
     "company.salesChannels", "market_map; outreach.channelPlan", OUTREACH, ""),
    ("1.14", "现有系统 Existing systems", "在用的 CRM、邮件营销、ERP、客服系统及名称。", "HubSpot、Mailchimp、金蝶", REQUIRED,
     "company.systems", "crm.adapter; outreach.emailAdapter", CFG, "CRM 写入适配器按此配置。"),
    ("1.15", "主要痛点 Main pain points", "如潜客获取成本高、复购低、报价响应慢、对海外市场判断不准等。", "海外潜客获取成本高，询盘转化率低", OPTIONAL,
     "company.painPoints", "market_intel.focus", RI, ""),
    ("1.16", "今年增长目标 Growth goals", "量化目标更佳（新增市场、营收、线索量）。", "新增 2 个欧洲市场，月询盘 +30%", OPTIONAL,
     "company.growthGoals", "market_intel.focus", RI, ""),
])

S2 = ("02_产品线与出口", "Product Lines & Export", [
    ("2.1", "产品大类 Product categories", "按大类列出，每行一类；含主要规格区间。", "工业阀门（DN50–DN300）", REQUIRED,
     "products.categories", "icp.scoringTuning; market_map", ICP, "产品匹配评分的依据。"),
    ("2.2", "HS 编码（如已知）HS codes", "8–10 位 HS 编码，多个用分号分隔；未知可留空。", "8481.80；8481.90", OPTIONAL,
     "products.hsCodes", "purchase_signals.queryTerms", RI, "用于采购信号扫描的精确匹配。"),
    ("2.3", "认证 Certifications", "CE / FDA / UL / ISO 等及适用产品线。", "CE、ISO 9001（全线）；FDA（食品级线）", OPTIONAL,
     "products.certifications", "icp.scoringTuning; lead.enrichment", LEAD, ""),
    ("2.4", "价格带 Price band", "出厂价 / 批发价区间及币种。", "USD 5–80 / 件 FOB 深圳", OPTIONAL,
     "products.priceBand", "icp.scoringTuning", ICP, ""),
    ("2.5", "起订量 MOQ posture", "常规 MOQ 与可协商空间。", "MOQ 500 件，样品单可放宽", OPTIONAL,
     "products.moq", "icp.scoringTuning; lead.enrichment", LEAD, "决定潜客规模门槛。"),
    ("2.6", "定制能力 / OEM Customization / OEM", "是否支持客户自有品牌贴牌及定制程度。", "支持 OEM/ODM，起订 1000 件", OPTIONAL,
     "products.customization", "icp.scoringTuning; outreach.talkingPoints", OUTREACH, ""),
    ("2.7", "生产/供应链位置 Production & supply chain", "自有工厂所在地或主要代工来源。", "自有工厂（东莞）+ 2 家代工厂", OPTIONAL,
     "products.productionLocation", "knowledge_base", CFG, ""),
    ("2.8", "出口物流方式 Export logistics", "自发货 / 第三方仓 / 头程方式及主要港口。", "海运整柜为主，盐田港出发", OPTIONAL,
     "products.logistics", "knowledge_base", CFG, ""),
    ("2.9", "季节性 Seasonality", "旺季月份及原因（展会季、节假日等）。", "3–5 月、9–11 月（展会季）", OPTIONAL,
     "products.seasonality", "purchase_signals.schedule", RI, "信号扫描与简报节奏参考。"),
    ("2.10", "明星单品 / 主推方向 Hero products / focus", "本年度主推的产品线或单品。", "节能型阀门执行器", OPTIONAL,
     "products.heroProducts", "outreach.talkingPoints; market_map", OUTREACH, ""),
])

S3 = ("03_目标行业与区域", "Target Industries & Regions", [
    ("3.1", "目标行业（按优先级）Target industries (ranked)", "1 为最优先，逐行填写；不超过 5 个。", "1. 食品加工 2. 化工 3. 水处理", REQUIRED,
     "markets.industries", "market_map; lead.discovery; regional_analysis", RI, "市场地图与线索发现的范围依据。"),
    ("3.2", "重点区域（排名）Priority regions (ranked)", "国家/州/都会区均可，按优先级排序。", "1. 美国德州 2. 德国巴伐利亚 3. 越南", REQUIRED,
     "markets.regions", "market_map; purchase_signals.scope; regional_analysis", RI, "扫描与区域分析的地理范围。"),
    ("3.3", "目标客户规模 Target customer size", "如批发大客户 / 中型代理 / 终端工厂，附规模量化更佳。", "年采购额 USD 1M+ 的进口批发商", OPTIONAL,
     "markets.customerSize", "icp.scoringTuning", ICP, ""),
    ("3.4", "区域扩展计划 Expansion plan", "未来 12 个月想新进的区域。", "墨西哥、波兰", OPTIONAL,
     "markets.expansionPlan", "regional_analysis; market_intel.focus", RI, ""),
    ("3.5", "客户决策角色 Decision roles", "对方公司内谁拍板、谁影响：职位名称。", "采购总监、进口经理、老板/总经理", OPTIONAL,
     "markets.decisionRoles", "icp.scoringTuning; lead.contactRoles", LEAD, ""),
    ("3.6", "不服务的行业/客户 Exclusions", "明确排除的行业、客户类型或区域。", "不接个人零售客户；不做医疗器械", REQUIRED,
     "markets.exclusions", "lead.discovery.filters; purchase_signals.filters", LEAD, "硬性过滤条件。"),
    ("3.7", "区域分析维度 Regional analysis dimensions", "Lead Generation Pro 区域分析希望按什么维度（州/城市/展会/港口等）。", "按美国州 + 前 20 大都会区", OPTIONAL,
     "markets.regionalAnalysisDimensions", "regional_analysis.dimensions", RI, "模块 G（区域分析）配置。"),
])

S4 = ("04_竞争对手清单", "Competitor List", [
    ("4.1", "竞争对手 1 Competitor 1", "公司名 + 网站；建议同时给出您对其的定位（贵/我方优劣势）。", "XYZ Trading — xyztrading.com", REQUIRED,
     "competitors.list[0]", "competitor_tracking; market_map", RI, "未知可留空，由 Bloom 建议后确认。"),
    ("4.2", "竞争对手 2 Competitor 2", "公司名 + 网站；格式与第 1 家相同。", "ABC Imports — abcimports.com", OPTIONAL,
     "competitors.list[1]", "competitor_tracking; market_map", RI, ""),
    ("4.3", "竞争对手 3 Competitor 3", "公司名 + 网站；格式与第 1 家相同。", "Global Fair Ltd — globalfair.cn", OPTIONAL,
     "competitors.list[2]", "competitor_tracking; market_map", RI, ""),
    ("4.4", "竞争对手 4（可选）Competitor 4", "公司名 + 网站；没有可留空。", "无", OPTIONAL,
     "competitors.list[3]", "competitor_tracking", RI, ""),
    ("4.5", "竞争对手 5（可选）Competitor 5", "公司名 + 网站；没有可留空。", "无", OPTIONAL,
     "competitors.list[4]", "competitor_tracking", RI, ""),
    ("4.6", "各竞对差异化点 Differentiators", "对方相对您的差异：价格 / 交期 / 定制能力 / 服务。", "XYZ 价格低 10% 但交期长 2 周", OPTIONAL,
     "competitors.differentiators", "competitor_tracking; market_intel.focus", RI, ""),
    ("4.7", "我们最常输给谁、赢过谁 Win/loss", "丢单最常见对手与最常赢的对手，及原因。", "常输给 XYZ（价格）；常赢本地贸易商（交期）", OPTIONAL,
     "competitors.winLoss", "market_intel.focus; outreach.talkingPoints", OUTREACH, ""),
    ("4.8", "竞对监控重点 Monitoring focus", "Bloom 将定期扫描竞对动态，请勾选最关注的 2–3 项：新品 / 价格变化 / 促销 / 招聘 / 展会动态 / 融资。", "新品、价格变化、展会动态", REQUIRED,
     "competitors.monitoringFocus", "competitor_tracking.scope", RI, "竞对追踪（模块 F）的扫描范围。"),
    ("4.9", "替代品/二手市场 Substitutes", "是否将二手设备/租赁市场等视为替代性竞争及原因。", "是——二手摊位市场分流低端需求", OPTIONAL,
     "competitors.substitutes", "competitor_tracking; market_map", RI, ""),
])

S5 = ("05_监控关键词与采购信号", "Keywords & Intent Signals", [
    ("5.1", "产品/业务关键词 Product keywords", "用于市场情报与采购信号扫描。Intelligence Starter ≤10 个；Lead Generation Pro ≤30 个。", "industrial valves buyer; 阀门采购", REQUIRED,
     "keywords.monitor", "purchase_signals.queryTerms; market_intel.keywords", RI, "数量超限会被编译器拒绝。"),
    ("5.2", "自有品牌词 Brand keywords", "贵司品牌名及常见拼写变体。", "BloomTech; Bloom Tech", OPTIONAL,
     "keywords.brand", "market_intel.keywords; competitor_tracking", RI, ""),
    ("5.3", "竞对品牌词 Competitor keywords", "来自 Sheet 04 的竞对名，用于监测其动态。", "XYZ Trading", OPTIONAL,
     "keywords.competitor", "competitor_tracking.keywords", RI, ""),
    ("5.4", "意向信号词 Intent phrases", "表明近期有采购需求的表述，如 “looking for supplier” “Request for Quotation”。", "looking for manufacturer; RFQ", REQUIRED,
     "keywords.intent", "purchase_signals.intentPhrases", RI, "信号粗评分的核心依据。"),
    ("5.5", "排除词 / 负面词 Exclusions", "出现即忽略的词，避免误报。", "二手、repair、job hiring", REQUIRED,
     "keywords.exclusions", "purchase_signals.filters", RI, ""),
    ("5.6", "关注渠道 Channels to watch", "希望扫描的信息渠道：行业媒体 / 展会名录 / 政府采购公告 / LinkedIn / B2B 平台等。", "行业媒体、LinkedIn、政府采购公告", OPTIONAL,
     "signals.channels", "purchase_signals.channels", RI, "以实际可接入渠道为准。"),
    ("5.7", "扫描频率 Scan cadence", "采购信号扫描频率：每周 / 每两周。Lead Pro 默认每周一推送。", "每周一 06:00", OPTIONAL,
     "signals.scanCadence", "purchase_signals.schedule", CFG, "默认每周；修改写入 cron 配置。"),
    ("5.8", "每期信号上限 Max signals per period", "每期推送的信号条数上限，避免信息过载。", "50", OPTIONAL,
     "signals.maxPerPeriod", "purchase_signals.maxSignalsPerPeriod", RI, "默认 50。"),
    ("5.9", "噪声示例 Noise examples", "您不希望收到的信号示例（“对这类不感兴趣”）。", "不关注金额小于 USD 5k 的订单", OPTIONAL,
     "signals.noiseExamples", "purchase_signals.filters", RI, ""),
    ("5.10", "信号推送范围 Signal delivery", "信号推送给谁、以什么形式（邮件 / 表格 / CRM）。", "邮箱日报给销售总监，汇总入 CRM", OPTIONAL,
     "signals.pushTo", "delivery.signalRouting", CFG, ""),
])

S6 = ("06_ICP与潜客评分", "ICP & Lead Criteria", [
    ("6.1", "理想客户画像 ICP description", "用您自己的话描述最理想的客户（行业、规模、角色、行为）。", "北美中大型工业分销商，有稳定进口需求，采购决策链短", REQUIRED,
     "icp.description", "icp.scoringTuning", ICP, "内部评分模型按此调优。"),
    ("6.2", "A 级客户定义 A-tier criteria", "什么算 A 级（最优先跟进）。", "月度/季度稳定复购，年采购 USD 500k+", REQUIRED,
     "icp.criteriaA", "icp.scoringTuning; lead.tiering", ICP, "对应评分 ≥0.8。"),
    ("6.3", "B 级客户定义 B-tier criteria", "什么算 B 级（值得培育）。", "有明确近期采购计划，规模中等", REQUIRED,
     "icp.criteriaB", "icp.scoringTuning; lead.tiering", ICP, "对应评分 0.5–0.8。"),
    ("6.4", "C 级客户定义 C-tier criteria", "什么算 C 级（观察池）。", "小额或首次采购，复购不确定", REQUIRED,
     "icp.criteriaC", "icp.scoringTuning; lead.tiering", ICP, "对应评分 0.3–0.5。"),
    ("6.5", "评分权重因子 Weighting factors", "评分应侧重哪些因子：规模 / 行业匹配 / 增长信号 / 区域 / 决策链可达性，并给出大致侧重。", "行业匹配 40%、规模 30%、决策链 30%", OPTIONAL,
     "icp.weights", "icp.scoringTuning", ICP, "内部模型 internal_v1 的权重调优输入。"),
    ("6.6", "客户规模门槛 Size thresholds", "员工数 / 营收 / 门店数等的最低门槛。", "员工 ≥50 或年营收 ≥USD 10M", OPTIONAL,
     "icp.sizeThresholds", "lead.discovery.filters", LEAD, ""),
    ("6.7", "地域限制 Geographic limits", "仅某些国家/地区？明确包含与排除。", "美国 48 州 + 加拿大；不含阿拉斯加", OPTIONAL,
     "icp.geographicLimits", "lead.discovery.filters", LEAD, ""),
    ("6.8", "每月线索配额 Monthly lead quota", "每月交付的评分线索数量。Lead Generation Pro 标配 50 条/月。", "50", REQUIRED,
     "icp.monthlyQuota", "lead.quota", LEAD, "Intelligence Starter 无此模块。"),
    ("6.9", "目标联系人职位 Target contact roles", "希望触达的职位（用于联系人 enrichment）。", "采购经理、Owner、供应链总监", OPTIONAL,
     "icp.contactRoles", "lead.enrichment", LEAD, ""),
    ("6.10", "线索必填字段 Lead required fields", "每条线索必须包含的字段：公司名、联系人、职位、邮箱、电话、网站、匹配理由等。", "公司名、联系人、职位、邮箱、匹配理由", REQUIRED,
     "icp.leadFields", "lead.poolSchema", LEAD, "字段缺失的线索不计入配额。"),
    ("6.11", "淘汰画像 Disqualified profiles", "直接淘汰的客户特征（即使表面匹配）。", "成立<2年的贸易公司；仅零售个人", OPTIONAL,
     "icp.disqualifiers", "lead.discovery.filters", LEAD, ""),
    ("6.12", "数据合规红线 Compliance red lines", "不允许的获客方式或数据使用方式。", "不购买第三方联系人名单", OPTIONAL,
     "icp.complianceLimits", "lead.discovery.filters; compliance", CFG, "平台级合规约束。"),
])

S7 = ("07_交付与审批偏好", "Delivery & Approvals", [
    ("7.1", "服务包 Service package", "Intelligence Starter 或 Lead Generation Pro（二选一）。", "Lead Generation Pro", REQUIRED,
     "package", "agent_roster", CFG, "决定启用的 Agent 模块：Lead Pro 额外启用 Lead/Outreach/Conversion。"),
    ("7.2", "报告交付节奏 Report cadence", "市场简报（月度，每月 1 日前）、信号推送（每周）、竞对报告（每月 5 日前）、区域分析（季度）——确认或调整。", "默认节奏", REQUIRED,
     "delivery.reportCadence", "market_intel.schedule; competitor_tracking.schedule", CFG, "直接写入 cron 配置。"),
    ("7.3", "报告语言 Report language(s)", "中文 / 英文 / 双语。", "中英双语", REQUIRED,
     "delivery.languages", "report.generation", CFG, ""),
    ("7.4", "报告接收人 Report recipients", "姓名 + 邮箱，可多位并注明各自接收的报告类型。", "王总 cto@example.com（全部）；李经理 sales@example.com（线索包）", REQUIRED,
     "delivery.recipients", "delivery.recipientList", CFG, ""),
    ("7.5", "外联方式 Outreach mode", "Bloom 默认：邮件自动化（草拟 → 贵司审批 → 发送）。确认或提出调整。", "默认（审批后发送）", OPTIONAL,
     "delivery.outreachMode", "outreach.mode", OUTREACH, "无审批决定绝不发送。"),
    ("7.6", "每日发送上限 Daily send cap", "审批通过后每日最多发送的邮件数。", "100", OPTIONAL,
     "delivery.dailySendCap", "outreach.dailySendCap", OUTREACH, "默认 100。"),
    ("7.7", "CRM 系统 CRM system", "在用的 CRM 名称与版本；不需要 CRM 写“无”。", "HubSpot（Sales Hub Starter）", REQUIRED,
     "crm.system", "crm.adapter", CFG, "CRM 写入经审批队列。"),
    ("7.8", "审批人 Approval contacts", "邮件发送、CRM 写入、大额导出等高风险操作的审批人：姓名 + 邮箱（至少 1 位）。", "王总 wang@example.com；备用：李经理 li@example.com", REQUIRED,
     "approvals.contacts", "approval.approvers", CFG, "编译器强制至少 1 位。"),
    ("7.9", "审批渠道 Approval channels", "审批通知发送渠道：邮件 / 企业微信 / Slack 等。", "邮件 + 企业微信", OPTIONAL,
     "approvals.channels", "approval.channels", CFG, ""),
    ("7.10", "审批时效 SLA", "审批超时如何处理：自动提醒 / 顺延到下一周期 / 升级到备用审批人。", "24h 未审自动提醒，48h 顺延", OPTIONAL,
     "approvals.sla", "approval.sla", CFG, ""),
    ("7.11", "广告账号（只读建议）Ad accounts (read-only)", "如需广告建议：Google Ads / LinkedIn Ads 账号 ID。Bloom v1.0 仅提供只读建议，不直接操作。", "Google Ads: 123-456-7890", OPTIONAL,
     "ads.accounts", "ads.adapters", AD, "仅支持 Google + LinkedIn。"),
    ("7.12", "上线验收标准 Go-live acceptance", "您认为流程跑通的标志。", "收到第一份月报 + 第一批 A/B 级线索", OPTIONAL,
     "delivery.acceptanceCriteria", "delivery.acceptanceCriteria", CFG, ""),
    ("7.13", "其他特殊要求 Other requirements", "任何上述未覆盖的要求或补充说明。", "希望审批提醒同时发到 WhatsApp", OPTIONAL,
     "delivery.notes", "workflow.freeformNotes", CFG, ""),
])

CUSTOMER_SHEETS = [S1, S2, S3, S4, S5, S6, S7]
FIELDMAP_COLUMNS = ["序号 No.", "intake 键 Intake key", "所属表 Sheet", "来源行 Source row", "是否必填 Required",
                    "喂入配置键 Config key(s)", "所属 Agent", "备注 Notes"]

REQUIRED_KEYS = {"package", "markets.regions", "markets.industries", "keywords.monitor", "keywords.intent",
                 "keywords.exclusions", "icp.description", "icp.criteriaA", "icp.criteriaB", "icp.criteriaC",
                 "icp.monthlyQuota", "icp.leadFields", "approvals.contacts", "delivery.reportCadence",
                 "delivery.languages", "delivery.recipients", "crm.system", "company.name", "company.website",
                 "company.businessType", "company.hqAddress", "company.exportHistory", "company.currentMarkets",
                 "company.systems", "products.categories", "markets.exclusions", "competitors.monitoringFocus",
                 "competitors.list[0]"}


INSTRUCTIONS_MD = """# Bloom 客户功能需求与业务流程调查表

## Bloom Customer Feature & Workflow Intake Questionnaire

| # | 说明 Instruction | 详情 Detail |
|---|---|---|
""" + "\n".join(
    f'| {rid} | {instr} | {detail} |' for rid, instr, detail in INSTR_ROWS
) + """

## 工作簿结构 Workbook structure

| 工作表 Sheet | 内容 Contents |
|---|---|
| 01 公司概况 | 公司基本信息、出口经验、现有系统 |
| 02 产品线与出口 | 产品大类、认证、价格带、MOQ |
| 03 目标行业与区域 | 优先行业与区域、扩展计划 |
| 04 竞争对手清单 | 竞对名单、差异点、监控重点 |
| 05 监控关键词与采购信号 | 扫描关键词、意向信号词、排除词 |
| 06 ICP与潜客评分 | A/B/C 级定义、配额、评分权重 |
| 07 交付与审批偏好 | 服务包、节奏、语言、审批人 |
| 08 字段映射(内部) | Bloom 内部使用：字段 → 配置键 → Agent |
"""


def field_map_rows():
    """One row per intake field: intake key → sheet → config keys → agent."""
    rows = []
    n = 0
    for slug_cn, slug_en, fields in CUSTOMER_SHEETS:
        sheet_label = f"{slug_cn} / {slug_en}"
        for (rid, field, _instr, _example, _req, key, config_keys, agent, note) in fields:
            n += 1
            required = "必填" if key in REQUIRED_KEYS else "选填"
            rows.append([f"8.{n}", key, sheet_label, f"{rid} {field.split(' ')[0]}",
                         required, config_keys, agent, note])
    return rows


def write_csv(path, columns, rows, line_terminator="\n"):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, quoting=csv.QUOTE_ALL, lineterminator=line_terminator)
        w.writerow(columns)
        w.writerows(rows)


def build_xlsx(path):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    wb = Workbook()
    wb.remove(wb.active)

    header_fill = PatternFill("solid", fgColor="1F3864")
    header_font = Font(bold=True, color="FFFFFF")
    wrap = Alignment(wrap_text=True, vertical="top")

    def add(name, columns, rows, widths):
        ws = wb.create_sheet(title=name)
        ws.append(columns)
        for c in ws[1]:
            c.fill, c.font, c.alignment = header_fill, header_font, wrap
        for row in rows:
            ws.append(row)
        for i, width in enumerate(widths, start=1):
            ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = width
        for row in ws.iter_rows():
            for c in row:
                c.alignment = wrap
        ws.freeze_panes = "A2"

    for slug_cn, slug_en, fields in CUSTOMER_SHEETS:
        rows = [[rid, field, instr, example, req, ""] for (rid, field, instr, example, req, *_rest) in fields]
        # Excel sheet titles cap at 31 chars — keep them CN-only; column headers stay bilingual.
        add(slug_cn.replace("_", " "), COLUMNS, rows, [8, 30, 46, 38, 14, 36])
    add("08 字段映射(内部)", FIELDMAP_COLUMNS, field_map_rows(), [8, 34, 40, 20, 12, 46, 20, 40])
    wb.save(path)


def main():
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    csv_dir = os.path.join(repo_root, "templates", "customer-intake")
    os.makedirs(csv_dir, exist_ok=True)

    for slug_cn, slug_en, fields in CUSTOMER_SHEETS:
        fname = f"{slug_cn.split('_')[0]}-{slug_en.lower().replace(' & ', '-').replace(' ', '-')}.csv"
        rows = [[rid, field, instr, example, req, ""] for (rid, field, instr, example, req, *_r) in fields]
        write_csv(os.path.join(csv_dir, fname), COLUMNS, rows)

    write_csv(os.path.join(csv_dir, "08-field-map-internal.csv"), FIELDMAP_COLUMNS, field_map_rows())

    with open(os.path.join(csv_dir, "README.md"), "w", encoding="utf-8") as f:
        f.write(INSTRUCTIONS_MD)

    build_xlsx(os.path.join(repo_root, "templates", "customer-intake.xlsx"))

    n_fields = sum(len(f) for _, _, f in CUSTOMER_SHEETS)
    print(f"generated: 8 CSVs + README.md + 1 xlsx under templates/; intake fields mapped: {n_fields}")


if __name__ == "__main__":
    main()
