# 第二阶段协作组件 Implementation Plan

COL04展示约束：已填充组件自动显示在固定缩略区，悬停展开、点击固定审核；持续讨论更新同一卡片。悬浮球数量只作辅助，不能成为发现组件的必经入口。

统一体验约束（COL03）：全程静默识别自然讨论中的需求，无需对Agent说话。Agent用默认schema生成完整组件，host只审核后一键分发；编辑／配置仅为可选纠错。信息收集的填写对象是参与者，host不负责从空表设计问题。所有后续组件和验收均遵守此要求。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 按用户确认的顺序执行；不主动派发子Agent。当前请求是制定计划，不授权现在开始产品实现或延续上轮Git推送。任务使用`- [ ]`跟踪，不能以计划存在代替完成。

**Goal:** 补齐首批组件关键闭环后，依次完成议程、信息收集、方案对比、风险与问题清单，使八类组件可在本地会议中通过悬浮窗准备、发放、互动、分析和恢复。

**Architecture:** 延续M/C/R有界图和可信单写服务；family注册表统一payload、校验、交互、投影与后续路由。内容revision不可变，控制状态及回应单独版本化；逐项diff、依赖读集和持久任务共同保护跨组件更新。

**Tech Stack:** 当前TypeScript、Zod、React、Electron、node:sqlite、LangGraph、tsx和Playwright；不新增运行时依赖。

**Spec:** [第二阶段设计](collaboration-phase2-design.md)；首批约束仍见[首版设计](collaboration-v1-design.md)、[运行时差距](collaboration-v1-runtime.md)、[62项验收](collaboration-v1-acceptance.md)。

## Global Constraints

- 顺序：关键闭环 → 议程 → 信息收集 → 方案对比 → 风险与问题清单 → 组合验收。新增family不能先于G0关键闭环通过。
- 组件仍以独立悬浮窗展示，准备好在悬浮球提示；不自动抢焦点，关闭不等于撤回；尊重用户隐藏悬浮球设置。
- 发起者和三名本地模拟参与者，最多十个身份；actor由main绑定，不从转写推断授权。
- 发布、截止、控制状态及记录决定走可信命令。普通回应不调用M，不让模型计算统计；转换组件先私有准备、再由host发放。
- 单组件≤32 KiB，每个C／R任务≤2次模型调用，每根事件≤8个语义job，总并发4且M保留1槽；超额范围持久保留，不通过自动新root绕过预算。
- 中英文外壳、未知／失败／过期状态同批实现。Windows与macOS分别验收；本轮规划不运行真实麦克风、模型或发布操作。
- 不伪造Artifact来兼容决定，不把风险负责人当作任务接受，不把对比结论当作投票结果，不把未知答案当作未回应或同意。
- 现有源码基线0cc0db0，历史合并验证133单元、25桌面覆盖；执行前重新核对HEAD／PR／工作树，不假定main尚未变化。

## 里程碑与交付顺序

| 里程碑 | 任务 | 可独立检查的成果 | 后续准入 |
|---|---|---|---|
| G0 关键闭环 | 1–3 | 八类扩展底座、逐项修订与证据、等待／恢复与幂等、首批会后核对 | 首批G0场景全通过后启用新family |
| G1 议程 | 4 | 发放议程、host切换、参与者提问与恢复 | 可在本地会议直接使用 |
| G2 信息收集 | 5 | 发放表单、三人独立回答、确定性完成度与受控归纳 | 可给后续比较提供证据 |
| G3 方案对比 | 6 | 有来源矩阵、逐格异议、定向分析及投票草稿 | 不制造默认评分／赢家 |
| G4 风险问题 | 7 | 风险／问题分层、反馈／解决复核、分工／冲突联动 | 不以关闭卡片代表风险解决 |
| G5 综合交付 | 8–9 | 八类组合、真实模型合成语料评估、平台验证和交接 | 按实际证据决定交付范围 |

每项走失败用例→最小实现→本项回归→文档更新。Git提交／PR只在执行轮获得相应授权后进行；建议按G0、G1–G2、G3–G4、G5拆分可审核提交，不能把未通过阶段标为完成。

## 任务1：统一扩展契约、组件注册和兼容读取

**Files:** 新建`src/contracts/collaboration-common.ts`、`src/domain/collaboration-registry.ts`、`src/ui/collaboration/registry.tsx`、`src/ui/collaboration/ComponentShell.tsx`、`tests/unit/collaboration-registry.test.ts`及`tests/helpers/collaboration.ts`；修改`src/contracts/collaboration.ts`、`src/service/collaboration-store.ts`和`src/ui/collaboration/Panel.tsx`。

**Interfaces:**

```ts
type PublicationContext = {
  state: CollaborationState; component: Component; audienceIds: string[]; now: number;
};
type FamilyDefinition = {
  family: Family;
  createEmpty: () => ComponentContent;
  publicationIssues: (content: ComponentContent, context: PublicationContext) => string[];
};
// 以上旧类型仍从contracts/collaboration导出；新文件仅共享Ref／EvidenceRef等基础schema。
function getFamilyDefinition(family: Family): FamilyDefinition;
function decodeStoredComponent(raw: unknown):
  | { kind: 'supported'; component: Component }
  | { kind: 'unsupported'; id: string; reason: 'UNKNOWN_FAMILY' | 'UNKNOWN_SCHEMA' };
```

组件壳只管生命周期、受众、披露、错误和悬浮交互。family视图只管DraftEditor、PublishedView、ResultView，禁止自行访问全会议snapshot或发送未经壳绑定的actor。旧Panel入口保留兼容，逐步抽出四类视图，不整体改写无关界面。

- [ ] 为当前四类建立注册表覆盖、未知family、未知schema只读、旧库恢复测试；测试helper创建独立SQLiteStore及无网络ModelPort，返回`service`、`meetingId`、`hostId`、`participantIds`和`dispose()`。
- [ ] 运行`node --import tsx --test tests/unit/collaboration-registry.test.ts`，确认新增接口缺失时失败。
- [ ] 抽出共享EvidenceRef／Ref schema，避免新增family模块从总union循环导入。先仅注册现有四类；后续任务完成一类才扩展Family和ComponentContent，不能暴露半实现类型。
- [ ] 给组件保存`contentSchemaVersion`，旧记录读取补1；在副本中验证迁移。全局存储版本升级前检测旧读取器，未知组件不能进入编辑／发布命令；不清空旧会议。
- [ ] 将旧四类挂入统一壳并运行现有协作单元和Electron；新增设计阶段代码片段对应断言：

```ts
assert.equal(getFamilyDefinition('poll').createEmpty().kind, 'poll');
assert.equal(decodeStoredComponent({ id: 'x', family: 'future', contentSchemaVersion: 99 }).kind, 'unsupported');
assert.deepEqual(oldDatabase.meetings[0].decisions, migratedDatabase.meetings[0].decisions);
```

## 任务2：首批逐项修订、统一事实引用和会后核对

**Files:** 新建`src/domain/collaboration-revisions.ts`、`src/domain/collaboration-records.ts`、`src/ui/collaboration/RevisionReview.tsx`、`tests/unit/collaboration-revisions.test.ts`、`tests/unit/collaboration-records.test.ts`；修改`src/domain/collaboration.ts`、`src/domain/collaboration-integrity.ts`、`src/service/collaboration-runtime.ts`、`src/service/session.ts`、`src/ui/MeetingReview.tsx`、`src/desktop/main.ts`。

**Interfaces:**

```ts
type ItemEdit = {
  collection: 'options' | 'items' | 'fields' | 'criteria' | 'cells';
  itemId: string; baseItemRevision: number | null;
  operation: 'add' | 'replace' | 'remove'; value: unknown;
}; // add的baseItemRevision=null；replace/remove须正整数；remove的value=null，其他value经family条目schema
type RevisionProposal = {
  id: string; componentId: string; baseDraftRevision: number; edits: ItemEdit[];
};
function validateRevisionProposal(component: Component, raw: unknown): RevisionProposal;
function applySelectedEdits(state: CollaborationState, actorId: string,
  proposal: RevisionProposal, selectedItemIds: string[]): number;
function meetingDecisionRecords(meeting: Meeting): Array<{
  id: string; origin: 'artifact' | 'collaboration'; statement: string;
  participantIds: string[]; reviewRequired: boolean;
}>;
```

- [ ] 写失败测试：host删除选项后Agent不能复活；同项手改与旧提案冲突，另一项更新可显示为建议；发布前公开轮内容保持不变；来源撤回后已记录决定显示待复核。
- [ ] 运行两个新增单元文件，确认缺失行为失败；对`applySelectedEdits`断言未选条目完全不变，复用commandId不生成第二版。
- [ ] 用条目ID保存tombstone和手工锁；模型建议单独持久化。RevisionReview展示新增／删除／修改前后值，基线过期时重新比较，禁止静默用最新revision覆盖未保存输入。
- [ ] apply_resolution产出白名单修订提案。涉及既有SemanticObject任务时，在host确认应用后同事务推进对象版本与草稿引用；没有taskRef的手工任务分配稳定业务ID，组件不另维护一份已接受任务真相。重发后的参与者接受仍是独立动作。
- [ ] 会后核对和导出使用`meetingDecisionRecords`联合读取旧产物型决定与协作决定，保留原始两类来源数据；新增版本化导出投影，不伪造旧Artifact。
- [ ] 用下列断言完成单元，并扩展Electron检查未保存内容／diff／旧轮；同步首批INT-08、CON-04、DEC-04／06、SYS-05证据。

```ts
assert.equal(newDraft.items.some(item => item.id === deletedId), false);
assert.deepEqual(component.rounds[0].content, publishedBefore);
assert.equal(meetingDecisionRecords(meeting).filter(d => d.origin === 'collaboration').length, 1);
```

## 任务3：等待前沿、定向R、恢复和明确续跑

**Files:** 新建`src/service/collaboration-pending.ts`、`src/service/collaboration-readset.ts`、`src/ui/collaboration/PendingActions.tsx`、`tests/unit/collaboration-recovery.test.ts`；修改`src/service/collaboration-runtime.ts`、`src/agent/collaboration.ts`、`src/contracts/collaboration-workflow.ts`、`src/service/collaboration-store.ts`、`src/service/session.ts`、`src/desktop/main.ts`。

**Interfaces:**

```ts
type PendingAction = {
  id: string; commandId: string; actorId: string; componentId: string;
  sourceRefs: Ref[]; responseRefs: { id: string; version: number }[];
  status: 'waiting' | 'ready' | 'cancelled' | 'stale' | 'failed'; reason: string | null;
};
function captureCollaborationReadSet(meeting: Meeting, componentIds: string[]): unknown;
function assertCollaborationReadSet(meeting: Meeting, readSet: unknown): void;
function cancelPendingAction(state: CollaborationState, actorId: string, actionId: string): void;
```

- [ ] 写失败测试：R等待时无关来源不作废，有关回应改版作废；重启等待动作保持相同前沿／ID；取消后模型完成不能发布；规则已发现冲突但语义失败时仍保存规则结果。
- [ ] 运行`node --import tsx --test tests/unit/collaboration-recovery.test.ts`建立失败基线。
- [ ] 将前沿等待从隐藏meta映射为PendingAction视图，展示原因、范围、重试、取消；worker／main绑定actor。重开窗口恢复同一动作；ready后仍由host确认当前有效版本，不能后台悄悄发放。
- [ ] 捕获组件、条目、引用对象、相关来源及回应头的最小读集。R规则结果与semantic_pending分开保存，只有完整有效分析可推进validated水位；旧分析不能清除更新后的required水位。
- [ ] 将超根预算状态改为可见blocked_budget，保存未处理范围。显式“继续分析”创建带parentRootEventId的新根并扣除总预算，禁止自动重置；相同命令幂等。崩溃后重放提案，避免再次模型调用。
- [ ] 扩展意图localId／dependsOnLocalIds／expectedTargetRevision，检查DAG和未知目标，按拓扑调度。忽略建议按purpose＋来源版本记录，相关新事实到来才允许重议；回放同版本不再弹提示。
- [ ] 验证后将G0标为通过；测试至少断言：

```ts
assert.equal(restoredPending.commandId, originalPending.commandId);
assert.equal(restoredPending.sourceRefs.length, originalPending.sourceRefs.length);
assert.equal(modelCallsAfterProposalReplay, modelCallsBeforeRestart);
assert.equal(ruleConflict.resolution, 'unresolved');
assert.ok(component.requiredAnalysisSequence > component.validatedAnalysisSequence);
```

G0必须覆盖：首批修订公开隔离、逐项防复活、确定性结果不被语义故障吞掉、来源失效、等待动作重启／取消、相同命令重试、未回应不能记录决定。失败时先修复，不继续扩充组件种类。

## 任务4：议程组件（第二批第1类）

**Files:** 新建`src/contracts/collaboration-agenda.ts`、`src/domain/collaboration-agenda.ts`、`src/ui/collaboration/Agenda.tsx`、`tests/unit/collaboration-agenda.test.ts`；修改注册表、总schema、意图schema、`src/service/collaboration-store.ts`和`src/ui/launcher-status.ts`；新增`tests/e2e/collaboration-phase2.spec.ts`的议程场景。

**Interfaces:** 导出`AgendaContentSchema`、`AgendaQuestionSchema`；`applyAgendaProgress(state, actorId, payload): void`接收设计§3.1的完整控制命令；`agendaProjection(state, componentId, actorId)`返回公开内容及controlVersion／当前项／状态。

- [ ] 用1–20项schema边界、未知时长、重复ID、参与者越权切换、两个current和旧controlVersion建立失败测试，并运行新增unit文件。
- [ ] 注册agenda和prepare/update意图；`agenda.set_progress`使用独立控制表，原公开payload不变。一次切换先解除旧current再设置新current，同事务追加事件。
- [ ] 实现双语议程编辑／公开进度／结束结果视图，participant只能提问；进入ready通知悬浮球，不自动切换议程或抢焦点。
- [ ] 接入M→C、问题收尾→R的路由；普通切换不调用模型。参数或schema错误进入既有有界修复，不创建空公开议程。
- [ ] Electron验证发放、切换、A提问、B不能代切换、重开恢复和结束保存；核心断言：

```ts
assert.equal(view.items.filter(item => item.status === 'current').length, 1);
assert.deepEqual(component.rounds[0].content, publishedBefore);
assert.equal(modelCallsAfterSwitch, modelCallsBeforeSwitch);
```

## 任务5：信息收集组件（第二批第2类）

**Files:** 新建`src/contracts/collaboration-collection.ts`、`src/domain/collaboration-collection.ts`、`src/ui/collaboration/InformationCollection.tsx`、`tests/unit/collaboration-collection.test.ts`；修改总schema、注册表、C上下文和R事件路由，扩展第二阶段Electron。

**Interfaces:** 导出`InformationCollectionContentSchema`、`CollectionSubmitSchema`和`type CollectionSubmit = z.infer<typeof CollectionSubmitSchema>`；`validateCollectionAnswers(content, raw): CollectionSubmit`严格按字段类型检查；`collectionSummary(content, responses, audienceIds)`返回submitted／pending／unknownAnswerCount，不返回公开逐人答案。

- [ ] 写必填／unknown、非法选项、数字单位／上下界、重复fieldId、自己改答、换版拒绝及host-and-self隐私测试，并运行新增unit。
- [ ] 实现整份答案原子保存，未填写可选项与unknown分开；已有ResponseRecord版本控制复用，公开人数由可信代码统计。不能让组件模型代填答案。
- [ ] 实现单栏双语表单、错误定位、保留失败输入、保存状态；host可查看全部有效答案，其他参与者只能看到自己内容与安全完成度。
- [ ] 反馈即时推进相关dirty，250 ms合并调度；归纳／截止触发R生成有来源的私有归纳及下游草稿。回答用稳定response引用，不把私有原文直接广播。
- [ ] Electron验证A/B/C独立回答、同人改答、截止后不可答、host披露归纳后可转为比较草稿；断言：

```ts
assert.equal(summary.submitted + summary.pending, audienceIds.length);
assert.equal(JSON.stringify(viewForB).includes(privateAnswerFromA), false);
assert.equal(summary.unknownAnswerCount, 1);
```

## 任务6：方案对比组件（第二批第3类）

**Files:** 新建`src/contracts/collaboration-comparison.ts`、`src/domain/collaboration-comparison.ts`、`src/ui/collaboration/OptionComparison.tsx`、`tests/unit/collaboration-comparison.test.ts`；修改C／R上下文、逐项diff和来源失效处理，扩展第二阶段Electron。

**Interfaces:** 导出`OptionComparisonContentSchema`、`ComparisonCommentSchema`；`comparisonIssues(content, evidenceAvailable: (ref: EvidenceRef) => boolean): string[]`通过可信证据查询验证二维完整性、唯一格和证据；`comparisonToPollDraft(content): ComponentContent`只生成poll草稿，选项ID与来源由可信转换记录关联。

- [ ] 写2–6方案×1–8维度范围、缺格／重复格、known无证据、未知保留、来源更正只使关联格待复核的失败测试，并运行新增unit。
- [ ] C只能用有效对象或已披露收集结果填写比较；未知不补造成本／日期，不增加未约定权重或赢家。修订用格ID＋cellRevision。
- [ ] 实现双语矩阵、窄窗卡片、格证据和异议入口；异议先保存并设分析欠账，再由R产生私有修订／冲突。
- [ ] 提供“准备投票”与“补充收集”动作，验证来源和受众后只生成下游私有草稿，必须另行发放。确认组件只有明确statement和范围时才可准备。
- [ ] Electron验证归纳→比较→A反对某格→R建议→host应用diff→准备投票；断言：

```ts
assert.equal(unknownCell.assessment, 'unknown');
assert.ok(comparisonIssues(contentWithUnsupportedKnownCell, () => false).includes('EVIDENCE_REQUIRED'));
assert.equal(downstreamPoll.rounds.length, 0);
```

## 任务7：风险与问题清单（第二批第4类）

**Files:** 新建`src/contracts/collaboration-risks.ts`、`src/domain/collaboration-risks.ts`、`src/ui/collaboration/RiskIssue.tsx`、`tests/unit/collaboration-risks.test.ts`；修改R提案契约、冲突引用、决定／会后核对投影，扩展第二阶段Electron。

**Interfaces:** 导出`RiskIssueContentSchema`、`RiskFeedbackSchema`；`applyRiskStatus(state, actorId, payload): void`对应设计§3.1；`riskToAssignmentDraft(content, itemId): ComponentContent`只准备未接受的任务草稿。

- [ ] 写risk与issue区分、推测不得变supported、负责人为空可展示、resolved缺依据拒绝、未撤回异议阻止解决、关闭卡片不改问题状态的失败测试，并运行新增unit。
- [ ] 实现条目controlVersion、反馈历史和解决依据；新来源／异议使已解决项待复核。需要明确排期矛盾时引用既有ConflictRecord及版本，不重建独立冲突结论。
- [ ] 实现双语条目视图、类型／严重度／推测标签、证据和处理历史；显示负责人为建议跟进，不显示“已接受”。
- [ ] 接入M→C以及R发现风险→C；风险解决报告→R→host设状态；转分工／冲突／确认均只创建私有提案。
- [ ] Electron验证风险发放、参与者补充、转分工、依据改变复核及会后留痕；断言：

```ts
assert.throws(() => applyRiskStatus(state, hostId, resolutionWithoutEvidence), /EVIDENCE_REQUIRED/);
assert.equal(newAssignment.rounds.length, 0);
assert.equal(unresolvedRisk.status, 'open'); // 关闭展示组件后仍保留
```

## 任务8：八类组合、统一悬浮通知与端到端闭环

**Files:** 修改`src/ui/launcher-status.ts`、`src/desktop/main.ts`、`src/ui/main.tsx`、`src/ui/collaboration/ComponentShell.tsx`、`src/ui/MeetingReview.tsx`及`docs/design/ui-copy.json`；新增`tests/unit/collaboration-routing.test.ts`，扩展`tests/e2e/collaboration-phase2.spec.ts`。

**Interfaces:** `componentNotice(componentView, actorId)`返回null或`{componentId, revision, category, label}`；category仅review／ready／response，优先review > ready > response；`componentTransitions`注册源family、允许目标family、所需依据，转换经同一C图，不暴露任意命令。

- [ ] 写八类注册齐备、重复事件不重发通知、查看不算回答、隐藏悬浮球不被强开、跨family转换不能继承发布授权的失败测试，并运行新增routing单元。
- [ ] 实现按组件归并的提醒、未读回执及双语状态；正文和未保存表单不因全局snapshot刷新跳动，底层IPC仍裁剪身份权限。
- [ ] 跑完整合成会话：议程→信息收集→方案对比→投票→确认→分工→冲突→风险跟进→结束核对；每次新共享内容都经过host明确发放。
- [ ] 在旧轮／新草稿并存时分别关闭和重开角色窗口；模拟存储失败、分析失败和进程重启；确认无重复组件、答案或决定。
- [ ] 断言每个转换边的权限、结果与调用上限，保存合成截图和结构化报告；不得将真实日常库作为测试库。

```ts
assert.equal(componentTransitions.length > 0, true);
assert.equal(createdRoundsWithoutHostCommand, 0);
assert.equal(decisionsRecordedBeforeAllExplicitAgree, 0);
```

## 任务9：真实模型评估、平台验收与交接

**Files:** 新建`tests/fixtures/collaboration-phase2-dialogues.json`、`scripts/collaboration-phase2-eval.ts`、`tests/results/collaboration-phase2-validation.md`；修改现有设计／runtime／验收矩阵、README、src/README、状态和session索引。

- [ ] 固定60段合成语料：每类6段（准备、更新、缺项、否定、引用／假设、目标歧义）共48段，加12段跨类转换／源修订／同义重复。输出expected family／operation／目标／禁止动作，按语义结果验收，不按固定措辞。
- [ ] 实现`node --import tsx scripts/collaboration-phase2-eval.ts --dry-run`，验证样本数、覆盖、判定器和脱敏输出；实际调用须执行轮有模型评估授权，密钥仅可信进程读取。
- [ ] 经实际调用后报告联合意图判定≥90%、目标引用≥95%、越权发布／虚构回应0；分别输出漏触发、误触发和歧义处理结果，失败返回非零退出码，不用测试替身充当真实评估。
- [ ] 运行`npm test`、`npm run build`、第二阶段Electron及全量桌面回归。程序退出0且权限／计数／恢复核心用例全通过，才能进入平台交付；测试数量以实际结果填写。
- [ ] Windows与macOS分别验证置顶窗口、200%缩放、悬浮球隐藏／显示、双语、重开恢复和源码／构建一致性；无对应环境则记录该平台未验，不能宣布双端验收完成。
- [ ] 用原62项ID补证据，并新增A2（议程）、I2（收集）、O2（对比）、R2（风险）矩阵，至少包含各类schema、权限、改版、来源失效、恢复及图触发六组；文档标明实际差距。
- [ ] 运行`python -X utf8 scripts/check-docs.py`、本轮变更代码格式和`git diff --check`，检查无密钥／真实会议／日常数据库入改动。同步运行说明后才标记第二阶段完成。

## 执行记录规则

当前所有任务未开始；本轮只做计划和代码状态核验。执行时逐项记录开始基线、变化、失败→修复→通过证据及未测项。用户本轮确认的是优先级；新增组件的字段及边界以本设计／计划作为可审核实施目标，不能把尚未执行的任务写入“已支持”清单。
