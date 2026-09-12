# 首版协作组件：数据、命令与事件契约

版本：`collaboration-v1 / schema-1`。状态：目标设计契约。首版Zod与SQLite已接入，实际字段／命令及尚未覆盖的设计项见[运行说明](collaboration-v1-runtime.md)。

上级：[完整设计](collaboration-v1-design.md)。验收：[场景与门槛](collaboration-v1-acceptance.md)。下面TypeScript为有界契约示意，实施须转成严格判别联合、JSON Schema和交叉字段校验；不能把类型检查误作运行时授权。

## 1. 归属与版本

- `componentId`：同一个协作目的的长期身份；`revision`：每次内容修改递增的不可变版本。
- `publishedRevision`：当前可见／可回应的内容版本；每次发布替代版建立新的回应轮。
- `aggregateVersion`：命令排序／并发用，发布、回应、截止、失效均递增；不能用它替代内容版本。
- `responseVersion`：某参与者某subject的回应版本，提交修改以自己的版本作乐观锁。
- `schemaVersion`：协议结构版本；`rendererVersion`：组件实现版本。它们都不表示业务内容变化。
- `sourceRefs`／`objectRefs`：有版本的依据。所有新ID由服务分配，模型仅可提供批内临时引用。
- `Component`是当前控制状态；`ComponentRevision`是不可变内容；`PublishedRound`是发布范围和截止快照。三者分开，准备新草稿不改变正在回应的旧轮。

## 2. 基础类型与统一外壳

```ts
type Id = string; // 服务UUID；外部输入最大100字符
type ISOTime = string; // UTC ISO8601，服务解析验证
type Ref = { id: Id; rev: number }; // 对齐现有src/contracts/model.ts的Ref
type Family = 'poll' | 'assignment' | 'conflict' | 'decision_confirmation';
type SourceRef =
  | { kind: 'segment'; ref: Ref }
  | { kind: 'command'; commandId: Id }
  | { kind: 'response'; responseId: Id; responseVersion: number }
  | { kind: 'rule_result'; resultId: Id }
  | { kind: 'component_result'; componentId: Id; publishedRevision: number };
type Evidence = {
  refs: SourceRef[];
  origin: 'stated' | 'user_entered' | 'agent_inferred' | 'rule_computed';
  certainty: 'known' | 'conditional' | 'unknown';
};
type Participant = {
  id: Id; meetingId: Id; displayName: string;
  role: 'host' | 'participant'; identityBasis: 'local_simulation';
  active: boolean;
};
type Content =
  | { kind: 'poll'; payload: PollPayload }
  | { kind: 'assignment'; payload: AssignmentPayload }
  | { kind: 'conflict'; payload: ConflictPayload }
  | { kind: 'decision_confirmation'; payload: ConfirmationPayload };
type ComponentRevision = Content & {
  componentId: Id; meetingId: Id; revision: number; schemaVersion: 1;
  title: string; locale: 'zh-CN' | 'en'; rendererVersion: 1;
  objectRefs: Ref[]; sourceRefs: SourceRef[];
  fieldEvidence: Array<{ fieldPath: string; evidence: Evidence }>;
  manualLocks: string[]; // 白名单字段路径；不得锁权限、来源和服务统计
  createdBy: { kind: 'host'; participantId: Id } | { kind: 'agent'; jobId: Id };
  baseRevision: number | null; createdAt: ISOTime;
};
type Component = {
  id: Id; meetingId: Id; family: Family; topicRef: Ref | null;
  purposeKey: string; hostId: Id; aggregateVersion: number;
  draftRevision: number | null;
  draftState: 'draft' | 'collecting' | 'ready' | 'cancelled' | null;
  publishedRevision: number | null;
  needsReview: boolean;
  requiredAnalysisSequence: number; validatedAnalysisSequence: number;
  missingFields: Array<{ path: string; reason: string; blocks: 'publish' | 'response' | 'none' }>;
  collection: CollectionSession | null;
};
type PublishedRound = {
  componentId: Id; revision: number;
  status: 'open' | 'closed' | 'cancelled' | 'superseded';
  audienceIds: Id[]; audienceSnapshot: Array<{ id: Id; displayName: string }>;
  visibility: 'identified'; // 首版不提供匿名模式
  sharedEvidence: Array<{ sourceRef: SourceRef; excerpt: string; disclosedBy: Id }>;
  responseGate: 'open' | 'blocked'; reviewReasons: string[];
  publishedBy: Id; publishedAt: ISOTime;
  closesAt: ISOTime | null;
  closedAt: ISOTime | null;
  closeReason: 'host' | 'deadline' | 'meeting_ended' | 'recorded' | null;
  supersedesRevision: number | null;
};
type CollectionSession = {
  id: Id; componentId: Id; topicRef: Ref | null; scopeText: string;
  startAfter: SourceRef; includedHistory: SourceRef[];
  consumedRefs: SourceRef[]; excludedObjectIds: Id[];
  fieldTombstones: Array<{ fieldPath: string; entryId: Id; commandId: Id }>;
  status: 'collecting' | 'freezing' | 'stopped';
  freezeWatermark: SourceRef[] | null; coverage: 'complete' | 'partial';
};
```

UI主状态由draftState与当前PublishedRound派生，不用一个字段同时表示“旧轮开放”和“新草稿准备中”。CollectionSession的大量来源ref用关联表／分页读取，不作为每次完整模型上下文。输入覆盖complete只针对明确冻结的来源集合，不表示整场会议或尚未转写音频已完整。

统一结构限制：title 1–120字，普通描述0–1000字；单组件payload序列化≤32KB；引用ID须存在且同会议／可见；字段路径来自各组件白名单，禁止原型路径、任意代码、HTML、CSS、工具名称或URL行为。最多10个受众，至少1个；单会议最多4个collector。来源多于单次上下文上限时分页，不截断后声称完整。

同family可有空缺草稿，缺项用null／空数组表示，不能造默认人物和日期。`ready`须通过对应发布门槛，所以下述类型允许的草稿空值不等于发布时合法。校验器返回结构化missingFields供UI显示。

## 3. 意图与提案schema

```ts
type Operation = 'prepare' | 'update' | 'preview' | 'publish' | 'respond'
  | 'close' | 'cancel' | 'propose_resolution' | 'apply_resolution' | 'record_decision';
type IntentCandidate = {
  localId: string; family: Family; operation: Operation;
  expression: 'explicit' | 'suggested' | 'negated' | 'hypothetical' | 'quoted';
  resolution: 'actionable_draft' | 'suggestion' | 'needs_clarification' | 'no_action';
  target: { componentId: Id; revision: number } | null;
  topicRef: Ref | null; referencedObjects: Ref[]; evidence: SourceRef[];
  collectionMode: 'retrospective' | 'prospective' | 'none';
  scopeText: string; missingSlots: string[];
  dependsOnLocalIds: string[]; // 批内操作依赖，必须无环
};
type CollaborationProposal = {
  intents: IntentCandidate[]; // 最多4个，空数组是正常结果
  coverage: 'complete' | 'partial'; unprocessedRefs: SourceRef[];
};
```

IntentCandidate是模型候选，不是Command。expression为negated／hypothetical／quoted时不可转成写操作。证据和目标不足时先ME补证据，仍不足进入CQ澄清。publish／respond／apply_resolution／record_decision不能从候选直接执行；可信UI分别生成相应命令。

`prepare`、`update`可以由已校验语义候选产生私有草稿。`preview`只改变host选择状态。`cancel`语音仍待host操作，不自动删除已收集内容。模型不得自填actorContext、audienceSnapshot、publishedAt、counts或确认状态。

## 4. 投票payload、回应与结果

```ts
type PollPayload = {
  question: string;
  contextSummary: string;
  options: Array<{ id: Id; label: string; description: string; objectRefs: Ref[] }>;
  selection: { mode: 'single'; min: 1; max: 1 }
    | { mode: 'multiple'; min: number; max: number };
  allowAbstain: boolean;
  resultsVisibility: 'after_close';
  closePolicy: { kind: 'host' } | { kind: 'deadline'; at: ISOTime };
};
type PollResponse =
  | { kind: 'vote'; optionIds: Id[] }
  | { kind: 'abstain' };
type PollResult = {
  eligible: number; voted: number; abstained: number; pending: number;
  counts: Array<{ optionId: Id; count: number; percentOfVoters: number | null }>;
  leadingOptionIds: Id[]; tied: boolean; final: boolean;
};
```

校验：发布时question 1–300字，options 2–12项；label 1–100字，description≤500字。选项id唯一，规范化相同label直接拒绝，语义近似只提示人工核对。多选1≤min≤max≤选项数；optionIds不重复且全部属于发布版本；abstain只有allowAbstain时可用。截止时间必须在发布服务时间之后。

一人一份当前有效回应，改票增加responseVersion。未投人数=受众−有当前回应的人数；弃权不进入有效投票人数分母；voted=0时百分比null、leadingOptionIds=[]、tied=false。否则最高票有多项才是tied。开放时服务可维护内部统计，但API投影只暴露已回应人数和本人票，不暴露counts／leadingOptionIds；截止才发放PollResult。

## 5. 分工payload、回应与结果

```ts
type Schedule = {
  rawText: string;
  timezone: string | null; // IANA时区，经可信日期解析器核验
  start: ISOTime | null; end: ISOTime | null;
  dueDate: string | null; // YYYY-MM-DD，日期精度保留为日期
  dueAt: ISOTime | null;
  precision: 'interval' | 'datetime' | 'date' | 'unknown';
  exclusive: boolean | null;
  evidence: Evidence;
};
type AssignmentItem = {
  id: Id; itemRevision: number; taskRef: Ref | null;
  title: string; deliverable: string;
  assigneeId: Id | null; unresolvedAssigneeText: string | null;
  collaboratorIds: Id[];
  schedule: Schedule;
  dependencyRefs: Ref[];
  discussionPoints: Array<{ id: Id; text: string; sourceRefs: SourceRef[] }>;
  conflictIds: Id[];
};
type AssignmentPayload = {
  mode: 'display' | 'request_acceptance'; items: AssignmentItem[];
};
type AssignmentResponse =
  | { kind: 'accept'; itemId: Id; itemRevision: number }
  | { kind: 'object'; itemId: Id; itemRevision: number; reason: string }
  | { kind: 'suggest_change'; itemId: Id; itemRevision: number; reason: string;
      suggestion: { deliverable?: string; scheduleText?: string; assigneeId?: Id } }
  | { kind: 'report_issue'; itemId: Id; itemRevision: number; reason: string };
```

发布items 1–30项、task／deliverable必须明确非空且各≤500字。明确人员名匹配同会议名册，重名不自动绑定；assigneeId与unresolvedAssigneeText不可同时非空。request_acceptance每项必须有assigneeId且位于受众；display允许待指定。协作者可为名册内任意人，但不会自动收到当前组件或承担回应义务，若需回应须加入受众。

start／end同在且start<end才可作区间；date精度不能虚构为全天占用；dueDate与dueAt按precision互斥；缺时区和不确定日期不能做确定重叠判断。依赖须引用存在且已读的本会议任务，对新增批内任务先解析ID再校验环。

accept／object／suggest_change仅主要负责人且request_acceptance开放时合法。report_issue任何本轮受众可用，展示模式也允许；它作为独立评论记录，不覆盖负责人接受状态。结果是服务按item、负责人当前回应和公开问题数量派生的只读投影，不由模型回填。个人异议说明仅本人和host可读，公开行只显示“有待处理问题”；显式发放冲突卡才公开所选说明。

## 6. 冲突记录、组件、回应与处理方案

```ts
type ConflictRecord = {
  id: Id; meetingId: Id;
  type: 'time_overlap' | 'dependency_conflict' | 'assignment_mismatch'
    | 'constraint_violation' | 'participant_objection';
  fingerprint: string; // 服务规范化类型、实体集合和约束ID
  revision: number;
  basis: 'rule' | 'agent_inferred' | 'participant_reported';
  verification: 'supported' | 'needs_confirmation' | 'dismissed';
  resolution: 'unresolved' | 'proposed' | 'awaiting_revision' | 'resolved';
  objectRefs: Ref[]; evidence: SourceRef[]; affectedParticipantIds: Id[];
  summary: string; impact: string;
  coverage: 'complete' | 'partial'; uncheckedRefs: Ref[];
  blocks: Array<{ componentId: Id; operation: 'publish' | 'respond' | 'record_decision'; reason: string }>;
  resolutionEvidence: SourceRef[];
};
type ResolutionAction =
  | { kind: 'revise_task'; taskRef: Ref;
      proposed: { deliverable?: string; assigneeId?: Id; scheduleText?: string; dependencyRefs?: Ref[] } }
  | { kind: 'request_clarification'; question: string; participantIds: Id[] }
  | { kind: 'prepare_poll'; question: string; labels: string[] };
type ConflictPayload = {
  conflictRefs: Ref[];
  sides: Array<{ id: Id; title: string; description: string; objectRefs: Ref[]; evidence: SourceRef[] }>;
  questions: Array<{ id: Id; text: string; participantIds: Id[] }>;
  resolutions: Array<{ id: Id; title: string; tradeoffs: string; actions: ResolutionAction[] }>;
};
type ConflictResponse =
  | { kind: 'provide_context'; questionId: Id | null; commentId: Id; text: string }
  | { kind: 'support_resolution'; resolutionId: Id }
  | { kind: 'suggest_resolution'; commentId: Id; text: string };
```

冲突记录与卡片分离：记录可被多个相关分工引用，卡片只是对选定受众的可交互表示。ConflictRecord.blocks由服务依据业务校验规则生成，不能任模型把任意冲突升级成全会议阻塞。明确被约定为不可违反的约束与可信规则结果可阻塞；语义怀疑默认待核对。决定确认依赖的明确未决异议阻止record_decision。

卡片发布至少1条有效conflictRef、1–4个关联安排side；普通矛盾至少两方证据，单项任务异议可以一方＋参与者报告。summary和impact各≤500字；questions≤6、resolutions≤4、每方案actions≤6。没有足够解决依据时允许resolutions=[]，界面呈现待澄清。所引用原话／回应必须可向全部audience披露；人工重述仍需记录来源和发起者披露操作。

ResolutionAction不是可执行任意JSON patch。apply_resolution只把白名单字段变化转成需要host查看的草稿／澄清／投票提案。支持某方案不等于接受新任务或同意新决定。规则冲突须在新的对象版本通过R2检查后解除；participant_objection须原报告者提交已解决反馈或在新任务轮明确接受对应修订，并由R4核对关联，host不能直接覆盖异议。

首版另有可信`resolve_report`回应：仅报告者可以撤回自己的一条问题／异议，需reportId、expectedReportVersion和说明；它生成回应事件再触发R，不允许任意改ConflictRecord.resolution。历史说明仍保留。

## 7. 决定确认payload、回应与结果

```ts
type ConfirmationPayload = {
  statement: string; scopeText: string;
  conditions: Array<{ id: Id; text: string; objectRefs: Ref[]; evidence: SourceRef[] }>;
  targetObjectRefs: Ref[];
  supportingResults: Array<{ componentId: Id; publishedRevision: number }>;
  requiredParticipantIds: Id[];
  rule: 'all_required_explicit_agree';
};
type ConfirmationResponse =
  | { kind: 'agree' }
  | { kind: 'reserve'; reason: string }
  | { kind: 'disagree'; reason: string };
type ConfirmationResult = {
  agree: number; reserve: number; disagree: number; pending: number;
  eligibleToRecord: boolean; blockingReasons: string[];
  recordedDecisionId: Id | null;
};
```

发布statement 1–1000字、scopeText 1–500字，conditions≤12条；requiredParticipantIds非空、去重且与受众集合完全相等。关联来源可为host手工编辑命令，不强制先有投票。若引用投票结果，必须是已截止版本，不能拿实时领先项当结论依据。

agree／reserve／disagree均绑定发布版本；reserve／disagree理由1–1000字。agree人数等于required人数只是必要条件；还须当前轮open、没有来源／依赖失效、无相关未决实质冲突且回应未被修订，record_decision才可成功。事务内创建有scope、confirmedBy、确认basis与不可变response引用的现有Decision兼容记录。

开放期间改同意为反对与record_decision按服务提交顺序串行：反对先提交则记录失败；记录先提交则当前轮已关闭，反对命令返回ROUND_CLOSED，并提供“针对已记录决定提出新问题”的新事件入口，不能改写历史决定。

## 8. 命令、事件和投影

命令公共字段：`commandId, meetingId, componentId?, expectedPublishedRevision?, expectedAggregateVersion?, expectedResponseVersion?`。actorContext由main绑定窗口后提供，不在renderer可写payload里。首次回应expectedResponseVersion=0，后续为本人的当前版本。不同命令只允许其必需字段，缺版本不能默认用最新版本执行。

| command.type | 专有payload | 授权／提交效果 |
|---|---|---|
| `component.prepare` | family、topicRef、scope、historyRefs、collectionMode | host；创建草稿，可零模型手工填充 |
| `component.edit_draft` | baseDraftRevision、白名单fieldChanges | host；创建新revision并锁手工字段 |
| `component.freeze_collection` | collectionId | host；冻结来源集合，排空相关已收分析后ready |
| `component.resolve_target` | clarificationId、候选componentId／revision、原意图ref | host；仅消解目标并重新进入C，不继承为发布授权 |
| `component.publish` | draftRevision、audienceIds、旧轮预期版本、acknowledgedGapRefs | host；校验并建立新轮＋outbox，不能隐式发布最新草稿 |
| `component.respond` | publishedRevision、subject、expectedResponseVersion、按family的response | audience；保存本人有效回应和历史 |
| `component.resolve_report` | reportId、expectedReportVersion、说明 | 原报告者；标记撤回／解决请求，触发R |
| `component.close` | publishedRevision、expectedAggregateVersion | host；固定结果，reason=host |
| `component.cancel` | draftRevision或publishedRevision及预期聚合版本、reason | host；保留历史，取消目标草稿或撤回目标轮次 |
| `component.apply_resolution` | conflictRevision、resolutionId、相关对象预期版本 | host；创建修订草稿／子提案；不直接公开或重分配 |
| `component.record_decision` | publishedRevision、expectedAggregateVersion | host；验证后原子记录Decision并关闭轮次 |
| `component.revalidate_round` | publishedRevision、expectedAggregateVersion、已验证的reviewResultId | host；只应用可信R结果；不能传布尔值绕过阻塞 |
| `component.report_new_issue` | 目标已记录Decision ref、text | 原会议participant；创建新报告，历史决定保持 |
| `component.delivery_ack` | sequence、viewed布尔 | 对应窗口actor；更新投递收据，不创建回应 |

`component.publish`可同时替代旧轮，需要准确expectedAggregateVersion。来源缺口ack仅表示host选择已展示内容范围，不能绕过schema、权限或实质依赖阻塞。`component.report_new_issue`在已结束会议只保存核对问题并标记旧决定待复核，不开放新协作轮。

发布命令另含`sourceDisclosure: Array<{sourceRef, excerpt}>`：host在预览中逐条选择实际共享摘录，服务检查摘录属于该来源版本并冻结到round.sharedEvidence。模型不能批准披露；参与者来源抽屉只读这些快照。冲突所需依据未全部选择或host本身无权读取时拒绝发布，不能靠模型改写后绕过。这里只支持host已有本地会议内容与发给host的回应，个人推演仍不可自动转成事实来源。

`publish`、`revalidate_round`和`record_decision`检查相关requiredAnalysisSequence≤validatedAnalysisSequence，R提交时以读到的水位更新validated；R运行期间新到异议仍阻塞。现有readSet扩展components／rounds／responses／conflicts／participants名册版本及相关分析水位，不用全会议每条无关事件锁住所有组件。

发布／记录命令由服务生成`evaluationFrontier`，保存点击时已接收final来源refs并等待该范围语义处理。处理产生依赖变化时命令返回需重新预览的新版本，不能替host批准变动后的内容。前沿未处理完不开始业务事务；waiting状态持久化且可以取消。record_decision不能在相关来源缺口或分析欠账下成功。当前运行时缺口记录尚无逐组件归属及可信补全状态，因此存在任一inputGaps即返回INPUT_GAP_UNRESOLVED，保留待确认，不将历史缺口静默视为已解决。

CQ沿用现有持久澄清的answered／cancelled／resolved／stale状态，问题指向候选意图及目标版本。选择目标通过resolve_target，补业务字段通过edit_draft；任一候选版本已过期则重新显示可选项。普通会议理解继续运行，不等待澄清回答。

命令事务：查身份／会议／目标 → 查commandId与payloadHash → 校验轮次、权限、截止与业务条件 → 更新状态／回应／统计 → 保存命令结果、事件和outbox → commit → ack及投递。同commandId同payload返回原结果；同ID不同payload拒绝COMMAND_ID_REUSED。失败事务不得发布内存状态或计数。

语义图提案事务：校验job fence／lease／readSet → 保存不可变提案 → 应用合法草稿／冲突／领域变化与后续job／event → commit。不得把等待模型、等待窗口ack放入SQLite事务。任务状态沿用现有job机制，记录scope=collaboration与kind=M／C／R供调度，不用修改个人任务语义来容纳多人事件。

关键事件及消费者：

| event.type | 生产者 | 消费者与效果 |
|---|---|---|
| `source.accepted` | STT／可信输入服务 | M理解；collectors在M／C内按范围消费 |
| `meeting.semantic_committed` | M4 | C候选、R依赖分析、X普通表达 |
| `component.draft_saved` | C4／host编辑 | host UI；只在内容实质影响时单独排R，不回送M |
| `component.published` | A2 | 投影／outbox；R检查相关依赖，零模型为主 |
| `response.saved` | A2 | 本人ack与可见状态；按family、回应kind决定是否R |
| `component.closed` | A2／Z／截止服务 | 发布最终结果；R只作结果影响，不自动发新组件 |
| `domain.references_changed` | 领域提交服务 | 即时标记依赖失效；R定向复核 |
| `conflict.updated` | R5 | host提示、相关行标记、C冲突草稿；无实质变化不发事件 |
| `decision.recorded` | A2 | 已有Decision体系、M下次上下文、X解释更新 |
| `meeting.ended` | 原结束服务扩展 | Z截止、collector结束、核对未完成范围 |

事件外壳含eventId、meetingId、actorContext、rootEventId、causationId、targetRefs、serverTime、sequence、payloadVersion。参与者拿到的是权限投影后的事件，不是这份内部完整载荷。sequence用于恢复／去重，不当作模型语义版本。

### 投影矩阵

| 内容 | host | 对应参与者 | 其他受众 |
|---|---|---|---|
| 草稿、未公开冲突／手工diff | 可见 | 不可见 | 不可见 |
| 已发布内容及声明的规则 | 可见 | 可见 | 仅在audience内可见 |
| 投票开放期各选项票数 | 不显示 | 不显示 | 不显示 |
| 投票开放期本人票 | 若host在名册，只见自己的 | 可见自己的 | 不可见他人的 |
| 投票截止后汇总／逐人明细 | 两者可见 | 汇总＋本人 | 汇总＋本人 |
| 分工回应状态、确认逐人状态 | 可见 | 可见 | 同轮受众可见 |
| 分工／确认的个人理由 | 可见 | 仅自己的 | 不可见 |
| 已发布冲突卡的参与者补充说明 | 可见 | 仅自己的 | 不自动共享；host可明确选入修订卡 |
| 原话来源抽屉 | 本人原有权限 | 仅本轮明确共享的依据摘录 | 同前，不能获得整场原话 |
| 私人推演、设置、密钥、其他会议 | host按既有权限 | 不可见 | 不可见 |

## 9. 数据库迁移与兼容

拟新增表及关键约束：

| 表 | 键／重要约束 |
|---|---|
| collaboration_participants | (meeting_id,id)，角色与模拟标记；每会唯一host |
| collaboration_components | id，meeting_id，family，draft_revision，published_revision，aggregate_version |
| collaboration_revisions | (component_id,revision)唯一，不可变payload、证据与schema版本 |
| collaboration_rounds | (component_id,revision)唯一，audience_snapshot、status、gate、截止；一个component最多一轮open |
| collaboration_responses | (component_id,published_revision,actor_id,subject_key,response_version)唯一；历史追加 |
| collaboration_response_heads | (component_id,published_revision,actor_id,subject_key)唯一，指向当前response；接受／改票事务更新 |
| collaboration_conflicts | id、fingerprint、revision及证据／解决状态；当前fingerprint同会议唯一 |
| collaboration_collections | id、component_id、freeze水位、消费关联；活动数上限事务检查 |
| collaboration_events | event_id唯一，meeting_id＋sequence唯一，根因果ID与payload |
| collaboration_outbox | event_id＋recipient_id唯一，待投递状态／重试计数 |
| collaboration_receipts | recipient_id＋event_id唯一，delivered／viewed时间 |

复用原commands存命令幂等结果、workflow_jobs／proposals／success存语义任务；为collaboration job增加明确kind与readSet扩展。实际迁移用独立的collaboration schema版本记录，在同一SQLite连接管理的事务中建表／升级；原state(schema_version=1)及已存Meeting payload保持可读。

组件引用的已有任务／决定继续在原领域模型保存。单次采纳修订必须在同一连接、同一事务更新原state和协作表；不要让现有SQLiteStore.save在外层事务内再BEGIN。实施应抽出统一UnitOfWork入口，所有写入保持单写服务；禁止把协作表落库成功和领域状态成功拆成两次提交。

旧会议默认协作关闭且无参与者；不导入模拟人或测试组件到日常数据。不可识别的schemaVersion只读报“此组件需更新应用”，不猜字段执行动作。升级测试应有副本；运行时正常事务迁移失败则保留原库并报告，不能重建空库冒充恢复。

## 10. 错误与降级

错误码固定且可本地化：UNAUTHORIZED、NOT_IN_AUDIENCE、ROUND_CLOSED、ROUND_REPLACED、REVISION_CONFLICT、RESPONSE_VERSION_CONFLICT、DEPENDENCY_STALE、MISSING_REQUIRED_FIELDS、DUPLICATE_OPTIONS、TARGET_AMBIGUOUS、SOURCE_NOT_SHAREABLE、COMMAND_ID_REUSED、BUDGET_EXHAUSTED、DELIVERY_PENDING、STORAGE_FAILED、ANALYSIS_INCOMPLETE。

字段错误原位显示；过期回应保留本地输入供对照，重新加载新版本后由用户重新提交；不得把旧选择静默应用到新选项。模型失败保留已有草稿和已发布组件，可手工编辑／发布通过确定性校验的草稿。依赖或冲突需要语义核验而模型不可用时，相关操作保持待核对，其他无关组件可继续。

断线重试采用原commandId；只有用户修改了回应内容才生成新commandId并使用更新的expectedResponseVersion。投递失败仅影响该收件人的receipt，不回滚已成功发布或重复生成组件。暂停采音不关闭互动；结束会议才截止所有轮次。
