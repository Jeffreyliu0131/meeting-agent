# Agent 工作流：当前实现与接续契约

协作组件图与事件路由已接入当前工作树，详见[协作实际运行时](collaboration-v1-runtime.md)，目标结构及逐组件触发见[设计](collaboration-v1-design.md)。下文保留既有M／X／P工作流说明。

2026-09-12意图增量：现有理解图已加入可选四类候选与私有草稿，未新增多人C/R图或发布服务；实际接入与限制见[意图说明](collaboration-intents.md)。

2026-09-12，实现提交`9b6886d`的实际行为说明；已通过本轮独立验收并推送GitHub。对应[实施任务书](agent-workflow-implementation.md)、[验收场景](agent-workflow-acceptance.md)与[最新独立验收](../tests/results/agent-workflow-acceptance-review.md)。本文描述源码行为；真实语义、音源、Windows 实机结果不能从代码或合成测试推导。

## 持续会议与个人推演

会议理解与个人请求分别通过 LangGraph JS 的 `meeting-understanding`／`personal-exploration` 图运行：interpret → validate → evidence／prepareRepair → interpret → result。普通成功一次理解调用；实时总上限2次，个人4次。图不持有数据库事务，没有自动网络重试或隐式节点重试。业务服务保存提案并提交；图状态不是会议事实数据库。

每个个人问题在发送命令事务内保存 requestId、来源与对象／产物版本及上下文，恢复继续同一基线。工作页可选择产物关联对象、移除标签、查看个人任务、取消及基于最新内容重新提问。最多同时调度3个个人请求；每个请求有独立锁，会议锁独立。个人产物用 branchId 隔离，不写会议对象、历史或共识。基础变化提示不等于自动重基。

供应商调用池总上限4，同时每种调用用途最多1个；非理解调用最多占3个槽，给会议理解留1个槽。个人4次模型、6次工具为持久上限；当前图每次模型最多提出1个工具请求，因此4次模型实际最多完成3次工具再返回最终结果。实时工具最多1次。表达最多2次生成；直接产物预览失败最多1次修复。已有小时调用／token预算继续执行。账目在调用前落库，崩溃不退款；排队后取消可能保守计为已用额度，不会超额补发。

## 可信提交与恢复

`workflow_jobs`、`workflow_proposals`、`workflow_success` 为 SQLite 的增量表，兼容既有 schema_version=1 聚合状态。旧会议、来源、对象、产物与决定保留。任务也在会议快照内供状态恢复；尚未把全部历史迁成规范化多表，长会写放大仍须单独实测。

任务保存 accepted 来源版本、可信 read set、请求hash、attempts、modelCalls／toolCalls、递增fence、5分钟租约、工具观察及不可变提案。服务分配所有新对象／关系的UUID；推荐模型用 `new_` 前缀，旧协议中未知ID按批内别名兼容。已有ID原样保留。服务解析条件、关系、图形与计划引用，缺失临时引用拒绝。

提交前核对读取的来源、对象、关系、产物、语言与标题版本；提供给模型的轻量目录也纳入读集。无关新发言不直接作废结果。历史证据另记为不可变读取，并锁定查询时看到的当前版本；读取旧记录不会自动触发冲突，查询后当前版本改变仍拒绝过期提交。未读已有对象不可盲写。提案哈希不可变；SQLite 约束每场会议同批次最多一个成功结果。领域变化、来源成功水位、表达任务、命令结果及成功批次同事务保存；写失败不发布内存新结果。

重开应用使旧任务fence失效，保留已用预算；已保存提案重放同一内容，已成功批次不再次推理。恢复内容／任务不恢复录音。未配置模型时保留内容和待处理状态。持久恢复依赖上述显式状态，未使用 MemorySaver，也未安装 better-sqlite3 saver。

已持久化但业务校验拒绝的提案标为rejected并隔离对应输入，不反复重放毒化批次；存储失败仍可恢复同一提案。模型失败达到2／4次上限后将对应来源版本隔离，后续来源可处理；超容量输入两次失败也隔离。隔离不推进成功水位，结束核对与界面仍显示缺口。新的来源修订可重新处理；自动处理不擅自抹掉失败历史。不保证仅靠程序识别所有语义依赖，存在输入缺口时不能宣称全场完整。

## 本会议工具与覆盖范围

生产 Provider 的 Proposal 接受 `evidenceRequest`，下一次理解收到 `toolObservations`。工具限定本会议与当前个人分支：

- `search_meeting`：本地词项／子串检索，支持双字中文与英文，不使用外部RAG。
- `read_sources`、`neighbors`：按来源ID／版本读取原话及邻近内容；旧版可查。
- `read_objects`、`read_artifacts`：按ID／版本读取；空refs时分页枚举当前目录。
- `dependency_impact`：确定性传递依赖查询。
- `calculate`：仅个人请求，使用已保存产物版本中的受控公式及参数覆盖。

每次最多20条，query最多300字符，观察累计预算12KB；不可分割项超限返回错误。返回 total／loaded／hasMore／cursor、版本引用、resultId、inputHash 与 known／conditional／unknown／error。工具失败作为结构化观察继续下一次有预算的判断，不能用报错编造结果。offset分页以当前本会议投影为准，并非跨变化数据库快照游标；具体引用仍由版本检查保护。

生产理解上下文上限同时受配置和完整请求60,000字节的保守预算约束：先扣除实际SYSTEM／JSON Schema与512字节余量，当前默认有效投影约19KB；补证据后的完整请求仍再次检查，超限明确失败而不截断原话。

初始对象目录最多150条、产物目录最多100条，目录独立于一份完整产物。容量不足进一步裁减目录并显示 hasMore；有效条件的完整证据放不下时以目录保留、标记 incompleteEvidence，并可分页补读。未加载不撤销对象。最小输入／选择基线仍超限会明确失败，不截断原话。不宣称一次有界图已扫描任意长度会议。

## 澄清与结束

澄清须先执行证据查询，随后保存具体问题、候选版本、影响对象、来源及状态。按规范化问题文本／候选版本／影响范围／分支组合去重，来源保存在提案及问题中。自然语言同义歧义是否等价仍由模型定位，程序不宣称能完美归并所有问法。

回答、取消、后续新会议来源消解、候选过期分别为 answered／cancelled／resolved／stale，保留历史依据。个人回答新建 personal request；不变成会议发言。等待回答不暂停会议。结束核对包含未成功来源、失败／等待任务、未决澄清、有效条件、输入缺口及失效产物；ready仍不表示模型语义已正确或全体已同意。

## 表达与可信计算

表达队列及产物ensure使用scope、branchId、purposeKey和有序objectIds。比较对象顺序不同视为不同用途实例；跨分支／范围不能因模型重用artifactId而合并。同实例保持产物ID，patch保留未修改块。模型需要继续使用已有blockId；程序不以标题猜同一块。

生成候选在预览前持久化。实际 Electron preflight 返回 RenderReport（blockId、errorCode及可得的边界尺寸）。最多一次定向修复，与生成共用持久预算。修复校验固定来源、对象、公式、内容与块ID；仅允许布局／几何改变。保守实现不自动允许任意换载体或重写措辞，以免借修画面改事实。失败保留上一版及既有过期标记，不把旧版标成最新。

Decimal计算增加符号单位维度检查：加减同维度，乘除组合／约分；people／person／人数等有限别名归一，不自动换币、换比例或推日期。缺参数返回null，除零／维度不一致拒绝。公式basis须逐字出现于所引来源；字面匹配不证明原话蕴含该算式，仍需语义验收。chart可绑定可信计算resultId，校验数值及单位；模型不能自报tool_computed。旧版普通数值图仍可读取，其来源存在不等于数值已获工具证明。

现有文字选择、历史视图、中文草稿和个人参数保护继续使用。新增澄清输入按问题ID保存当前UI草稿；不承诺重启恢复未发送草稿。可访问性和真实内容可读性不能由合成场景穷尽。

## 文件与依赖

稳定依赖：`@langchain/langgraph 1.4.14`、`@langchain/core 1.1.48`，精确lockfile，Zod4、TypeScript、ESM源码与CJS Electron utility bundle构建验证；无新原生SQLite依赖。核验依据：[官方Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api)与实际安装包。未启用LangSmith上报。

源码导航见[src/README](../src/README.md)。离线语义清单运行 `node --import tsx scripts/workflow-eval.ts`，不加载密钥或调用模型；真实评估仍须另获授权，使用现有 `scripts/model-eval.ts` 并人工填写评分。操作／验证记录见[实施session](sessions/2026-09-12-agent-workflow-implementation.md)。
