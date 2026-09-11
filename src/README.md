# 产品实现

业务、输入和表达采用明确边界；当前连续 Agent 采用 [ADR-004](../docs/adr/004-live-agent-pipeline.md)，首版历史见 [ADR-003](../docs/adr/003-cross-platform-first-version.md)，进度见[状态](../docs/status.md)与[Agent 迭代记录](../docs/sessions/2026-09-11-agent-iteration.md)。目录存在不表示功能已验收。

- `contracts/`：运行时 schema 与持久化／IPC 类型。
- `domain/`：状态转换、证据和精确计算；不依赖 Electron、服务或供应商。
- `service/`：唯一业务写入者，SQLite、命令幂等、增量调度、恢复与音频接收许可。
- `agent/`：真实模型、转写和翻译适配器。无固定答案 fallback。
- `integrations/`：隐藏窗口的 AudioWorklet 输入、WAV、双通道、停止释放。
- `renderers/`：通用表达渲染、来源校验、被动 HTML/SVG 清洗及预览标记。
- `desktop/`：跨平台窗口、权限、IPC、托盘、菜单、快捷键及独立预览沙箱。
- `ui/`：协作浅色视觉、双语文案与可信交互；`theme.ts`从设计 JSON 提供共享颜色，浏览器显式初始化，后台预检只读取参数。控件图标使用lucide-react；桌面入口使用[生成素材](ui/assets/README.md)，`launcher-status.ts`统一投影采集／服务状态。

启动入口 `desktop/main.ts`；会话服务入口 `service/worker.ts`；UI 入口 `ui/main.tsx`。产品不依赖仓库外文件；密钥、数据库、音频和构建目录不入库。

## 迭代维护

新增模块或改变职责时更新本文件和对应契约／技术设计；本轮具体变化与验证写入 [session](../docs/sessions/README.md)，不要在目录说明复制实时进度。本轮接入的模块包括 `agent/context.ts`、`domain/artifacts.ts`、`integrations/transcription-queue.ts`、`renderers/RelationshipGraph.tsx` 和 `ui/live.tsx`；其接入与验证以对应 session 为准。
