# LiteLLM 代理 —— DeepSeek 理解 + OpenAI 转写

这个目录不属于 `meeting-agent` 仓库，是独立的外部工具。

## 为什么需要它

Meeting Agent 说 OpenAI 的线格式，两个端点：

**两个端点来自不同服务商**，因为它们的能力不重合：

| 端点 | 服务商 | 原因 |
|---|---|---|
| `{base}/chat/completions` | **DeepSeek** | 便宜、国内好访问 |
| `{base}/audio/transcriptions` | **OpenAI** | **DeepSeek 根本没有转写 API** |

LiteLLM 把两家包成同一个 OpenAI 形态的地址，顺带翻译各家不认的参数（`max_completion_tokens` → DeepSeek 的 `max_tokens` 等）。

> 注意：`deepseek-chat` **不要换成 `deepseek-reasoner`**。推理模型会把应用的 2500 token 输出预算花在思考上，表现为 `MODEL_OUTPUT_LIMIT`。

## 一、拿 key

需要**两个** key：

| 用途 | 地址 | 格式 |
|---|---|---|
| 理解模型 | https://platform.deepseek.com/api_keys | `sk-` 开头 |
| 转写 | https://platform.openai.com/api-keys | `sk-` 开头 |

## 二、填 key

```powershell
Copy-Item provider.env.example provider.env
notepad provider.env        # 在 DEEPSEEK_API_KEY= 和 OPENAI_API_KEY= 后面粘贴
```

## 三、启动

```powershell
.\start.ps1
```

首次运行会自动 `pip install "litellm[proxy]"`。看到这行就成了：

```
LiteLLM listening on http://127.0.0.1:4000
```

**保持这个窗口开着。**

## 四、验证

另开一个终端：

```powershell
cd ..
$env:PROBE_BASE="http://127.0.0.1:4000/v1"
$env:PROBE_KEY="sk-1234"
$env:PROBE_MODEL="meeting-chat"
$env:PROBE_STT_MODEL="meeting-transcribe"
node provider-probe.mjs
```

**六项全绿**才说明代理通了。（`max_completion_tokens` 和 `json_schema` 是两个服务商都不一定原生支持的，走 LiteLLM 会被翻译成各自认的形态。）

## 五、接到应用上

在 `meeting-agent/.env` 写：

```dotenv
OPENAI_API_KEY=sk-1234
MEETING_API_BASE=http://127.0.0.1:4000/v1
MEETING_MODEL=meeting-chat
MEETING_STT_API_BASE=http://127.0.0.1:4000/v1
MEETING_STT_MODEL=meeting-transcribe
MEETING_RESPONSE_FORMAT=json_object
```

`http://` 能过是因为 `src/agent/provider.ts` 的 `endpoint()` 显式放行了
`127.0.0.1` / `localhost` / `[::1]`，其他明文 HTTP 地址会被拒。

---

## ⚠️ 坑

### 1. 额度撑不住这个应用（最重要）

免费层大概 **10–15 请求/分钟**。而这个应用的设计是**持续理解会议**，默认
`MEETING_MIN_BATCH_MS=1500`、预算 `MEETING_MAX_CALLS_PER_HOUR=2400` —— 真实讨论中
调用频率会远超免费额度。

**更麻烦的是和应用的隔离机制叠加**：`docs/agent-workflow-runtime.md` 写了，
模型连续失败达到上限后会把**对应来源版本隔离**（quarantine），并且
「自动处理不擅自抹掉失败历史」。也就是说 429 打进来之后，
**来源会被标记成缺口，不是重试一下就恢复**，演示会静默降级。

> 建议：先用免费 key 跑通链路，**正式演示前开 billing**，或者把
> `MEETING_MIN_BATCH_MS` 调大（比如 8000–15000）压低调用频率。

### 2. 注意服务商的数据政策

各家对免费／付费层的数据使用政策不同，**别拿敏感的真实会议内容试**。

### 3. 模型名要对得上

`config.yaml` 用的是 `deepseek/deepseek-chat` 与 `openai/gpt-4o-transcribe`。
**以你账号实际可用的为准** —— 报错就查对应 provider 的 LiteLLM 文档。

### 4. 转写只取 `body.text`

本项目只需要 `body.text`。若你改用不返回词级时间戳的转写后端，
调 `response_format=verbose_json/srt/vtt` 会 400。

### 5. 用量统计会变成「未知」

应用读 `usage.type === 'tokens'` 来记账，LiteLLM 不统一返回这个形状，
于是降级为「用量未知」并**保守预留**额度。功能不受影响，只是小时预算算不准。

### 6. 多了一个进程

演示时 LiteLLM 必须一起起。这是这条路唯一的额外依赖。
