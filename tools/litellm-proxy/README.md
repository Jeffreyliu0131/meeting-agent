# LiteLLM 本地开发代理

本目录属于 `meeting-agent` 仓库，随 xuwenzhe 分支合入主线；它是可选开发工具，不包含在打包应用中。产品通过 `ModelPort` 连接供应商，不依赖本地 Python 代理。整合与验证范围见[交接](../../docs/sessions/2026-09-12-branch-integration.md)。

## 当前配置与转写路线

[config.yaml](config.yaml) 提供两个本地模型别名：

| 别名 | 配置中的上游 | 应用路径 |
|---|---|---|
| `meeting-chat` | `deepseek/deepseek-chat` | Chat Completions 理解与生成 |
| `meeting-transcribe` | `openai/gpt-4o-transcribe` | 显式选择后的 HTTP 文件转写 |

当前应用默认 `gpt-live-transcribe` 由可信后台直连 Realtime WebSocket；该路线不通过 `meeting-transcribe` 文件转写别名。模型可用性、响应格式和额度以实际账号调用为准；配置文件中的名称不是成功证据。

## 随开发应用自动启动

在本目录从 [provider.env.example](provider.env.example) 创建本地 `provider.env`，按启用的上游填写凭证；该文件被 Git 忽略。保留两个配置别名时分别准备对应凭证。理解走本地代理、Live 转写直连的应用根目录 `.env` 示例：

```dotenv
OPENAI_API_KEY=sk-1234
MEETING_API_BASE=http://127.0.0.1:4000/v1
MEETING_MODEL=meeting-chat
MEETING_RESPONSE_FORMAT=json_object
MEETING_AUTOSTART_PROXY=1
MEETING_STT_API_BASE=https://api.openai.com/v1
MEETING_STT_MODEL=gpt-live-transcribe
MEETING_STT_API_KEY=你的OpenAI凭证
```

`sk-1234` 是当前配置中的本地代理示例 key，不是上游凭证。使用代理 key 时必须单独设置 `MEETING_STT_API_KEY`，否则转写适配器会回退到 `OPENAI_API_KEY` 中的代理 key。

从仓库根目录 `npm start`，桌面层只在非打包运行、`MEETING_AUTOSTART_PROXY=1`、理解地址为无用户名密码的 HTTP 回环地址时尝试启动。端口取自理解地址；工具目录默认 `tools/litellm-proxy`，可用 `MEETING_PROXY_DIR` 覆盖。

[local-proxy.ts](../../src/desktop/local-proxy.ts) 先检查 `/health/readiness`，已有健康服务直接复用；否则优先目录内 `.venv`，再找 PATH 中的 LiteLLM，仍缺失时创建私有虚拟环境并安装 `litellm[proxy]`。首次准备需要 Python、包下载网络和安装时间；不会阻塞应用窗口启动，失败记录原因，应用继续显示实际供应商状态。

Windows 在缺少 `windows-cas.pem` 时尝试导出本机证书库，作为 Python TLS 信任来源；未关闭证书校验。代理未在启动检查期内就绪时会停止本次启动的进程；退出应用也只停止自己启动的代理，不关闭原先已在运行的服务。当前没有进程意外退出后的自动重启循环。

## 手动脚本及平台差异

需要单独运行代理时，在本目录执行：

```sh
bash start.sh
```

Windows PowerShell 对应：

```powershell
.\start.ps1
```

手动模式需保持终端运行。端口通过 `LITELLM_PORT` 指定，默认4000；它与应用自动启动从 `MEETING_API_BASE` 读取端口的方式不同。

当前 [start.sh](start.sh) 优先本地 `.venv`／PATH，缺失时创建私有环境；[start.ps1](start.ps1) 查 PATH，缺失时调用当前 `pip install`，不会自动使用目录内 `.venv`。两种手动脚本都要求两个上游 key，且会打印 key 片段；不要将其输出当成已脱敏的公开验证日志。桌面自动启动路径会遮盖来自 `provider.env` 的配置值，不能据此假定手动脚本也有同样保护。

如明确选择旧 HTTP 文件转写，应用配置可改用 `MEETING_STT_MODEL=meeting-transcribe`、本地 `MEETING_STT_API_BASE` 和与代理配置一致的 `MEETING_STT_API_KEY`；这会改变转写路线，不是修复 Live 连接的自动降级。

## 验证与容量

仓库没有旧说明引用的 `provider-probe.mjs`。代理健康检查只证明本地服务就绪，不证明上游 key、模型、实时音频或语义质量通过。现有[代理单元测试](../../tests/unit/local-proxy.test.ts)覆盖开启条件、回环边界和取消，不安装依赖、不调用真实供应商。

需要真实模型评估时使用仓库的 `npm run test:model` 或统一评测的 `--model` 阶段；这些命令会发起真实调用，不能当作离线健康检查。完整运行方式见[仓库 README](../../README.md)与[Event 评测](../../docs/event-evaluation.md)。

当前理解默认合并250ms，允许配置100–10,000ms；旧说明的15,000ms超过代码上限，会返回 `INVALID_AGENT_CONFIG`。每场会议／集合的小时调用预算与供应商账户额度不同，不在此假定免费层固定限流或调用价格。连续失败耗尽任务预算会保留可见输入缺口，新的来源版本可重新处理，详见[恢复规则](../../docs/agent-workflow-runtime.md)。

模型请求使用流式 Chat Completions、`max_completion_tokens` 及 `response_format`；当前配置启用 `drop_params`，实际兼容性仍须实调。只切换 `json_object` 不保证端点接受所有流式参数。理解用量读取 `usage.prompt_tokens`／`completion_tokens`；缺失时标未知并保守预留，不能声称只是显示变化、不会影响预算。文件转写与 Live 转写分别记账，不沿用旧 HTTP 返回体解释所有用量。
