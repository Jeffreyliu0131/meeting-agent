# ADR-006：用户声明的跨会议文件夹与综合纪要

状态：2026-09-12 采用，`xuwenzhe` 实现已随 `55267d6` 基线合入主线，见[整合记录](../sessions/2026-09-12-branch-integration.md)；**真实模型语义未验收**。补充 ADR-005 的有界工作流；明确区分"用户显式声明的分组"与仍然后置的"自动跨会记忆"。

## 背景

用户有 4–5 场同一主题的会议，需要一份综合纪要回答"哪些已定、哪些还悬着、谁负责、什么时候交"。

按字面，[产品定义 §7](../product-definition.md) 把自动跨会记忆列为可后置，§2 写"不把不同会议自动混成一个上下文"。但用户要的是**自己建文件夹、自己选会议**，关联由用户声明而非系统推断。AC-01 排除的是"未被用户选择"的内容，AC-25 禁止读取"无关"会议——用户放进文件夹的会议正是被选择且相关的。因此本功能与两条正文的原意不冲突，正文已按 AGENTS.md 的要求直接修订，替代项在[决策记录](../decisions.md)中明确。

## 决定

**1. 别名空间，而不是新的跨会议引用类型。** 引入 `ScopedRef{meetingId,id,rev}` 会波及每个渲染器、`validateRefs`、`artifactIsStale` 与 `applyArtifactPatch`。改为给成员会议及其原话／对象／关系／已记录决定分配短别名（`M1`／`s1`／`o1`／`r1`／`d1`），沿用既有 `new_` 批量局部 ID 的思路。`Ref = {id, rev}` 全程不变，**模型永远看不到真实 meetingId**，AC-25 的隔离属性原样保留。别名必须短：`id` 上限 100 字符，且前缀须与 `new_` 互斥。

**2. 独立的小 schema 调用，不复用 `interpret`。** 采用时记录过理解 schema 约33.8KB、有效投影约19KB的容量压力；后续实时表达已复用共享 schema 定义，这些数值仅属历史测量。当前独立报告请求按实际指令／schema计算容量，并受 `MEETING_COLLECTION_CONTEXT_BYTES` 限制，默认32,000字节；理解默认24,000字节。这不只是省空间：`Proposal` 能携带 `objects`／`relations`，一旦提交就要决定"这些对象属于哪场会议"，`resolveNewRefs` 无法表达，还会撞坏 `readsValid`／`UNREAD_OBJECT_WRITE`。**综合纪要是纯表达流程，零语义写入。**

**3. 确定性骨架在前，模型在后。** 决策、未决项与分歧由 `classifyOpenItems`（从 `reconcileCloseout` 抽出）确定性产出，不新增模型裁判调用——沿用[可靠性规范 §3](../agent-reliability.md)确立的原则。分歧检测三条规则，各带依据：`status === 'disputed'`、`challenges` 关系连通分量 ≥2、**跨会议标题趋同但 stance 分歧**。第三条才真正兑现"跨会议追踪"。模型只做去重、归组与叙述。

**4. 集合工作流不设 evidence 分支。** `EvidenceRequest` 是 `.strict()` 且**没有会议选择字段**——这是恶意提案无法指名别的会议的原因。与其放宽它，不如让集合路径**从不调用 `executeEvidence`**：当前由 `SessionService.drainCollectionReport()` 执行有界生成／校验循环，没有额外 LangGraph 图或 evidence 工具，工具预算为 0。

**5. `schema_version` 保持 1。** `store.ts` 硬抛 `STORAGE_VERSION` 且无迁移路径，改版本会砖掉所有既有存储。`collections` 作为 payload 第三个键，靠构造期机会式补默认，并在 `load()` 加 `Array.isArray` 归一。

**6. 新 lane 不提高总并发上限。** `call-pool` 仍为总计4、非理解合计3；转写用途最多2，其余每用途1。集合独立占 `'collection'` lane，与 `generate` 分开排队，但仍共享后台槽位，不保证所有负载下都无等待。集合有独立小时账目，不计入任一成员会议的账目。

## 后果与边界

- `CollectionReport.formulas` 上限为 **0**，且无工具观察可供计算绑定；程序阻止报告携带公式或冒充可信计算。文字／普通数值字段的语义真实性不能由此保证，禁止编造数字仍是要求，需要真实模型评估。
- 不支持 `ArtifactPatch`：`applyArtifactPatch` 结尾会 `Artifact.parse()`，把 12 块报告夹回 6 块。只做不可变快照。
- 文件夹创建要求1–8个有效成员。若汇总没有可引用的原话或已记录决定，报告返回 `COLLECTION_EMPTY`；有会议成员不等于有报告依据。确认记录是业务证据，不伪造为转写或语义对象。
- `assertCollectionCoverage` 目前只能保证"每条分歧的别名在报告中出现过"，**不能保证模型把两侧都当作分歧呈现**。这是弱保证，真实语义正确性仍须人工评估。
- 别名在构建汇总时惰性分配。报告保存该次汇总的 `aliasMap`，`aliasRefs` 记录报告实际引用的子集；两者不发送给模型。不能将其描述为只持久化实际引用的映射。
- 成员上限 8：超过之后"每个分歧都要出现"的完整性检查在预算内无法满足。
- 长会写放大、真实语义质量、模型是否真的并列呈现分歧，均未验收。

实现细则见[工作流说明](../agent-workflow-runtime.md#跨会议集合与报告)。原分支记录见[集合交接](../sessions/2026-09-12-meeting-collections.md)，整合后的版本拒绝、确认记录引用和持久化验证见[整合结果](../../tests/results/branch-integration-validation.md)。
