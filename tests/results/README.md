# 执行记录

[validation.md](validation.md) 是已交付首版（本地基线 `5fcd90f`）的实际结果与限制；[package-smoke.json](package-smoke.json)、[microphone-probe.json](microphone-probe.json)、[package-content.json](package-content.json) 为已执行探针元数据，不含录音或真实会议原文。

`npm test` 执行领域与架构测试；`npm run test:e2e` 在图形桌面打开真实 Electron 窗口，生成本地 JSON 报告与合成输入截图。原始 UI 报告可能含主机路径，不默认跟踪。

`npm run test:model` 仅在提供凭证后调用真实模型。没有凭证时明确失败，不产生假模型输出。测试替身、合成音源、真实麦克风信号与真实会议转写必须分开记录。


## 新一轮结果归属

2026-09-12：[GPT Live Transcribe Windows验证](live-transcription-validation.md)记录本轮44项单元、8项桌面测试与合成语音的真实流式调用，不替代真实会议验收。

每轮结果注明执行日期、环境、命令、对应 Git 基线及未提交范围，链接到 [session](../../docs/sessions/README.md) 和 [状态页](../../docs/status.md)。同日多轮不得混成一个“本轮通过”。保留旧证据，新增结果标明替代范围；单独出现的 JSON／截图不自动成为全产品通过结论。

本次文档治理仅运行静态文档检查，结果见[治理记录](../../docs/sessions/2026-09-11-project-continuity.md)，没有重跑首版产品测试。正在执行的 Agent 评估以对应任务最终结果为准。

当前本地迭代结果：[连续 Agent 与会议入口](live-agent-validation.md)，合成连续负载：[stream-evaluation.json](stream-evaluation.json)。不覆盖首版探针的版本范围。

本轮独立包证据：[macOS启动](package-smoke-live.json)、[两端包内容](package-content-live.json)、[源码与测试汇总](live-agent-summary.json)。旧package-smoke.json／package-content.json保持首版证据。
