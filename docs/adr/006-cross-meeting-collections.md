# ADR-006：用户声明的跨会议文件夹与综合纪要

状态：2026-09-12 本轮采用，`xuwenzhe` 分支实现中，**真实模型语义未验收**。补充 ADR-005 的有界工作流；明确区分"用户显式声明的分组"与仍然后置的"自动跨会记忆"。

## 背景

用户有 4–5 场同一主题的会议，需要一份综合纪要回答"哪些已定、哪些还悬着、谁负责、什么时候交"。

按字面，[产品定义 §7](../product-definition.md) 把自动跨会记忆列为可后置，§2 写"不把不同会议自动混成一个上下文"。但用户要的是**自己建文件夹、自己选会议**，关联由用户声明而非系统推断。AC-01 排除的是"未被用户选择"的内容，AC-25 禁止读取"无关"会议——用户放进文件夹的会议正是被选择且相关的。因此本功能与两条正文的原意不冲突，正文已按 AGENTS.md 的要求直接修订，替代项在[决策记录](../decisions.md)中明确。

## 决定

**1. 别名空间，而不是新的跨会议引用类型。** 引入 `ScopedRef{meetingId,id,rev}` 会波及每个渲染器、`validateRefs`、`artifactIsStale` 与 `applyArtifactPatch`。改为给成员会议的原话／对象／关系分配短别名（`M1`／`s1`／`o1`／`r1`），沿用既有 `new_` 批量局部 ID 的思路。`Ref = {id, rev}` 全程不变，**模型永远看不到真实 meetingId**，AC-25 的隔离属性原样保留。别名必须短：`id` 上限 100 字符，且前缀须与 `new_` 互斥。

**2. 独立的小 schema 调用，不复用 `interpret`。** 实测 `SYSTEM` 6702B＋`providerSchema(Proposal)` 33825B，使 `interpret` 的有效预算仅 18961B——Proposal schema 吃掉了 60KB 请求上限的 56%。集合调用只输出报告，schema 约 12.7KB，预算提升到约 44KB。这不只是省空间：`Proposal` 能携带 `objects`／`relations`，一旦提交就要决定"这些对象属于哪场会议"，`resolveNewRefs` 无法表达，还会撞坏 `readsValid`／`UNREAD_OBJECT_WRITE`。**综合纪要是纯表达流程，零语义写入。**

**3. 确定性骨架在前，模型在后。** 决策、未决项与分歧由 `classifyOpenItems`（从 `reconcileCloseout` 抽出）确定性产出，不新增模型裁判调用——沿用[可靠性规范 §3](../agent-reliability.md)确立的原则。分歧检测三条规则，各带依据：`status === 'disputed'`、`challenges` 关系连通分量 ≥2、**跨会议标题趋同但 stance 分歧**。第三条才真正兑现"跨会议追踪"。模型只做去重、归组与叙述。

**4. 集合图不设 evidence 分支。** `EvidenceRequest` 是 `.strict()` 且**没有会议选择字段**——这是恶意提案无法指名别的会议的原因。与其放宽它，不如让集合路径**从不调用 `executeEvidence`**：该图没有 evidence 节点，工具预算为 0。

**5. `schema_version` 保持 1。** `store.ts` 硬抛 `STORAGE_VERSION` 且无迁移路径，改版本会砖掉所有既有存储。`collections` 作为 payload 第三个键，靠构造期机会式补默认，并在 `load()` 加 `Array.isArray` 归一。

**6. 新 lane 不提升吞吐。** `call-pool` 的 `total>=4`／每用途 1／后台 3 的规则不变；新增 `'collection'` lane 买到的是**互不饿死**——实时会议的 `generate` 是产品核心循环，40KB 的跨会议综合不能排在它前后。

## 后果与边界

- `CollectionReport.formulas` 上限为 **0**，图表绑定因 `toolObservations` 为空而结构性不可能。**报告不会有编造数字，也不会有模型算数**——这是 schema 层保证，不是提示词约束。
- 不支持 `ArtifactPatch`：`applyArtifactPatch` 结尾会 `Artifact.parse()`，把 12 块报告夹回 6 块。只做不可变快照。
- 报告必须至少引用一个来源（`validateRefs` 的 `requireSource`），因此**空集合明确报 `COLLECTION_EMPTY`**，而不是深层校验报 `MISSING_SOURCE`。
- `assertCollectionCoverage` 目前只能保证"每条分歧的别名在报告中出现过"，**不能保证模型把两侧都当作分歧呈现**。这是弱保证，真实语义正确性仍须人工评估。
- 别名按首次引用顺序惰性分配，只保留报告实际引用的别名；否则 5 场会议会持久化它看过的每个对象的别名行。
- 成员上限 8：超过之后"每个分歧都要出现"的完整性检查在预算内无法满足。
- 长会写放大、真实语义质量、模型是否真的并列呈现分歧，均未验收。

实现细则见[工作流说明](../agent-workflow-runtime.md)，验证范围见[本轮记录](../sessions/2026-09-12-meeting-collections.md)。
