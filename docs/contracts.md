# 数据与操作契约

版本0.1｜建议接口，非已编译实现。下面的TypeScript是设计示意；下一轮在`src/contracts/`写运行时schema和类型。本文件定义业务职责，不将具体库写成不可替换前提。

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
  action: 'no_change' | 'patch_artifact' | 'create_artifact' |
          'propose_restructure' | 'request_clarification';
  targetArtifactId: string | null;
  purposeKey: string; userQuestion: string;
  objectRefs: RefVersion[]; relationRefs: RefVersion[];
  carrier: Carrier; structureIntent: unknown;
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
  carrier: Carrier; payload: unknown; schemaVersion: number;
  objectRefs: RefVersion[]; relationRefs: RefVersion[]; sourceRefs: SourceRef[];
  bindings: Array<{ elementId: string; objectId: string; actionIds: string[] }>;
  validation: { syntax: boolean; semantics: boolean; rendering: boolean };
  createdByJobId: string;
};
```

`structureIntent`按载体生成schema：文字层次、表格维度、图形节点边、SVG布局意图、chart编码或HTML区域与交互说明。`payload`以carrier作为判别联合；不得不经校验就直接注入DOM。

Agent可以设计新组合，应用不提供“特定会议模板ID”要求它填数。新建通过会议＋目的＋对象角色定位；`purposeKey`要经服务校验，不能因每批随机改名创建重复产物。可并存有不同目的的同对象产物，例如解释与试算。

固定模板版本与产物身份分离；同用途内容变化通常生成同一artifact的新revision。已保存revision不原地覆盖，供恢复和对比。

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
