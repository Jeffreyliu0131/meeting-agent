# 首版协作意图、动态组件与 LangGraph 设计

记录类型：本任务执行记录。
状态：设计完成，待评审／实施。更新时间：2026-09-12（Asia/Shanghai）。

## 目标与授权

用户要求系统设计首版投票、分工、冲突、决定确认，包括意图、schema、样式、触发条件、完整 LangGraph 结构与节点唤起时机。本轮授权为设计及文档同步；不实现产品、不采音、不调用模型、不提交／推送。

## 接手基线

HEAD `be0b244`，工作树干净。已核对状态、session 索引、产品定义、前端／风格、契约、现有 LangGraph 源码与运行时。现有图为 interpret／validate／evidence／prepareRepair，持久化与可信提交在服务层；本轮设计不能写成已接入。

## 实际变化与依据

已完成三份相互链接的设计：[完整产品与LangGraph结构](../collaboration-v1-design.md)、[数据／schema／命令／事件契约](../collaboration-v1-contracts.md)、[62项验收场景](../collaboration-v1-acceptance.md)。覆盖四类组件、准备态与来源冻结、角色视图／样式、M/C/R/A/X/P/Z节点职责及逐组件触发矩阵、版本与权限投影、回应／分析水位、数据库事务和独立本地模拟窗口。

设计采用有界语义图与可信命令服务分工：普通投票即时确定性计数，异议及依赖变化才进入影响分析；host显式发放／记录，Agent仅提案。公开版本变更后不继承旧票或确认；冲突关闭不等于解决。已同步COL01范围增补，保留普通生成表达及个人工作模式。

## 验证与未验证

已核对实际workflow.ts、SessionService调用／提交路径、workflow契约及持久化方式。已自审目标歧义、手工锁、隐私投影、修订、异议与记录决定竞态、因果循环和结束恢复。`scripts/check-docs.py`通过：71篇Markdown、19条session、无链接／路由／字段错误；`git diff --check`通过。

六段TypeScript契约示例合并到忽略目录的临时校验文件，通过本项目`tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --lib ES2022`检查；62个验收ID无重复。最初尝试旧TypeScript compiler API时，本地TS7未导出ScriptTarget，故改用已安装CLI并通过。这些检查只证明文档结构及示意类型一致，不是运行时schema或业务实现验收。本轮未运行产品测试、未调用真实模型或音频。

## 未完项与下一步

本轮系统设计范围已完成。后续先评审四组件行为和图结构，再按契约／命令与投影、固定组件、C图、R图与恢复、验收的顺序实施；语义分数和时延均为待测目标。schema尚未转成运行时Zod／JSON Schema，数据库迁移和双端产品代码尚未编写，远程协作与真实认证仍不在首版范围。

## 文件同步与交付

已同步README、产品定义、决策COL01、前端／风格、契约、技术设计、实际运行时的未来设计入口、实施顺序、验收入口、状态与session索引。现有运行时文档仍描述现有代码，不冒充新增能力已完成。本轮只修改文档和忽略目录校验临时文件；未提交、未推送、未重启应用。
