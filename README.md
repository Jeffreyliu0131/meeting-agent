# Meeting Agent

支持 macOS 与 Windows 的会议桌面助手。每场会议是独立事件，Agent 根据自然讨论选择、生成和修订简短的工作表达；用户按需查看、追溯、纠正和推演。

**当前：0.1.0 本地可运行实现。** 事件、桌面入口、双语界面、来源与修订、生成表达承接、可信试算和真实供应商适配器已实现。**本轮没有模型凭证，真实模型理解与真实会议语音仍未验收。** 测试替身仅用于验证程序，不作为模型结果。Windows 已作为同等架构目标，真机体验需要独立验证。

先看 [实际验证与限制](tests/results/validation.md)，架构取舍见 [ADR-003](docs/adr/003-cross-platform-first-version.md)。本次交付包含源代码、设计规范、合成测试与验收记录；构建产物只保留本地，不随源码上传。

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
npm run test:model    # 调用真实模型，无凭证时明确退出，不使用假输出
npm run format:check
```

## 配置模型与转写

开发运行：将 `.env.example` 复制为本目录 `.env`，填入自己的凭证并重启。打包应用也可读取用户数据目录中的 `provider.env`。文件只在可信进程读取，不进入前端或仓库。

```dotenv
OPENAI_API_KEY=你的凭证
MEETING_MODEL=gpt-4.1-mini
MEETING_API_BASE=https://api.openai.com/v1
MEETING_STT_MODEL=gpt-4o-transcribe
MEETING_STT_API_BASE=https://api.openai.com/v1
```

这是可修改的默认配置，不保证账号具有对应模型权限。模型使用 Chat Completions JSON Schema；兼容服务不支持时可设置 `MEETING_RESPONSE_FORMAT=json_object`，服务仍执行本地 schema 校验。转写可单独设置 `MEETING_STT_API_KEY`。远端地址必须 HTTPS；仅本机回环地址允许 HTTP，供本地服务与测试使用。

没有凭证时可创建事件、手工输入、查看和纠正原话、结束保存，但不会出现伪造的理解／生成结果。添加凭证后重启，可恢复处理已保存的输入，也可点重试。

## 使用闭环

1. 创建会议，选择文字、麦克风、系统声音＋麦克风或明确标注的合成回放，以及独立的输出语言。
2. 音频会议阅读处理说明后点 `Start input`。使用耳机进行线上会议；系统声音没有有效音轨时显示失败。应用启动和恢复历史不会自动录音。
3. Agent 持续处理来源，选取文字、对照、关系、时间安排、数值图或受控 SVG／HTML；固定外壳不规定业务内容。没有重要变化可不生成。
4. 查看来源、纠正原话／手工身份、请求比较或拆解。输入法组合期间 Enter 不发送。新版本保持待查看，避免打断阅读和草稿。
5. 明确关系下调整参数，由十进制计算器计算；保存为独立个人试算。记录会议决定另外要求依据、来源和确认范围。
6. 结束停止音源，已接收输入继续整理。事件可恢复、导出含原文与版本的 JSON。源文、译文和生成内容分别保存。

界面默认英文，设置中可改为简体中文；界面语言、当前会议输出语言、原始发言互不覆盖。未知发言人保留未知；手工归属不冒充声纹验证。

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

## 设计与工程阅读顺序

| 顺序 | 文档 |
|---|---|
| 1 | [AGENTS.md](AGENTS.md)、[产品定义](docs/product-definition.md)、[决策记录](docs/decisions.md) |
| 2 | [会议表达语言](docs/expression-language.md) |
| 3 | [前端规范](docs/frontend-spec.md)、[选定第二张参考](docs/design/assets/selected-editorial-reference.png) |
| 4 | [语言规范](docs/language-spec.md) |
| 5 | [当前架构取舍](docs/adr/003-cross-platform-first-version.md)、[技术设计](docs/technical-design.md) |
| 6 | [数据契约](docs/contracts.md)、[运行环境](docs/rendering-runtime.md) |
| 7 | [验收要求](docs/acceptance-criteria.md)、[实施计划](docs/implementation-plan.md)、[实际验证](tests/results/validation.md) |

设计文档定义目标；实际 schema 以 `src/contracts/model.ts` 为准，实现差异以 ADR-003 和验证记录为准。尚未通过的验收不会因“已有代码”自动变为通过。

本目录是独立 Git 仓库，对应 [Jeffreyliu0131/meeting-agent](https://github.com/Jeffreyliu0131/meeting-agent)（私有）。运行不依赖父目录资料。本轮保留接手时已有文档修改。提交不包含凭证、真实会议数据、依赖目录或应用构建包。
