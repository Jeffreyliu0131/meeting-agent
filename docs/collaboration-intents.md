# 四类协作意图：私有准备与显式转交

私有准备源自 FTY，已随 `55267d6` 基线合入主线，并与 PR #3 正式协作衔接。本文说明当前私有草稿及转交边界；原分支[交接](sessions/2026-09-12-four-intents.md)／[验证](../tests/results/four-intents-validation.md)保留阶段范围，整合后的验证见[分支整合](../tests/results/branch-integration-validation.md)。当前仍是本地模拟，不等于跨设备协作上线。

## 使用与内容

在会议工作页的“协作意图”点击“开启自动准备”。旧会议默认关闭，新讨论经已配置的理解模型分析后可形成以下草稿：

| family | 已有字段／视图 |
|---|---|
| poll | 题目、带稳定key的选项、单选／多选标记，持续收集与私有预览 |
| assignment | 任务、交付物、负责人原话、时间原话、依赖引用；未知留空 |
| conflict | 冲突摘要、关联安排、待确认问题、处理建议；一律标待核对，不声称已证实／解决 |
| decision_confirmation | 拟定结论、适用范围、条件；不创建现有Decision记录 |

图片中的conflict_resolution在本实现统一为conflict。四类使用同一意图协议，分别渲染编辑字段，支持来源查看、字段保存、删除投票／分工条目、忽略建议。编辑失败保留输入；过期时需重新载入再编辑。手工保存的字段持久锁定，模型差异旁置显示。参与范围没有绑定名册，不把原话姓名当可信身份。

关闭自动准备只关闭当前会议的自动协作处理；既有草稿留在库中，重新开启可查看。开启前已成功处理的来源不自动重跑，可由后续明确回溯意图引用。个人推演不获得协作能力。结束会议停止collecting，已有草稿可读；重启不采音、不发布。

## 契约与运行流程

运行时契约在[src/contracts/intent-preparation.ts](../src/contracts/intent-preparation.ts)。Proposal新增可选intentPreparation，旧提案仍可读；供应商严格schema要求返回该字段，关闭时null。候选包含family、operation、expression、resolution、目标版本／批内目标、议题／对象／来源、收集方式、缺项、有序依赖及判别联合content。

理解与意图共用现有一次模型调用、补证据和最多两次实时调用预算。证据请求不得携带意图写入。源字段必须引用当前、非个人、非partial的会议来源；分工owner/time必须逐字出现在引用原话，否则拒绝。新对象引用随原有resolveNewRefs映射成服务ID。内容种类、条目key唯一性、投票选项规范化重复、有向批内依赖、版本和跨会议引用均校验。

完整流程：contextPayload投影活动协作状态 → provider输出结构化候选 → runWorkflow校验／补证据 → SessionService核对读集和fence → 原有事务同时保存语义、草稿、任务成功结果。私有草稿不另起模型图，content由同次理解输出；正式组件已有独立 C／R 工作流，显式转交由可信领域函数完成，不再为同一草稿重复生成一轮。

副作用意图publish/respond/close/cancel/apply_resolution/record_decision保存为独立待检查建议，不修改目标草稿或公开状态。建议性update也独立保存，不改原collector；合并手工字段后再次检查投票选项重名。否定、引用、假设、no_action、unsupported不建草稿。目标不明保存needs_clarification；选择准确目标版本后保存为suggestion，**首轮不会自动执行该候选的后续操作**。

整合后可信UI命令增加`collaborationPromote`：发起者明确点击才把当前私有草稿转成PR #3的组件预览；不自动发放／回应。四类来源和条件保留，口头负责人仍不自动绑定身份。转交重复点击复用组件；正式组件已被手工编辑时拒绝用旧私有草稿覆盖。

新增可信UI命令：collaborationEnable、collaborationEdit、collaborationDismiss、collaborationFreeze、collaborationResolve。编辑只允许各family的白名单字段，禁止改key、sources、kind、权限和状态；命令经原有幂等／单事务保存，失败不发布新内存状态。协作状态版本加入readSet，手工编辑使旧模型结果失效。

## 收集、来源与恢复

每会议最多四个collecting草稿；第五个保留为需检查建议。后续update须精确定位草稿版本；prospective更新至少引用本批、起始水位后的来源。议题相关性仍由模型判断，程序不把所有后续发言追加进草稿。

模型条目key稳定时，删除tombstone阻止条目复活；手工字段锁保留原值。程序没有声称能够识别换key后的任意同义条目，仍需语义评估。去重由根job事件及family／议题／对象集合／目的组成；无对象锚点时保留来源差异。忽略的同目的建议在相关对象版本未变时不重新唤起；语义同义定位的准确性不是确定性保证。

“停止收集并预览”在已接收final仍待理解或意图coverage不完整时拒绝并提示，用户可等待后重试。成功时保存freezeRefs并阻止后续模型改写该草稿；**首轮没有持久waiting发布命令或后台排空前沿任务**。未转写音频不在冻结来源内。此私有冻结命令不建立正式发布权限；后续 `collaborationPromote` 转为正式组件，再由正式协作的 ready、来源前沿和受众门槛控制发放。两条路径的等待／重试机制不能混为一谈。

Segment新增可选finality，旧记录视为final；partial可读但不进入会议模型投影及pending输入。correct可保存新final版本。来源／对象修订标记草稿needsReview，首轮保守保留该标记，不提供一键绕过核对。

草稿、版本历史、手工锁、删除项、来源与未处理范围保存在Meeting.intentPreparation，复用state schema_version=1的单事务保存和工作流恢复，不新增多人数据库表。大量历史仍随聚合保存；有界上下文省略草稿history和processedEvents，但草稿过多仍可能明确触发上下文容量错误，尚无协作目录分页检索。

## 实现范围与剩余验收

原FTY阶段只覆盖私有草稿。本次整合通过显式转交复用PR #3的本地名册、独立窗口、发布轮次、计数、本人回应、披露与确认门槛。FTY状态移至Meeting.intentPreparation，与Meeting.collaboration的正式轮次分开；启用私有自动准备后同次理解不再重复创建另一套自动组件。跨设备、真实身份和完整语义评估仍待验。

原 FTY 阶段未调用真实模型或音频；后续[Event 评测](event-evaluation.md)已建立60条多轮语料与指标，尚无真实模型分类F1、目标定位、字段来源、误纳率和成本的通过结果。自动准备仍属实验性。整合任务已有 Electron 与 Mac 包验证，不能继续笼统写 macOS 未测；Windows 真机、真实多人语义及正式组件的完整双语／窄窗仍按[运行时差距](collaboration-v1-runtime.md)保留。
