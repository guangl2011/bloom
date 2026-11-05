# Bloom 客户功能需求与业务流程调查表

## Bloom Customer Feature & Workflow Intake Questionnaire

| # | 说明 Instruction | 详情 Detail |
|---|---|---|
| 0.1 | 本表用途 Purpose | 本调查表用于为您定制 Bloom Agent 工作流（v1.0 单租户部署）。您填写的每一项都会进入工作流配置（每次修改均有版本记录与审计日志）。 This workbook customizes your Bloom Agent workflow (single-tenant v1.0 deployment). Every answer feeds your workflow config, which is versioned and audit-logged. |
| 0.2 | 如何填写 How to fill | 逐行填写最右侧“客户填写”列。所有字段均附有填写说明与示例，无需参加培训即可独立完成；不确定的项填“不确定”，我们会在定制访谈中跟进。 Fill the rightmost "Your Answer" column row by row. Every field has instructions and an example — no workshop needed. Write 不确定 (unsure) where applicable and we will follow up. |
| 0.3 | 必填与选填 Required vs optional | “是否必填”列标注了必填（必填）与选填（选填）。必填项缺失会导致配置无法编译——编译器会准确指出缺失的表与字段。 The "Required" column marks 必填 (required) / 选填 (optional). A missing required field blocks config compilation — the compiler names the exact sheet and field. |
| 0.4 | 填写语言 Language | 可用中文或英文填写，报告语言在 Sheet 07 单独选择。 Answer in Chinese or English; report language is chosen separately in Sheet 07. |
| 0.5 | 保密承诺 Confidentiality | 所有信息仅用于为您定制 Bloom 工作流，按服务合同保密承诺处理；您的数据保存在您的专属部署中，不与其他客户混用。 All information is used solely to customize your Bloom workflow, under the NDA in the service contract. Your data lives in your dedicated deployment, never commingled. |
| 0.6 | 回传方式 Return | 填写完成后将本表回传给 Bloom 团队（xlsx 或 CSV 均可）。我们将其转换为 intake.json 并生成您的工作流配置初稿，供您审批后生效。 Return the completed workbook (xlsx or CSV) to the Bloom team. We compile it into intake.json, draft your workflow config, and activate it after your approval. |
| 0.7 | 版本与变更 Versioning | 每次配置变更均有版本记录；您后续补充或修改本表时，我们以新版本生效，历史版本可追溯。 Every config change is versioned. Later edits to this workbook take effect as a new version; history remains auditable. |
| 0.8 | 审批安全 Approval gates | 邮件发送、CRM 写入、大额导出等高风险操作永远不会在无人工审批的情况下执行——这是平台硬性约束，不可关闭。 High-risk actions (email send, CRM write, large export) are never executed without a recorded human approval — a hard platform invariant that cannot be switched off. |
| 0.9 | 咨询 Contact | 填写中遇到问题，请联系您的 Bloom 对接人。 For questions, contact your Bloom point of contact. |

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
