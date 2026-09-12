# 产品实现

[Demo实时表达](../docs/demo-live-visuals.md)：`agent/response-stream.ts`读取真实SSE草稿与usage；`ui/LiveEditing.tsx`呈现瞬态状态；`renderers/RelationshipGraph.tsx`、`graph-layout.ts`和`ui/live-visuals.css`实现图标、图形和局部变化。

四类意图模块：[契约](contracts/intent-preparation.ts)、[可信草稿规则](domain/intent-preparation.ts)、[界面](ui/IntentPanel.tsx)。共用现有理解、版本与存储事务，实际边界见[意图说明](../docs/collaboration-intents.md)。

业务、输入和表达采用明确边界；当前连续 Agent 采用 [ADR-005](../docs/adr/005-bounded-agent-workflows.md)，采集基线保留 [ADR-004](../docs/adr/004-live-agent-pipeline.md)，首版历史见 [ADR-003](../docs/adr/003-cross-platform-first-version.md)，进度见[状态](../docs/status.md)与[Agent 迭代记录](../docs/sessions/2026-09-11-agent-iteration.md)。目录存在不表示功能已验收。

- `contracts/`：运行时 schema 与持久化／IPC 类型。
- `domain/`：状态转换、证据和精确计算；不依赖 Electron、服务或供应商。
- `service/`：唯一业务写入者，SQLite、命令幂等、增量调度、恢复与音频接收许可。
- `agent/`：真实模型、转写和翻译适配器。无固定答案 fallback。
- `integrations/`：隐藏窗口的 AudioWorklet 输入、双通道与停止释放；`live-transcription.ts` 在可信后台处理 Realtime WebSocket、流式暂定文本、最终结果与音频 lease 对齐。显式文件模型仍使用 WAV／HTTP 队列。
- `renderers/`：通用表达渲染、来源校验、被动 HTML/SVG 清洗及预览标记。
- `desktop/`：跨平台窗口、权限、IPC、托盘、菜单、快捷键及独立预览沙箱；启动时用系统首选语言API解析跟随系统。
- `ui/`：协作浅色视觉、双语文案与可信交互；`theme.ts`从设计 JSON 提供共享颜色，浏览器显式初始化，后台预检只读取参数。控件图标使用lucide-react；桌面入口使用[生成素材](ui/assets/README.md)，`launcher-status.ts`统一投影采集／服务状态。

启动入口 `desktop/main.ts`；会话服务入口 `service/worker.ts`；UI 入口 `ui/main.tsx`。产品不依赖仓库外文件；密钥、数据库、音频和构建目录不入库。

## 迭代维护

新增模块或改变职责时更新本文件和对应契约／技术设计；本轮具体变化与验证写入 [session](../docs/sessions/README.md)，不要在目录说明复制实时进度。本轮接入的模块包括 `agent/context.ts`、`domain/artifacts.ts`、`integrations/transcription-queue.ts`、`renderers/RelationshipGraph.tsx` 和 `ui/live.tsx`；其接入与验证以对应 session 为准。

流式 STT 的当前约束与验证见 [接入记录](../docs/sessions/2026-09-12-live-transcribe.md)；`Snapshot.liveTranscripts` 仅为内存中的暂定文本，不写入会议或作为 Agent 来源。

可靠性补充：`domain/meaning.ts`维护证据约束和依赖修订；`domain/closeout.ts`核对全场结束状态；`ui/MeetingReview.tsx`提供条件依据和结束汇总。行为和边界见[规范](../docs/agent-reliability.md)。

## 跨会议文件夹新增模块

- [collection.ts](domain/collection.ts)／[collection-digest.ts](domain/collection-digest.ts)：用户声明的会议分组、别名分配、报告过期与确定性决策／未决项汇总（浏览器安全，不 import `node:`）。
- [collection-decisions.ts](domain/collection-decisions.ts)：只读合并旧产物型会议决定与正式协作确认，个人采纳不进入集合决定汇总。
- [collection-context.ts](agent/collection-context.ts)：送进模型请求的确切对象；别名映射不外发。
- [collection-state.ts](service/collection-state.ts)：别名解析、合成会议与分歧覆盖断言。
- [CollectionView.tsx](ui/CollectionView.tsx)：文件夹管理、确定性面板与只读跨会议依据面板。

`service/session.ts` 的 `drainCollectionReport()` 负责独立有界生成、成员版本拒绝和报告快照；集合不另建 LangGraph 图，重启不自动续跑报告。`service/store.ts` 兼容旧 FTY 私有状态与缺失集合字段。边界见[运行说明](../docs/agent-workflow-runtime.md#跨会议集合与报告)和 [ADR-006](../docs/adr/006-cross-meeting-collections.md)。

## 有界工作流新增模块

- [workflow.ts](agent/workflow.ts)／[tools.ts](agent/tools.ts)：实时与个人图、只读证据和受控计算。
- [workflow-state.ts](service/workflow-state.ts)／[call-pool.ts](service/call-pool.ts)：可信读集、ID映射、fencing、调用保留槽。
- [workflow.ts](contracts/workflow.ts)／[render-report.ts](contracts/render-report.ts)：持久任务／工具请求与预览反馈契约。
- [units.ts](domain/units.ts)／[expression-repair.ts](domain/expression-repair.ts)：维度与内容保持校验。
- [WorkflowPanel.tsx](ui/WorkflowPanel.tsx)：个人任务、澄清和输入缺口的可信操作。

实际预算、恢复、版本与有限支持范围见[工作流说明](../docs/agent-workflow-runtime.md)。

## 协作组件模块

- [运行时schema](contracts/collaboration.ts)／[意图与图提案](contracts/collaboration-workflow.ts)：四组件、版本、角色投影、命令、证据、持久任务。
- [领域命令](domain/collaboration.ts)／[确定性冲突](domain/collaboration-conflicts.ts)／[依赖复核](domain/collaboration-integrity.ts)：响应、结果、发布门槛、冲突和来源版本。
- [C／R图](agent/collaboration.ts)／[持久调度](service/collaboration-runtime.ts)／[SQLite表](service/collaboration-store.ts)：图不持有事务，服务提交后再通知。
- [四组件界面](ui/collaboration/Panel.tsx)／[样式](ui/collaboration/styles.css)：主工作区索引、发起者悬浮窗、模拟参与者窗口；desktop绑定actor，launcher-status投影ready提示。

[实际运行时与差距](../docs/collaboration-v1-runtime.md)／[本轮验证](../tests/results/collaboration-v1-validation.md)。

## 会议候选提醒

[desktop/meeting-signals.ts](desktop/meeting-signals.ts)是可信检测事件接入点（生产检测器未接入）；[meeting-reminder.ts](desktop/meeting-reminder.ts)管理一次提醒、时效与点击授权；[system-reminder.ts](desktop/system-reminder.ts)适配原生通知；[MeetingReminderBubble.tsx](ui/MeetingReminderBubble.tsx)呈现气泡。[契约与限制](../docs/meeting-reminder-spec.md)区分信号、提醒、采集以及合成测试。


[ui/preference-writer.ts](ui/preference-writer.ts)串行发送字段补丁、保留最新用户意图、失败回滚／重试；[domain/preferences.ts](domain/preferences.ts)定义preferencesPatch的严格校验与嵌套合并。设置不再等待整份Save，快捷键注册由桌面层协调持久化失败回滚。

会中精修：`ui/meeting-editorial.css`覆盖会议正文布局；`ui/SourcePanel.tsx`管理精确原话／纠错／反馈草稿，`ui/source-references.ts`保持编号与版本，`ui/editorial-copy.ts`为双语文案；`renderers/ArtifactView.tsx`提供通用来源编号，不硬编码会议模板。

[domain/scenario-basis.ts](domain/scenario-basis.ts)只读核对已保存个人试算的公式、来源与依赖，区分记录内未变化、已变化和依据缺失；由现有保存记录区域显示提示，不改变生成组件或试算数据。见[本轮记录](../docs/sessions/2026-09-12-scenario-basis.md)。

流式授权队列及首包、短尾音、双音轨、取消和预算回归见`tests/unit/live-transcription-service.test.ts`；PR #3修复及交付证据见[验证](../tests/results/pr3-fix-validation.md)。

整合入口：[promote-intent.ts](domain/promote-intent.ts)负责精确草稿版本转为正式组件预览，重复转交复用组件、手工编辑与来源过期阻断覆盖；不自动发放。`tests/unit/integration-flows.test.ts` 与 `tests/e2e/collections.spec.ts` 提供转交、确认引用、成员变化和持久化连接的合成覆盖。

开发代理：[desktop/local-proxy.ts](desktop/local-proxy.ts)仅在非打包、显式开启及本地理解端点下启动；依赖准备、健康复用、停止与日志脱敏边界见[工具说明](../tools/litellm-proxy/README.md)。不代表真实供应商已可用。

- [悬停画板](ui/HoverPreview.tsx)／[速览样式](ui/hover-preview.css)：复用ArtifactView、实时快照与来源编号；只显示当前会议产物，主动操作转工作页。
- [速览窗口位置](desktop/preview-bounds.ts)：Windows／macOS共用DIP几何；左右择宽、显示器钳制且避开悬浮球。显隐计时、拖动抑制与接续IPC由desktop/main.ts管理。
