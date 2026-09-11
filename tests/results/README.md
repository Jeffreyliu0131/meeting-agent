# 执行记录

[validation.md](validation.md) 是本轮首版的实际结果与限制；[package-smoke.json](package-smoke.json)、[microphone-probe.json](microphone-probe.json)、[package-content.json](package-content.json) 为已执行探针元数据，不含录音或真实会议原文。

`npm test` 执行领域与架构测试；`npm run test:e2e` 在图形桌面打开真实 Electron 窗口，生成本地 JSON 报告与合成输入截图。原始 UI 报告可能含主机路径，不默认跟踪。

`npm run test:model` 仅在提供凭证后调用真实模型。没有凭证时明确失败，不产生假模型输出。测试替身、合成音源、真实麦克风信号与真实会议转写必须分开记录。
