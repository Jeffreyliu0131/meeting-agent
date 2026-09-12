# GPT Live Transcribe：Windows 本地验证

2026-09-12（Asia/Shanghai）。基线 `3f6279a` 加本轮未提交流式 STT 改动；关联 [session](../../docs/sessions/2026-09-12-live-transcribe.md)。Node 22.20.0、Electron 44.3.0、Windows；不覆盖 macOS 真机、真实会议或长时负载。

## 程序检查

- `npm run build`：TypeScript、后台打包及 Vite 构建成功。
- `npm test`：44项全部通过。新增覆盖 worklet 尾音冻结、流式暂定文本和最终文本分离、乱序完成与去重、连接失败缺口、不同音源隔离，以及最终音频时长记账。
- `npx playwright test`：8项全部通过，约1.1分钟。真实 Electron + 本地模拟协议／合成振荡器，不调用物理麦克风。新增流程覆盖正常开始、100ms左右音频包、暂定字幕、短尾音暂停、恢复新连接、结束后音轨释放与来源保存。原7项行为回归通过。
- 桌面测试复现并修复旧停止看门狗影响恢复后音轨的问题；冻结 worklet 后才刷新尾包，避免收尾后继续出包。Windows 测试清理原有 EBUSY 已通过等待 Electron 退出及有限重试修复，清理目标限制为本次测试的临时目录。
- 本轮修改的源文件、测试与 worklet 定向 Prettier 检查通过。全仓库 `format:check` 仍报告未修改文件的 CRLF 问题；抽查 `src/agent/context.ts` 当前内容 check=false、HEAD check=true，差异来自 Windows checkout 换行；未做无关全库格式重写。
- 文档结构／链接检查及 `git diff --check` 通过。密钥仅在 Git 忽略的 `.env`，没有进入源文件／测试报告。

## 实际供应商调用

OpenAI `/models` HTTP 200，可见 `gpt-live-transcribe`；`wss://api.openai.com/v1/realtime?intent=transcription` 实际收到 `session.updated`，接受24kHz PCM、中英输入提示和专用转写模型。

Windows TTS 生成24kHz单声道PCM16的一句合成音频，按100ms实时节奏发送，经本轮 `LiveTranscription` 类处理。从连接开始约2,274ms收到首个非空delta，总计6,951ms完成全部发送／收尾。最终文本为 “This is a synthetic test.” 和 “The meeting date is not confirmed.”，没有输入缺口。此数值仅为该次合成样本，不是p95或真实麦克风延迟承诺。

## 本地应用与未测范围

本地 `.env` 已切换 `MEETING_STT_MODEL=gpt-live-transcribe`；Agent仍为 `deepseek-flash`。重启前只读确认会议暂停且无待处理调用，重启后主窗口 `Meeting Agent` 响应正常（PID 16984），原3场会议保留，当前会议的26段原话保留且仍暂停；未自动录音。这里只核对数量和状态，不读取实际发言内容。

真实麦克风、中英混说／口音／噪声、线上双音轨、供应商长连接上限及断线恢复体验、长会议负载、macOS真机均未验收。当前连接失败会记录缺口并停止本轮采音，由用户恢复创建新连接；不透明自动重放或换模型未实现。逐词时间与说话人识别不由该模型提供，来源时间是本机采集区间，身份保持未知。
