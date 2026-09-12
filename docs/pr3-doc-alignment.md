# PR #3：业务内容、文档差异与整合门槛

核对时间：2026-09-12 13:45（Asia/Singapore）。[PR #3](https://github.com/Jeffreyliu0131/meeting-agent/pull/3) 当时为 OPEN，分支 YH，精确提交 `0cc0db021482f46900e7e51a3da8699cbbed9def`；本地已提交 main 为 `596c8b7`。本文是该版本的对照基线，不是实时合并状态。后续修复与交付查[修复任务](sessions/2026-09-12-pr3-fix-merge.md)及[状态页](status.md)。

## 对齐结论与范围

PR 新增可选的投票、分工、冲突、决定确认四类协作组件，以及 GPT Live Transcribe 输入适配。业务方向可与 `meeting-event-generative-v3` 共存；原版 PR 的异常闭环和部分文档状态尚不一致，不能仅凭无 Git 冲突或普通测试通过宣布可交付。

普通会议仍支持个人按需查看、Agent 自主生成表达和个人推演；只有主动开启本地协作模拟，才增加发起者检查发放、模拟参与者回应的流程。固定 schema 约束有业务操作的四类组件，不把通用表达改成固定模板，不赋予语音或模型发布、代投、代接受或记录决定的权限。范围依据为 PR 内保留的[设计与实施记录](https://github.com/Jeffreyliu0131/meeting-agent/blob/0cc0db021482f46900e7e51a3da8699cbbed9def/docs/sessions/2026-09-12-collaboration-implementation.md)，本轮另有用户明确确认核对该 PR、更新本地 MD。

## 业务步骤与实际实现对应

下表“PR 实现”只指上述精确提交；本地 `596c8b7` 尚未包含这些新增模块。路径用于合并时定位，不表示文件已在本地主分支存在。

| 业务步骤 | PR 实现与代码定位 | 与现行要求的关系／缺口 |
|---|---|---|
| 收到音频 | `capture.ts`／`pcm-worklet.js` 约 100ms 输出 24kHz PCM；`live-transcription.ts` 在后台按会议、epoch、音源隔离连接 | 麦克风与电脑声音仍分别验收；仅模型切换不证明真实音源已可用；原 PR 首包丢失见 G1 |
| 看到即时文字 | `Snapshot.liveTranscripts` 展示暂定文字，最终结果按 item_id 对齐，经 `completeAudio` 入库 | 暂定文字不写会议事实、不触发 Agent；保留已有来源版本和未知身份规则 |
| 理解协作意图 | M 理解提交后，`collaboration-runtime.ts` 调度 C 草稿准备、R 冲突影响分析 | 普通表达及个人推演沿用既有路径；无协作意图不调 C；原话“开始／我同意”不等于操作授权 |
| 准备与查看 | C 只提交私有草稿；`ui/collaboration/Panel.tsx` 在独立悬浮窗预览，球显示 ready 数量，工作页保留索引 | Agent 准备好不抢焦点；关闭组件窗不取消组件、不停止会议；与当前正文＋窄原话边注布局一起回归 |
| 发放组件 | 发起者确认版本、受众及可公开依据后，通过可信命令发放；公开轮冻结内容与范围 | 仅协作组件要求发放，普通会议内容无需等主持人；未授权共享的私有理由不进入参与者视图 |
| 收集回应 | 参与者身份由可信窗口绑定；本人回应版本控制改票、接受或确认，领域规则确定性统计 | 模拟 A/B/C 不等于真实人员认证；投票结果不等于决定，展示分工不等于接受任务 |
| 处理异议与修订 | R 先检查明确区间重叠等规则，必要时做语义分析；选方案先生成修订草稿，再检查发放 | 新公开版本不能继承旧同意；原 PR 新版同意后旧异议未重算，见 G3；推测冲突仍需确认 |
| 记录决定 | 同一公开版本、指定范围逐人明确同意，由发起者记录；服务检查来源和分析进度 | 原 PR 未阻断已知输入缺口，见 G2；有保留、未回应或未决异议不能写成共识 |
| 结束与恢复 | 停止采音后提交尾音并等待已接受结果；关闭开放协作轮；SQLite 保存组件、回应、决定、事件和任务 | 重启不自动录音；协作决定尚未统一到旧产物决定／导出格式，不能宣称导出闭环完整 |

## 与本地及 PR 正文的差异

| 发现的表述差异 | 对齐后的口径 | 维护位置 |
|---|---|---|
| 本地把所有共享笼统列为后置；PR 新增四组件 | 可选本地协作已进入本次整合范围；跨机器共享、认证及外部系统同步仍后置 | [产品定义](product-definition.md)、[决策](decisions.md) |
| PR 产品定义／COL01 写“尚未实现”，同一提交的运行说明与测试已记录核心实现 | 设计、分支实现、本地整合、包同步和真实验收分别说明；合并时删除这两处过期的“尚未实现”，保留设计与实现差距 | PR `product-definition.md`／`decisions.md`；本地使用本文与修复记录区分状态 |
| 本地实施计划还以 `3f6279a`／`a587a92` 为接续版本，W1–W6 仍写进入验收 | 它们为历史阶段；工作流已随 `9b6886d` 交付，本次读到本地 HEAD 为 `596c8b7`；PR 与本地未提交改动分别整合 | [实施计划](implementation-plan.md)、[状态页](status.md) |
| 本地 README／ADR 仍将 5 秒 HTTP 切片作为唯一当前路线 | `596c8b7` 的旧路线仍属实际基线；PR 默认改为 Live，显式配置文件模型保留 HTTP，失败不静默换模型；合并后按实际代码统一配置与生命周期正文 | [README](../README.md)、[技术设计](technical-design.md)、[ADR-004](adr/004-live-agent-pipeline.md) |
| 本地笼统写“真实模型／转写凭证缺失” | 首版当时缺失；PR 保留 Windows 上 DeepSeek／STT 单次合成实调证据，不能推导当前 Mac 已配置或真实会议效果通过 | 本页证据表、[状态页](status.md)、[README](../README.md) |
| 通用前端／契约未说明组件、暂定文本及旧决定导出缺口 | 增加 PR 整合说明；四组件、可信身份与操作、暂定／最终文本分离都可追踪；旧决定导出统一仍待办 | [前端](frontend-spec.md)、[契约](contracts.md)、[验收](acceptance-criteria.md) |

## 合并前必须关闭的缺口

以下为已复现问题及整合要求，不是本轮重新运行测试的结论。G1–G3 已交由[修复任务](sessions/2026-09-12-pr3-fix-merge.md)处理；具体完成与新证据只能由修复记录确认。

| 门槛 | 原版证据／风险 | 关闭所需证据 |
|---|---|---|
| G1 流式首包与收尾 | 异步调用池授权被当成同步；合成两包共 9,600 字节，服务只收到后包 4,800 字节，首包 accepted=false | 经真实服务调用池验证延迟授权仍按序完整发送；暂停／结束排空尾包；超时、取消、溢出显式缺口；不换掉 Live 规避问题 |
| G2 已知输入缺口与决定 | 已有 1 条 inputGap，记录决定仍成功；只等已收 final 的分析水位不代表输入完整 | 发放／冻结收集／记录决定的门槛覆盖 pending audio、已知缺口与分析欠账，UI 告知原因；没有已实现的明确缺口处置流程时不得静默越过 |
| G3 新轮回应后的冲突重算 | 最新回应已为 agree，旧 participant_objection 仍 unresolved，记录报 UNRESOLVED_CONFLICT | 反对→修订→重新发放→本人同意→重新分析闭环通过；有效的新异议仍保留；旧票不迁移、不由发起者代撤回 |
| G4 本地成果整合 | PR 相对本地已提交基线增加 5 提交、改 71 文件；另有本地会中精修、试算依据和规则文档 | 保留提醒、即时设置、正文／原话边注、试算保存值与误报修复；解决共享文件冲突后验证整合构建，不能沿用分支单独通过的结论 |
| G5 双端与文档交付 | PR 报告明确未替换日常 release 包；分支文档的“完成”只覆盖其测试范围 | 同一最终源码构建 Windows x64／macOS arm64 本地包，核对共享指纹；各端运行、语言和平台能力分别记录；正文和状态随最终基线更新 |

G1–G3 原反例已在本轮读取既有日志并核对精确源码；可接续的事实摘要如上，不依赖临时测试目录存在。实际修复后的测试须进入仓库结果记录并链接本页。

## 保留在项目计划中的未完项

这些事项不因本次文档对齐或 G1–G3 修复而自动完成：

- 跨设备共享／身份认证不在本次首版范围；当前只有同机、绑定窗口的角色模拟。
- 协作表单完整中英切换、窄窗、屏幕阅读器及与会中精修的视觉整合仍须验收；既有完整双语目标继续有效。
- 逐项删除保护（tombstone）和可比较修订的专用 diff、候选依赖拓扑、同义建议忽略策略尚未完整接入。
- 每根事件任务上限后的后台续跑、前沿等待列表／取消入口、更细的 R 读集仍有差距。
- 协作决定与旧 `Meeting.decisions`／导出格式未统一；会后查看与导出不能笼统宣布完整。
- 60 段真实模型意图评估未执行；真实麦克风、线上双音轨、中英混说、长连接及成本／时延仍需对应场景证据。62 项协作矩阵是覆盖表，包含部分覆盖和未验证，并非 62 项全部通过。

## 证据范围与原文入口

| 证据 | 观察／报告范围 | 不能推导的结论 |
|---|---|---|
| [PR 精确运行说明](https://github.com/Jeffreyliu0131/meeting-agent/blob/0cc0db021482f46900e7e51a3da8699cbbed9def/docs/collaboration-v1-runtime.md)及[实现报告](https://github.com/Jeffreyliu0131/meeting-agent/blob/0cc0db021482f46900e7e51a3da8699cbbed9def/tests/results/collaboration-v1-validation.md) | 分支报告 133 单元；Electron 首次 24/25，旧设置按钮适配后单项通过，合计 25 项有通过证据 | 不是首次全量 25/25，也不是本轮复测；不覆盖后续修复和本地整合 |
| [独立审查交接](sessions/2026-09-12-pr3-fix-merge.md) | 修复前 PR 的 133 单元、3 项 Electron 和构建通过；追加三个反例失败 | 正常测试通过不能抵消反例；本轮只读取既有结果 |
| [Windows 供应商启动记录](https://github.com/Jeffreyliu0131/meeting-agent/blob/0cc0db021482f46900e7e51a3da8699cbbed9def/docs/sessions/2026-09-12-windows-local-start.md) | 旧 Windows 基线实际调用 DeepSeek 与 Whisper，输入为合成文本／TTS | 不证明完整会议、此 Mac 配置或当前整合包已验收 |
| [Live Transcribe 验证](https://github.com/Jeffreyliu0131/meeting-agent/blob/0cc0db021482f46900e7e51a3da8699cbbed9def/tests/results/live-transcription-validation.md) | Windows 合成语音实调；约 2.274 秒首次非空 delta，为单次样本 | 不是延迟分位数、真实麦克风／多人质量或全链路首包正确性的证明 |

完整分支目标：[协作设计](https://github.com/Jeffreyliu0131/meeting-agent/blob/0cc0db021482f46900e7e51a3da8699cbbed9def/docs/collaboration-v1-design.md)、[设计契约](https://github.com/Jeffreyliu0131/meeting-agent/blob/0cc0db021482f46900e7e51a3da8699cbbed9def/docs/collaboration-v1-contracts.md)、[专项实施计划](https://github.com/Jeffreyliu0131/meeting-agent/blob/0cc0db021482f46900e7e51a3da8699cbbed9def/docs/collaboration-v1-implementation.md)、[62 项验收](https://github.com/Jeffreyliu0131/meeting-agent/blob/0cc0db021482f46900e7e51a3da8699cbbed9def/docs/collaboration-v1-acceptance.md)。源码：[流式转写](https://github.com/Jeffreyliu0131/meeting-agent/blob/0cc0db021482f46900e7e51a3da8699cbbed9def/src/integrations/live-transcription.ts)、[会话服务](https://github.com/Jeffreyliu0131/meeting-agent/blob/0cc0db021482f46900e7e51a3da8699cbbed9def/src/service/session.ts)、[协作领域规则](https://github.com/Jeffreyliu0131/meeting-agent/blob/0cc0db021482f46900e7e51a3da8699cbbed9def/src/domain/collaboration.ts)。均固定到审查提交，避免后续分支更新改变本次引用含义。

本轮维护与验证见[文档对齐交接](sessions/2026-09-12-pr3-doc-alignment.md)。本文只完成本地内容对齐，没有修改产品代码、供应商配置、应用包或 Git 远端。
