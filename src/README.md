# 产品实现

业务、输入和表达采用明确边界，见 [ADR-003](../docs/adr/003-cross-platform-first-version.md)。

- `contracts/`：运行时 schema 与持久化／IPC 类型。
- `domain/`：状态转换、证据和精确计算；不依赖 Electron、服务或供应商。
- `service/`：唯一业务写入者，SQLite、命令幂等、增量调度、恢复与音频接收许可。
- `agent/`：真实模型、转写和翻译适配器。无固定答案 fallback。
- `integrations/`：隐藏窗口的 AudioWorklet 输入、WAV、双通道、停止释放。
- `renderers/`：通用表达渲染、来源校验、被动 HTML/SVG 清洗及预览标记。
- `desktop/`：跨平台窗口、权限、IPC、托盘、菜单、快捷键及独立预览沙箱。
- `ui/`：选定视觉方向、双语文案与可信交互。

启动入口 `desktop/main.ts`；会话服务入口 `service/worker.ts`；UI 入口 `ui/main.tsx`。产品不依赖仓库外文件；密钥、数据库、音频和构建目录不入库。
