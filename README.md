# Meeting Agent

支持 macOS 与 Windows 的会议桌面助手。每场会议是独立事件，Agent 根据自然讨论选择、生成和修订简短的工作表达；用户按需查看、追溯、纠正和推演。

**进度入口：[当前状态](docs/status.md)；跨任务接手：[AGENTS.md](AGENTS.md) → [session 索引](docs/sessions/README.md)。** 已有 0.1.0 首版本地实现；首版结果见[验证记录](tests/results/validation.md)，后续工作树改动和新规范的接入程度以状态及对应 session 为准，不把旧测试视为当前全部通过。

当前工作树已接入连续 Agent 与新会议入口，架构见 [ADR-004](docs/adr/004-live-agent-pipeline.md)，工程证据见 [连续 Agent 验证](tests/results/live-agent-validation.md)。2026-09-12 Windows 本地已配置 DeepSeek V4.1 Flash 与 Whisper，并通过单条合成文本／语音的实际调用及桌面启动，见 [本地启动记录](docs/sessions/2026-09-12-windows-local-start.md)。这些检查不等于真实连续会议效果达标。

## 本地启动

需要 Node.js 22.12+ 和 npm。macOS、Windows PowerShell 使用相同命令：

```sh
npm ci
npm run setup:desktop
npm start
```

当前工作目录已安装依赖并下载运行时，可直接 `npm start`。启动只出现桌面小入口，不自动采音。悬停速览、点击打开工作页、右键菜单；关闭工作页保留后台服务，退出软件才结束。

```sh
npm run start:built   # 启动上次构建
npm test             # 领域、并发、隔离与架构依赖测试
npm run test:e2e      # 实际 Electron；需要图形桌面，会打开测试窗口
npm run test:stream   # 无外部调用的连续合成压力测试
npm run test:model    # 调用真实模型，无凭证时明确退出，不使用假输出
npm run format:check
```

## 配置模型与转写

开发运行：将 `.env.example` 复制为本目录 `.env`，填入自己的凭证并重启。打包应用也可读取用户数据目录中的 `provider.env`。文件只在可信进程读取，不进入前端或仓库。

```dotenv
OPENAI_API_KEY=你的凭证
MEETING_MODEL=gpt-4.1-mini
MEETING_API_BASE=https://api.openai.com/v1
MEETING_STT_MODEL=gpt-live-transcribe
MEETING_STT_API_BASE=https://api.openai.com/v1
```

这是可修改的默认配置，不保证账号具有对应模型权限。模型使用 Chat Completions JSON Schema；兼容服务不支持时可设置 `MEETING_RESPONSE_FORMAT=json_object`，服务仍执行本地 schema 校验。转写可单独设置 `MEETING_STT_API_KEY`。远端地址必须 HTTPS；仅本机回环地址允许 HTTP，供本地服务与测试使用。

`gpt-live-transcribe` 使用可信后台到 OpenAI Realtime 的 WebSocket：24 kHz PCM、约 100 毫秒采音包；按麦克风／电脑声音独立连接。工作页显示标为“暂定”的流式转写，只有最终文本入库并进入 Agent。停顿约 600 毫秒或累计 8 秒时提交当前段落，暂停／结束也提交尾音。密钥不进入采音窗口。显式设置 `whisper-1` 等文件转写模型仍使用旧 HTTP 路径；连接失败会提示并停止本轮采音，不静默换模型。更改配置后重启应用。此次实际接入和验证见 [流式转写记录](docs/sessions/2026-09-12-live-transcribe.md)。

缺STT凭证时正常开始会提示配置；缺理解模型凭证时不生成假内容。开发入口可独立测试文字、来源和保存；添加凭证后重启可恢复未处理输入。

## 使用闭环

1. 初次在 Settings 选择系统默认／指定麦克风，以及是否同时收听电脑声音。保存设置不录音。
2. 点击 Start meeting，一次意图创建会议并启动采集；操作系统仍可能要求授权。缺STT配置时进入设置，不创建假成功的会议。已有活动会议直接打开，暂停状态不会自动恢复。
3. 初始使用日期占位标题，Agent有依据后命名；点击标题可以手工改名，之后自动标题不会覆盖。原话持续进入，理解与复杂表达分别推进，页面默认自动跟随并标识局部变化。
4. 原话、来源、历史与处理详情按需打开。空会议没有提问框；有Agent内容后点击“Explore this／进一步讨论”才展开，草稿和问题依据保持原版本。个人探索不覆盖会议事实。
5. 参数试算由确定性计算器执行；会议条件改变时保留草稿基线，用户明确选择才采用新条件。会议决定仍需填写依据和确认范围。
6. 结束释放设备，已接受内容继续整理；重启只恢复内容，不自动录音。导出JSON保留原话和版本。

新安装默认跟随系统语言，中文系统使用简体中文，其余英文；设置可覆盖。新会议输出语言保存快照，不随界面设置漂移。旧偏好保守保留已有语言。

开发测试可在可信进程设置 `MEETING_DEV_INPUTS=1` 后重启，首页的 Development tools 才显示文字／synthetic replay入口。普通用户流程不显示这些模式，无凭证也不会返回假模型结果。

## Agent运行参数

配置示例见 `.env.example`：上下文24,000字节、单次输出2,500 tokens、每小时2,400次供应商调用／4,000,000文本tokens预算、批次合并1,500毫秒。额度是运行上限，不是承诺时延或价格。缺少用量数据会保守预留并标未知。流式转写在每段发出前检查调用预算，完成后记录该段音频秒数；连接握手限时10秒，每段从开始到完成限时30秒。每通道待完成音频累计上限30秒，WebSocket发送积压上限2MB，超限明确记录缺口。显式文件模型仍用约5秒切片与有界队列。

## 数据与平台

默认不落盘原始音频。原文、对象、产物修订、个人试算、确认记录和输入缺口保存到操作系统应用数据目录的 SQLite，不写入仓库或 iCloud 项目目录：

- macOS：`~/Library/Application Support/Meeting Agent/`
- Windows：`%APPDATA%/Meeting Agent/`

测试使用独立临时目录。数据未加密，随本机账号权限保护；尚无应用内删除功能，可在退出后由用户管理数据目录。供应商保留政策取决于实际账号，不能把本地不录音解释为云端零留存。

```sh
npm run pack:mac     # 在 macOS 构建应用目录
npm run pack:win     # 在 Windows 构建应用目录
```

本轮本地构建产物位于 `release/mac-arm64/Meeting Agent.app` 和 `release/win-unpacked/Meeting Agent.exe`。Windows 必须保留整个 `win-unpacked` 目录。当前是未签名的本地验证包，不是已签名安装器；Mac Intel、Windows ARM、签名、公证及安装器体验未验收。

## 文档入口与按需阅读

先读[状态页](docs/status.md)及[相关 session](docs/sessions/README.md)，再按 [AGENTS.md 的任务路由](AGENTS.md)进入产品定义、会议入口、表达语言、前端／语言、技术设计、契约、运行环境或验收。文档职责与冲突处理也在 AGENTS.md，不要求每个 session 通读全部文档。

当前前端视觉与页面入口：[style.md](docs/design/style.md) → [前端交互规范](docs/frontend-spec.md)。用户已认可新 8 图的整体风格；本地规范已整理，新风格代码接入待后续任务，旧第二张参考仅为历史。

文档修改后执行 `python3 scripts/check-docs.py`；它检查结构与链接，不验证产品行为。新增文件、目录职责或运行命令时同步相关 README，迭代结束前更新状态和 session。

设计文档定义目标；实际 schema 以 `src/contracts/model.ts` 为准，首版实现差异见 ADR-003；后续变化先查状态与对应 session／新 ADR，验证以对应版本结果为准。尚未通过的验收不会因“已有代码”自动变为通过。

本目录是独立 Git 仓库，对应 [Jeffreyliu0131/meeting-agent](https://github.com/Jeffreyliu0131/meeting-agent)（私有）。运行不依赖父目录资料。未提交工作须在对应 session 中说明。提交不包含凭证、真实会议数据、依赖目录或应用构建包。
