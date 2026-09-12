# 数据与操作契约

首轮协作意图的实际新增协议为Proposal.collaboration和Meeting.collaboration；候选、白名单草稿命令、finality与持久化边界见[意图契约说明](collaboration-intents.md)。

> 文件职责：产品／工程设计要求，不是完成清单。当前进度与最新修订见[状态页](status.md)；已交付首版取舍见[ADR-003](adr/003-cross-platform-first-version.md)，实际结果见[验证记录](../tests/results/README.md)。具体实现以代码核对，未实现的要求仍是目标。
版本0.1｜业务设计契约。下面的TypeScript是设计示意；实际运行时 schema 与类型见 `src/contracts/model.ts`，需按当前状态核对差异。本文件定义业务职责，不将具体库写成不可替换前提。

启动意图、持久化设备／语言偏好、自动标题版本与渐进提问上下文的最新增补见[会议入口规范](meeting-entry-spec.md)。上述入口契约已接入；前端实现与本地应用更新见[前端交接](sessions/2026-09-11-frontend-refresh.md)。下文的抽象类型示意仍须与实际schema区分，不能把示意字段全部当作已落库。


## 当前实现与验证边界（2026-09-12工作树）

当前工作流采用[ADR-005](adr/005-bounded-agent-workflows.md)，详细实际契约见[运行时说明](agent-workflow-runtime.md)。本文后面的抽象类型仍是设计示意，不能当作全部已实现字段。

| 能力 | 当前实际实现／边界 |
|---|---|
| 理解与生成 | 实时／个人LangGraph图，互斥artifact／patch／plan，复杂表达独立处理 |
| 服务分配ID | 新对象／关系批内引用映射为服务UUID；旧对象ID保持；不等于语义自动去重 |
| 可信提交与任务 | 持久job／proposal／success表、可信read set、请求hash、fence和有界恢复；领域与结果同事务 |
| 检索与记忆 | 真实本会议工具分支、版本读取、独立轻量索引和覆盖标记；非外部RAG，不承诺无限长会 |
| 个人推演 | 发送时冻结基线、独立锁／取消／预算、对象版本标签与基线变化提示 |
| 表达修复 | RenderReport反馈、一次受预算约束的定向修复、内容／公式／来源保持、候选持久化 |
| 数值 | Decimal及符号单位校验、引文basis、可选可信计算绑定；语义依据仍需人工验收 |
| 平台与真实效果 | 合成程序结果见[验证](../tests/results/agent-workflow-validation.md)；真实模型／音源、Windows实机未验收 |

## 当前可靠性契约

运行时新增 meaning／changeSources、对象 dependencyRefs／reviewRequired／objectHistory 和 Meeting.closeout；旧格式保守兼容，含义和迁移边界见[可靠性规范](agent-reliability.md)。会议理解投影不含个人假设；个人产物和 request 来源不能用于直接记录会议决定。

## 1. 核心对象

| 对象 | 作用 | 关键规则 |
|---|---|---|
| MeetingEvent | 一场会议的独立容器 | 有标题、时区、生命周期、来源、全局revision |
| Segment | 一段输入的某个版本 | 原文、真实来源、身份依据、顺序与时间分开 |
| IdentityMapping | 声音／账号与人物映射 | 有依据、范围和revision，允许unknown |
| MeetingObject | 话题、主张、方案、约束、风险、问题、任务、里程碑 | 稳定ID、版本、来源和状态 |
| Relation | 对象间语义关系 | typed edge，保留证据与推断状态 |
| ExpressionPlan | 一次表达意图 | 回答的问题、载体、结构、依赖、动作 |
| Artifact / ArtifactRevision | 生成的工作产物及不可变版本 | 原始描述／代码、依赖、绑定、校验状态，不代替业务事实 |
| UserPreferences / MeetingLanguage | 界面偏好与会议表达配置 | UI locale与输出locale分开；来源不翻译覆写 |
| Scenario | 独立条件分支 | 固定基础快照和覆盖条件，不能静默跟随最新事实 |
| Decision | 个人／会议范围的确认记录 | 不可变，记录确认来源和范围；修订另建记录 |

## 2. 输入与证据

```ts
type IdentityLevel = 'verified' | 'clustered' | 'unknown';
type SourceKind = 'microphone' | 'system_audio' | 'platform_transcript' | 'replay' | 'manual';
type Segment = {
  meetingId: string; sourceId: string; sourceKind: SourceKind;
  sourceEpoch: number; channelId: string | null;
  segmentId: string; revision: number; sourceOrder: number;
  text: string; stability: 'partial' | 'stable';
  startMs: number | null; endMs: number | null; receivedAt: string;
  speakerRef: string | null; identityLevel: IdentityLevel;
  identityMappingId: string | null; synthetic: boolean;
};
type SourceRef =
  | { kind: 'segment'; sourceId: string; sourceEpoch: number; segmentId: string; revision: number }
  | { kind: 'user_command'; commandId: string }
  | { kind: 'tool_result'; resultId: string; inputRefs: string[] };
type Provenance = {
  origin: 'stated' | 'agent_inferred' | 'user_entered' | 'tool_computed';
  status: 'unverified' | 'assumed' | 'disputed' | 'unknown' | 'confirmed';
  sources: SourceRef[];
};
```

唯一输入键：`meetingId + sourceId + sourceEpoch + segmentId + revision`。相同文字不意味着同一发言。匿名分组标签按事件／通道标定，不能默认跨会议识别同一个人。

`confirmed`不表示现实世界已核实或全体同意；确认范围由对应Decision提供。不能从`stated`自动转成会议事实。内部平台原始标识不直接进入生成内容。

## 3. 对象与关系

```ts
type ObjectKind = 'topic' | 'claim' | 'option' | 'constraint' | 'risk' |
  'question' | 'task' | 'milestone';
type MeetingObject = {
  id: string; meetingId: string; kind: ObjectKind; rev: number;
  title: string; data: Record<string, unknown>; provenance: Provenance;
  speakerRefs: string[]; lifecycle: 'active' | 'superseded' | 'archived';
};
type Relation = {
  id: string; meetingId: string; fromId: string; toId: string; rev: number;
  kind: 'depends_on' | 'supports' | 'challenges' | 'conditions' |
        'part_of' | 'alternative_to' | 'supersedes';
  provenance: Provenance;
};
```

`data`按kind校验具体联合类型，不能实际实现成无限制JSON：task保留内容、负责人依据和状态；milestone保存日期原表达、解析时区、日期／时间精度与不确定性；option保存条件和比较维度；claim保存短陈述与完整限定词。无日期不补日期，无负责人不凭声音猜姓名。

首版不维护人物性格、隐含动机或自动政治立场等推断。对象归属按发言内容来源记录，姓名只是可修正的附加映射。

## 4. 表达计划和产物

```ts
type Carrier = 'text' | 'table' | 'diagram' | 'svg' | 'chart' | 'html';
type RefVersion = { id: string; rev: number };
type ExpressionPlan = {
  planId: string; meetingId: string;
  outputLocale: 'en' | 'zh-CN'; languageRevision: number;
  visualProfileId: 'collaborative-light-v2';
  action: 'no_change' | 'patch_artifact' | 'create_artifact' |
          'propose_restructure' | 'request_clarification';
  targetArtifactId: string | null;
  purposeKey: string; userQuestion: string;
  objectRefs: RefVersion[]; relationRefs: RefVersion[];
  carrier: Carrier | null; structureIntent: unknown;
  allowedActions: ArtifactAction[];
  sourceRefs: SourceRef[]; rationaleShort: string;
};
type ArtifactAction =
  | { id: string; type: 'open_source'; sourceRefs: SourceRef[] }
  | { id: string; type: 'expand'; objectIds: string[] }
  | { id: string; type: 'request_compare'; objectIds: string[] }
  | { id: string; type: 'request_scenario'; inputSchemaId: string }
  | { id: string; type: 'request_correction'; objectIds: string[] };
type ArtifactRevision = {
  artifactId: string; meetingId: string; revision: number; generation: number;
  locale: 'en' | 'zh-CN'; languageRevision: number;
  visualProfileId: 'collaborative-light-v2';
  carrier: Carrier; payload: unknown; schemaVersion: number;
  objectRefs: RefVersion[]; relationRefs: RefVersion[]; sourceRefs: SourceRef[];
  bindings: Array<{ elementId: string; objectId: string; actionIds: string[] }>;
  validation: { syntax: boolean; semantics: boolean; rendering: boolean };
  createdByJobId: string;
};
```

`structureIntent`按载体生成schema：文字层次、表格维度、图形节点边、SVG布局意图、chart编码或HTML区域与交互说明。`payload`以carrier作为判别联合；不得不经校验就直接注入DOM。

`no_change`与`request_clarification`允许carrier和structureIntent为null，不创建生成任务；澄清内容作为question对象或单独clarification结果返回。生成类动作必须有非空载体与通过校验的结构，不能让无变化批次也生成占位产物。

候选依赖由可信服务解析：新对象的临时ID映射为实际ID，同批被修改对象绑定到提交后的revision；模型自报版本不直接用于产物有效性判定。生成器使用这一份已规范化计划与快照。

每种载体的最小payload建议如下，开发时需落实为运行时schema：

| carrier | 必需字段 | 基本校验 |
|---|---|---|
| text | blocks：稳定id、kind、text、sourceRefs | kind限制标题／短段落／列表；文本按数据渲染 |
| table | columns：key／label／unit；rows：id／cells | cell保留value、状态和来源；禁止编造空单元格数值 |
| diagram | engine、definition、elementMap | 只启用已支持engine；elementMap绑定对象／关系；语法和语义分别校验 |
| svg | markup、viewBox、elementMap | 有限尺寸、允许标签／属性、唯一元素ID、无外部资源 |
| chart | engine、spec、datasets、dataSources | 数据为内联可信投影，轴单位齐全，转换和表达式受限 |
| html | markup、styles、script可空、inputs、elementMap | 资源与行为限制；input有稳定ID、schema、初值和试算归属 |

共同内容：sourceRefs、actionIds、依赖revision由产物外壳持有。复合HTML可包含图形和表格，但每个事实元素仍有绑定；不能用HTML包裹来绕过来源要求。

Agent可以设计新组合，应用不提供“特定会议模板ID”要求它填数。新建通过会议＋目的＋对象角色定位；`purposeKey`要经服务校验，不能因每批随机改名创建重复产物。可并存有不同目的的同对象产物，例如解释与试算。

固定模板版本与产物身份分离；同用途内容变化通常生成同一artifact的新revision。已保存revision不原地覆盖，供恢复和对比。

同一artifact可保留不同locale的表示，均链接相同业务对象与来源。语言切换递增会议languageRevision，不增加虚假的语义变化；提交检查语言配置与对象版本。UI语言单独保存在UserPreferences，设置选择后通过既有preferences命令立即提交；合并已保存偏好，不带入其他设置草稿，不触发整场理解。字段与并发规则详见[语言契约](language-spec.md)。

## 5. 操作契约与事务

可信命令：`commandId, meetingId, actorContext, requestHash, origin, readSet, segmentReadSet, operations`。`actorContext`由服务或认证UI上下文提供，不能由模型／HTML自填。

语义提案可以包含`upsert_object, upsert_relation, supersede_object, record_question, propose_decision`。新对象用临时ID引用，事务内映射到服务分配的ID。产物计划与对象提交关联，但慢生成不在事务里。

用户命令包括`correct_source, correct_identity, create_scenario, update_scenario, save_personal_choice, record_meeting_decision, stop_capture, export_meeting`。显式改变身份和来源必须保留修订链。

事务依次：校验身份／会话状态 → 查幂等ID和请求哈希 → 校验read set与输入revision → 应用合法操作 → 递增受影响revision → 落命令结果／job → 提交后推送。

同批次仅允许一个成功语义提交。冲突重理解用新attempt与新commandId，仍检查该批次是否已应用；源段落新revision为独立修订处理，不误作普通重复。

## 6. Scenario与Decision

Scenario保存`id, meetingId, baseObjectRefs, baseSnapshot, overrides, assumptionRefs, toolResults, owner, rev`。覆盖值标明来源和假设；改变日期和数字不会改原话。基础对象修正后显示过期，用户选择重基或保留旧基线；不静默刷新。

Decision保存`id, scope: personal|meeting, targetSnapshot, evidenceRefs, confirmedBy, confirmationBasis, affectedParticipants, createdAt, supersedesDecisionId`。个人采用自己的试算只能建立personal。meeting要求明确会议级确认依据与范围；应用操作者不是天然代表所有人。

## 7. 内部接口

| 接口 | 输入 | 输出／副作用 |
|---|---|---|
| `TranscriptAdapter.start/stop` | sourceConfig、captureEpoch | Segment／SourceStatus流；释放资源 |
| `ingestSegment` | Segment | 去重落库、修订依赖、调度理解 |
| `interpretBatch` | 段落与版本、上下文、产物索引 | SemanticDelta＋ExpressionPlan |
| `executeCommand` | 可信命令 | 应用结果／冲突／拒绝 |
| `generateArtifact` | ExpressionPlan、对象投影 | 候选ArtifactRevision |
| `validateAndPreview` | 候选产物 | 可见错误、可读性检测、预览结果 |
| `commitArtifact` | 产物、read set、generation | 新可用revision或过期结果 |
| `evaluateScenario` | 明确公式／条件、基础快照 | known／conditional／unknown＋依据 |
| `getMeetingSnapshot/subscribe` | 会议ID、可见范围／revision | 一致快照与增量通知 |

本地原型用IPC，不强制先实现公网HTTP和OAuth。未来云端适配这些接口时再定义网络鉴权，不把本机IPC当网络安全保证。

## 8. 错误与恢复

统一错误`code, message, retryable, affectedIds, traceId`，不暴露密钥或完整原始会议。

主要code：`SOURCE_UNAVAILABLE, IDENTITY_UNKNOWN, MODEL_UNAVAILABLE, INVALID_PROPOSAL, REV_CONFLICT, SOURCE_SUPERSEDED, INVALID_ARTIFACT, RENDER_FAILED, RENDER_TIMEOUT, INPUT_UNKNOWN, PERMISSION_DENIED, STORAGE_FAILED`。

`IDENTITY_UNKNOWN`是提示性状态，基础理解继续。其他错误按模块恢复，不能统一成“Agent正在思考”。未保存成功就不能显示“已保存”。


## 连续 Agent 实际协议（本轮接入）

实际schema见 `src/contracts/model.ts`，工作流见 [ADR-004](adr/004-live-agent-pipeline.md)。Proposal增加互斥的patch／plan与有来源的titleProposal；来源增加输入version、采集起止时间、通道序号与可选requestContext。Meeting保存processedSources、独立expressionJobs、调用账目、标题来源／修订、音频偏好快照与实际设备。Preferences保存system语言选择与audio设置，旧数据保守迁移。

桌面startMeeting意图由可信层解析设置、幂等创建与启动采集。个人请求保留绑定产物revision，生成个人对象不覆盖会议语义。历史产物仍为完整不可变快照，增量传输使用按块patch；来源／对象／关系依赖决定过期，普通新增发言不自动让无关内容过期。
