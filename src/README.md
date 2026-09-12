# 产品实现

业务、输入和表达采用明确边界；当前连续 Agent 采用 [ADR-005](../docs/adr/005-bounded-agent-workflows.md)，采集基线保留 [ADR-004](../docs/adr/004-live-agent-pipeline.md)，首版历史见 [ADR-003](../docs/adr/003-cross-platform-first-version.md)，进度见[状态](../docs/status.md)与[Agent 迭代记录](../docs/sessions/2026-09-11-agent-iteration.md)。目录存在不表示功能已验收。

- `contracts/`：运行时 schema 与持久化／IPC 类型。
- `domain/`：状态转换、证据和精确计算；不依赖 Electron、服务或供应商。
- `service/`：唯一业务写入者，SQLite、命令幂等、增量调度、恢复与音频接收许可。
- `agent/`：真实模型、转写和翻译适配器。无固定答案 fallback。
- `integrations/`：隐藏窗口的 AudioWorklet 输入、WAV、双通道、停止释放。
- `renderers/`：通用表达渲染、来源校验、被动 HTML/SVG 清洗及预览标记。
- `desktop/`：跨平台窗口、权限、IPC、托盘、菜单、快捷键及独立预览沙箱；启动时用系统首选语言API解析跟随系统。
- `ui/`：协作浅色视觉、双语文案与可信交互；`theme.ts`从设计 JSON 提供共享颜色，浏览器显式初始化，后台预检只读取参数。控件图标使用lucide-react；桌面入口使用[生成素材](ui/assets/README.md)，`launcher-status.ts`统一投影采集／服务状态。

启动入口 `desktop/main.ts`；会话服务入口 `service/worker.ts`；UI 入口 `ui/main.tsx`。产品不依赖仓库外文件；密钥、数据库、音频和构建目录不入库。

## 迭代维护

新增模块或改变职责时更新本文件和对应契约／技术设计；本轮具体变化与验证写入 [session](../docs/sessions/README.md)，不要在目录说明复制实时进度。本轮接入的模块包括 `agent/context.ts`、`domain/artifacts.ts`、`integrations/transcription-queue.ts`、`renderers/RelationshipGraph.tsx` 和 `ui/live.tsx`；其接入与验证以对应 session 为准。


可靠性补充：`domain/meaning.ts`维护证据约束和依赖修订；`domain/closeout.ts`核对全场结束状态；`ui/MeetingReview.tsx`提供条件依据和结束汇总。行为和边界见[规范](../docs/agent-reliability.md)。

## 有界工作流新增模块

- [workflow.ts](agent/workflow.ts)／[tools.ts](agent/tools.ts)：实时与个人图、只读证据和受控计算。
- [workflow-state.ts](service/workflow-state.ts)／[call-pool.ts](service/call-pool.ts)：可信读集、ID映射、fencing、调用保留槽。
- [workflow.ts](contracts/workflow.ts)／[render-report.ts](contracts/render-report.ts)：持久任务／工具请求与预览反馈契约。
- [units.ts](domain/units.ts)／[expression-repair.ts](domain/expression-repair.ts)：维度与内容保持校验。
- [WorkflowPanel.tsx](ui/WorkflowPanel.tsx)：个人任务、澄清和输入缺口的可信操作。

实际预算、恢复、版本与有限支持范围见[工作流说明](../docs/agent-workflow-runtime.md)。

## 会议候选提醒

[desktop/meeting-signals.ts](desktop/meeting-signals.ts)是可信检测事件接入点（生产检测器未接入）；[meeting-reminder.ts](desktop/meeting-reminder.ts)管理一次提醒、时效与点击授权；[system-reminder.ts](desktop/system-reminder.ts)适配原生通知；[MeetingReminderBubble.tsx](ui/MeetingReminderBubble.tsx)呈现气泡。[契约与限制](../docs/meeting-reminder-spec.md)区分信号、提醒、采集以及合成测试。
