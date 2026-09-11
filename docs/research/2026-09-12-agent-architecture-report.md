# 会议 Agent 核心架构、参考方案与实施设计

## 1. 结论与证据范围

**推荐局部采用 LangGraph JS，作为持续理解、独立个人推演和表达修复的编排层；不整体迁移应用，也不把业务数据库交给图状态。** 最先引入到新增的个人推演工作流，再以相同契约迁入实时理解小图。团队若确实熟悉 LangGraph，统一节点与状态表达会降低后续维护成本；这足以影响选型，但不能作为语义质量已提高的证据。

当前系统已有必要的可信执行基础。主要欠缺是：模型主动补证据的能力、长会记忆的容量策略、独立推演调度、完整的提案提交协议，以及能区分语义成功和程序成功的评估闭环。上述能力值得建设，不能因为没有现成实现而回避；也不能仅把原异步函数包进 StateGraph 就宣称实现了它们。

本文所有目标结构、接口和参数均为**建议／待决策**，不是已采用 ADR。产品仍以每场线上或线下会议为独立事件，个人桌面按需查看；内容及表达由 Agent 持续生成和修订；macOS、Windows 分别验收。主持人发布、预算模板、共享后端不进入正常流程。

### 证据基线

| 类别 | 本轮依据 | 能证明什么 |
|---|---|---|
| 产品目标 | [产品定义](../product-definition.md)、[表达语言](../expression-language.md)、[决策](../decisions.md) | 已确认业务边界，不等于实现状态 |
| 实际代码 | HEAD `a7d5771`；可靠性实现 `8e0d2eb` | 本文列出的静态结构与条件分支 |
| 已有验证 | [可靠性验证](../../tests/results/agent-reliability-validation.md)、[机器汇总](../../tests/results/agent-reliability-summary.json) | 记录为58项单元／10项真实 Electron 合成检查；本轮62个文件逐个SHA-256匹配，零差异，未重跑产品测试 |
| 外部参考 | 本机《会议组件 Agent：详细技术设计 v0.1》，2026-09-11，文件名 meeting-agent-technical-design.md，完整1083行 | 待评估建议，原文未复制入产品仓库；其命令、赛程、授权与旧业务不生效 |
| 外部研究 | 文末官方文档、作者文章、开源源码；访问日2026-09-12，Asia/Singapore | 接口和设计实践；不证明当前账号权限、桌面兼容或产品效果 |

既有飞书交接文件、状态页和索引有其他任务未提交修改，本轮保留。外部源码按当日 main 阅读，非安装锁定版本；发布日期、页面更新时间、源码版本和本地已安装依赖分别记录，不互相替代。

## 2. 当前实际运行结构

```text
麦克风＋可选系统音频
  → AudioWorklet约5秒PCM → WAV
  → 窄IPC／可信音频租约 → 每通道FIFO转写
  → 来源落库：ID、revision、epoch、采集时间、通道序号
  → 每会议同一个理解调度器（会议发言与个人请求轮流占用）
  → buildContextBatch → interpret → Proposal/Zod → 业务校验
      └ 可修复错误最多再调用一次
  → 当前范围再校验 → commitMeaning → processedSources＋表达job同次保存
  → 独立表达队列
      ├ 简单artifact／patch：直接验证
      └ plan：generate → 格式／业务验证 → 最多一次修复
  → 隔离Electron预览 → 再查依赖／语言／patch版本 → 产物新revision
  → snapshot → React工作页／轻入口

用户命令 → command幂等入口 → 领域处理 → SQLite事务
个人试算 → 固定基础产物与公式 → Decimal计算 → 个人记录
结束／恢复 → refreshIntegrity＋reconcileCloseout → 可追溯核对结果
```

来源位置：[采集](../../src/integrations/capture.ts)、[切片](../../public/pcm-worklet.js)、[worker](../../src/service/worker.ts)、[会话编排](../../src/service/session.ts)、[存储](../../src/service/store.ts)、[上下文](../../src/agent/context.ts)、[生成预览](../../src/desktop/preflight.ts)。源码锚点见第12节。

### 2.1 输入与实时性

真实适配器是 `/audio/transcriptions` 文件转写请求；默认配置为 `gpt-4o-transcribe`，理解默认 `gpt-4.1-mini`。这是代码默认值，不表示账号当前可用或选型已经优于其他模型。当前没有 LangGraph 依赖，也没有 Zoom RTMS 接入。

每通道转写有序，不同通道可并发；包含在途请求的音频缓冲上限30秒／2MB。溢出保留可见缺口，并继续采集。来源按采集时间排序，处理水位按ID＋revision管理，可靠性任务已处理跨会议尾部音频归属。身份未知合法，不能把系统音轨看成某位具名参会者。

端到端等待至少包含切片等待、STT排队与请求、批次合并、理解、必要生成与预览。约5秒切片与默认1.5秒合并是实现参数，**不是实测延迟**；不能简单相加得到p95，也不能仅测模型请求就声称实时。

### 2.2 理解、表达与状态

`SessionService.process` 一次主要模型调用同时提出对象、关系、焦点和表达动作；整个 Proposal 先经 schema，再做来源／含义／关系等校验。语义提交不等复杂生成，表达任务独立进行；这已经实现了参考文档的小图核心思想。

`command()` 对用户命令保存请求哈希和结果，SQLite 将快照与命令记录同事务写入。但**自动语义提案不经过这个 command 入口**：它直接在 process 内更新克隆状态并保存处理水位。单写进程及顺序理解约束让当前实现可工作，不能因此把它描述为完整的持久语义命令系统。

表达有对象、关系、来源、语言依赖；提交前再次验证，patch另查baseRev。相同purposeKey＋scope的可见产物复用ID。对象ID仍由模型提出；`commitMeaning` 根据同ID查找替换，并自行增版，没有完整的批内临时ID映射。

### 2.3 已有可靠性机制与语义边界

| 机制 | 当前实现 | 未证明的效果 |
|---|---|---|
| 含义区分 | asserted／proposed／conditional／committed／unknown；负责人、时间与证据原文匹配 | 引用文本真实不代表它蕴含对象结论；“我不能负责”包含“我”，仍需正确理解否定 |
| 持续条件 | active约束、问题、分歧、承诺、待核对对象优先进入上下文 | 初次抽取遗漏、隐含条件及错误依赖无法靠后续保留规则自动修复 |
| 修订传播 | dependencyRefs＋reviewRequired＋历史版本 | 标出待核对不等于已经算出正确的新影响 |
| 个人隔离 | meeting投影排除request／个人产物／scenarios；个人结果不改会议对象历史 | 计算资源和调度仍共享；不是独立的长期推演工作流 |
| 结束核对 | 全场保存对象、未处理来源、缺口、失效产物、未决项确定性检查 | 未被建模的承诺或分歧仍可能漏报；ready不是纪要完整或会议共识 |
| 计算 | Decimal＋有限四则运算程序、范围／除零／未知检查 | 单位正确、公式来自原话、文字中的数值与计算结果一致尚非完整程序保证 |
| 生成安全 | HTML/SVG标签白名单、禁脚本／网络／任意控件；可信控件执行操作 | 安全渲染不等于表达清楚或事实正确 |

## 3. 真正薄弱处及业务后果

以下区分“已确认静态缺口”和“需要实验确定的影响”。不把潜在竞争直接写成已发生的用户事故。

### 3.1 最高优先级：缺少真实语义成效证据

[model-eval.ts](../../scripts/model-eval.ts) 会把合成讨论送给真实模型并记录期望检查，但最终明确要求人工评估；它没有自动完成对象定位、条件保留、语义蕴含等评分。本轮未发现已验收的真实模型结果。已有58项测试是重要基础，却主要证明程序边界及合成协议。

业务后果是：界面、来源链接、状态与schema可能全部正常，内容仍然误解了“如果”“还没定”“不是这个方案”。如果先换框架而不建立基线，将无法区分提升、退步和随机波动。

**建议**：按输入质量、证据召回、语义状态、可信提交、表达可读性逐层评分；保留每轮上下文和输出的可复核标识，先人工标注再校准自动评分。避免以总结措辞相似度代替任务结果。作者实践也强调评估最终环境状态，而不仅看Agent最后说了什么。[S9](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)

### 3.2 主动证据回查与长会容量缺口

当前检索是词项／中文双字、近期片段、相关对象和邻接关系。模型提示词明确说没有工具，无法发现上下文不足后再查原话。主动有效记忆全部保留，超限报`CONTEXT_MEMORY_LIMIT`；没有分页核对工作流。

这会产生两类问题：同义改写或远距离指代找不到证据；长会有效约束很多时，安全地报错，却无法继续推进理解。增大上下文只是缓冲，不解决选择问题。

另有静态细节：`buildContextBatch`把artifacts缩成一份相关产物后，`contextPayload`才从它生成artifactIndex；因此实际发送的不是全场紧凑产物索引。旧用途不在视野时，重复新建的风险增加。应拆分全场轻量索引与当前完整产物，不把所有历史正文重新塞回模型。

### 3.3 并发前必须补提交边界

当前process在提交前检查来源修订、语言版本，再按当前投影业务校验；Proposal中没有可信对象read set。来源未改、依赖对象或话题选择状态已改时，当前校验不能完整证明模型仍基于有效读集。这里不是声称现在已有多人任意对象编辑，而是说明一旦引入独立推演／更多后台核对，就必须先增加CAS。

批次、attempt、提案与命令结果没有完整持久关联，重启可能重新推理尚未标记处理的来源。现有一次快照保存能原子提交理解、水位和表达job，必须保留这一优点；再把随机模型输出保存为可重发的同一提案，避免同commandId绑定不同输出。

### 3.4 个人工作不应拖慢自然会议

`buildContextBatch`把request单独组成一批，但所有批次仍受同一`running`锁约束。一次耗时推演会延迟之后的会议理解。新发言仍然入库，不能说音频已被阻塞；被拖慢的是“理解追上会议”。

表达队列的合并键目前仅比较purposeKey，没有比较scope（session.ts约556行）；提交阶段才按scope区分产物。若个人与会议任务复用同一purposeKey，静态分支存在取消另一范围排队任务的可能。建议立即纳入迁移前合成回归，并让唯一键始终包含scope和对象角色。

### 3.5 “有来源”与“有依据”仍有距离

`validateMeaning`检查quote是原文子串，且owner／deadline值在quote中；它不能识别断章取义。公式basis只要求非空，`validateArtifact`验证sources存在并调用calculate，没有核实basis逐字来自原文或做量纲分析。chart的number＋unit也没有完整的可信数值投影协议。

建议将事实性数字优先绑定对象字段或可信ToolResult，计算表达按单位类型校验；模型只能生成解释与布局。无法确定数学关系时保留unknown或个人假设，不能让一个有来源ID的虚构公式获得“工具计算”的权威外观。

### 3.6 表达修复还差反馈回路

生成器内有最多一次格式／业务修复，但`await preview(a)`在该循环之外。预览失败会记failedExpression、保留旧版；worker只接收ok／failed，详细的RENDER_OVERFLOW等诊断没有传回生成器。现在不能宣称“渲染失败会自动定向修复”。

预览在1056×900窗口检查横向溢出、元素数量及HTML/SVG整体边界，不能检验所有标签遮挡、来源缺口、关系方向或200%缩放。正确方向是补RenderReport和一次受约束修复，再按目标尺寸验收，而不是所有输出都增加视觉模型裁判。

### 3.7 存储与故障处理仍是原型规模

SQLite保存整个meetings聚合JSON，`runCall`前后也会保存；历史增长导致序列化与写放大是可由代码推断的风险，实际拐点未测。任务数组、内存锁和单个failedExpression不足以支撑多个长期任务；当前清晰报错优于伪造成功，但缺少按任务独立重试、租约和失败隔离。

此外，失败批次不会推进processedSources，下次仍从最早未处理片段选起；持续不可处理的片段可能让后续理解反复遇到同一失败。应建立“已接收／已尝试／已成功／待核对”的独立状态：超过有界重试后隔离失败批次，允许无依赖的新话题推进，但凡依赖该缺口的结论继续标不完整。不能通过把失败写成成功来解除阻塞。

## 4. 参考技术文档逐项映射

类别：**等价**＝已有同类机制但实现细节不同；**吸收**＝建议采用；**调整**＝保留原则、改成当前产品语义；**不采用**＝业务或部署不适用；**待证**＝需实验／账号／真机。

| 参考章节／主题 | 分类与当前对应 | 本产品取舍 |
|---|---|---|
| §1 预算会议、主持人发布、Windows优先 | 不采用 | 每场任意会议、个人入口、双平台；预算仅测试例 |
| §2–3 TS、可信服务、数据权威 | 等价 | 保留Electron utility process、React与SQLite，不转为云服务 |
| §4 每语义批次LangGraph小图 | 吸收 | 相同interpret接口，保持一次主调用；不是多Agent方案 |
| §4 普通async替代、无首版checkpoint | 等价／吸收 | 短图可无checkpoint，恢复由持久job＋幂等提交承担 |
| §4 return_no_change失败出口 | 调整 | failed／rejected／deferred和成功无变化分开；失败不得推进成功水位 |
| §5 stated／assumed／decision快照 | 等价／调整 | 沿用meaning、origin和personal／meeting；committed不等于共识 |
| §5 固定PlanData与发布舞台 | 不采用 | 通用语义对象＋自主表达；不加入presenter门槛 |
| §6 newRef→服务分配ID | 吸收 | 新对象／关系批内引用映射，旧ID原样保留 |
| §6 ensure唯一身份 | 调整 | 用scope＋目的＋规范化对象角色；不用固定budget模板作为身份 |
| §6 候选定位与歧义 | 吸收／调整 | 可信选中对象只用于个人请求；匿名会议发言不能借个人焦点猜指代 |
| §7 结构化提案、模型无权限字段 | 等价／吸收 | 保留Zod和ModelPort；补可信读集与错误联合类型 |
| §7 Responses＋官方SDK | 待证／可选 | 现有fetch Chat Completions已有strict schema；协议迁移与LangGraph分开 |
| §8 稳定段落、epoch、revision、背压 | 等价／调整 | 已有切片队列和来源版本；实时流补partial/final及item映射 |
| §8 STT修订传播 | 等价／待证 | 已标记依赖失效；真实修订链与隐含条件另验收 |
| §9 提案和命令分离、read set/CAS | 部分等价／吸收 | 用户命令有幂等，自动语义补持久提案和完整读版本 |
| §9 任务租约、attempt、成功批次唯一 | 吸收 | 在本地SQLite实现，不必引入Redis或PostgreSQL |
| §9 撤销与已确认保护 | 部分等价／调整 | 保留历史；通用补偿命令后置，不假设当前已有完整undo |
| §10 确定性预算公式 | 调整 | 吸收确定计算、未知／条件状态；不固定SGD和预算公式 |
| §11 固定组件目录、generation、后台job | 部分等价／调整 | 保留独立表达job、稳定ID；结构和数据更新分离 |
| §11 preview后发布 | 不采用／调整 | 预览是内部验证；成功后个人可见，不新增主持人批准 |
| §11 合并通知与澄清卡 | 吸收 | 仅有意义的变化提醒；待澄清不阻塞后续输入 |
| §12 缓存、视图、输入草稿分开 | 等价／调整 | 保留现有React草稿与局部保护；不为包名引入Zustand/Query |
| §13 Zoom注册、身份、RTMS | 不作为核心／待证 | 可选未来输入adapter；本轮不核验scope套餐、不接平台 |
| §14 流式STT备用 | 调整／待证 | 值得实验为通用低延迟输入；不是远端音源或实名保证 |
| §15 Electron隔离 | 等价 | 保留窄IPC、无Node生成内容；配对协议当前不需要 |
| §16 SQLite多表、任务恢复 | 吸收／分阶段 | 先任务／提案／读版本，再按测量拆大快照；不照搬members/credentials |
| §17 HTTP/WSS、共享权限投影 | 调整／后置 | 当前本地IPC；保留单调revision与快照恢复，公网鉴权另立范围 |
| §18 draining、尾段截止 | 部分等价／待证 | 已有尾音计数与缺口；不因控制窗口关闭自动停止个人会议 |
| §19 隐私和受控执行 | 等价／继续保留 | 新检索／工具保持本会议与当前scope；不开放外部动作 |
| §20 追踪、预算、延迟分层 | 部分等价／吸收 | 已有调用账目；补batch/job/commit关联和分阶段时间 |
| §21 语义集与真机集成 | 吸收／调整 | 扩展到非预算会议、隐含条件、中英、乱序与真实双音源 |
| §22 四小时赛程和降级 | 不采用 | 未核验的赛程与工时不是本轮实施依据 |
| §23 新建monorepo、当前无代码 | 不采用 | 基于现有模块抽取，不重新搭应用脚手架 |
| §24 Linux共享部署、账户权限 | 不采用／待证 | 保持本地桌面；版本和账号在后续实验中明确核验 |
| §25 来源目录 | 调整 | 回到当日原始页面；旧日期不保证接口仍相同 |

需要分清两层“无变化”：当前`Proposal.action=no_change`是表达动作，仍可携带合法对象更新和新证据；拟议工作流的成功无操作结果才表示没有语义写入。二者都不等于处理失败。“失败无输出”必须保存错误与未决状态，不能计入成功水位；“歧义已登记”可记录本批已审阅，但必须建立独立未解问题，不能伪装成问题已解决。

## 5. 少量相关实现的深入比较

### 5.1 LangGraph JS：采纳编排层，不借用数据库权威

官方将其定位为可混合确定步骤与模型步骤的低层运行时，独立使用不要求完整LangChain agent框架。真正适配的是检索分支、有界修复、个人请求暂停恢复及节点追踪，而不是把每句会议拆成多位Agent。[S1](https://docs.langchain.com/oss/javascript/langgraph/overview)

源码阅读了`libs/langgraph-core/src/pregel/retry.ts`：无retryPolicy时不自动重试；配置策略后才按次数与错误类型重试，图控制流中断单独处理，重试清理的是图内写入。当前provider抛出`Error('MODEL_HTTP_401')`这种字符串，默认错误分类未必识别其HTTP状态；接入时必须映射typed error或提供明确retryOn。**外部SQLite提交不会被清理图写入这一动作回滚。**[S4](https://raw.githubusercontent.com/langchain-ai/langgraphjs/main/libs/langgraph-core/src/pregel/retry.ts)

官方checkpointer源码把checkpoints和writes按thread／namespace／checkpoint保存，`putWrites`有自己的事务；这不是本项目领域事务的一部分。因此恢复正确性应由“已保存提案→固定命令→查询原结果”保证，不能靠两个SQLite文件恰好都保存成功。[S5](https://raw.githubusercontent.com/langchain-ai/langgraphjs/main/libs/checkpoint-sqlite/src/index.ts)

维护与部署：核心包源码当日为`@langchain/langgraph 1.4.15-rc.0`，MIT，声明Node≥18、core与Zod peer范围；这是main预发布快照，**不是建议直接安装RC或已核验npm稳定版**。仓库旧`libs/langgraph/package.json`只是另一个包，不能拿它的版本代替核心。发布页可见9月9日生态包预发布活动；维护活跃是观察，不是兼容保证。官方节点timeout／errorHandler文档要求≥1.4.0；选定稳定版后再锁版本与执行接口验证。[包元数据](https://raw.githubusercontent.com/langchain-ai/langgraphjs/main/libs/langgraph-core/package.json)、[发布记录](https://github.com/langchain-ai/langgraphjs/releases)、[故障处理](https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance)

本地可直接在utility process使用OSS runtime，无需LangSmith托管、HTTP Agent Server或Python sidecar。若个人推演需要持久checkpoint，官方SQLite包1.0.4源码依赖`better-sqlite3`，与当前`node:sqlite`不同；先验证Electron ABI、macOS/Windows打包与恢复，再决定采用官方saver还是实现经过契约测试的node:sqlite适配。[S6](https://raw.githubusercontent.com/langchain-ai/langgraphjs/main/libs/checkpoint-sqlite/package.json)

### 5.2 LiveKit Agents JS：借鉴连续媒体职责，不迁成会话机器人

源码`stt.ts`区分interim、final、end-of-speech、usage等事件，speakerId按供应商能力可选；`agent_session.ts`把音频识别、会话、工具执行、状态事件和telemetry拆开。值得借鉴的是稳定段落与暂态分开、资源释放、独立媒体状态、分阶段指标。[STT源码](https://raw.githubusercontent.com/livekit/agents-js/main/agents/src/stt/stt.ts)、[会话源码](https://raw.githubusercontent.com/livekit/agents-js/main/agents/src/voice/agent_session.ts)

它主要服务运行于服务器的实时可编程参与者，常围绕收听、发言、打断与回合结束组织工作。本产品默认是被动理解会议，不能把“人开始说话就取消Agent回答”照搬成“新片段取消上个理解任务”，否则讨论密集时永远交不出结果。音频静音也不等于话题或议题结束。[项目定位](https://github.com/livekit/agents-js)、[回合文档](https://docs.livekit.io/agents/logic/turns/)

部署取舍：完整路线涉及LiveKit连接／媒体基础设施和供应商插件，不是给现有桌面加一个STT函数即可。当前不推荐整体引入；如果未来产品要真正入会、说话、远程WebRTC协作，再评估完整运行时。核心Apache-2.0；仓库另列MODEL_LICENSE，模型资产不能仅按核心代码许可证处理。发布页可见`@livekit/agents@1.8.0`于9月5日发布，README仍提示1.5.0，说明版本应看发布／包而非宣传文字；未进行桌面部署验证。[许可证入口](https://github.com/livekit/agents-js)、[发布页](https://github.com/livekit/agents-js/releases)

### 5.3 A2UI：吸收结构／数据分离，不整体替换现有渲染器

A2UI用声明式组件列表和ID引用组合界面；客户端把受信任catalog映射到真实控件。其v0.9 schema把createSurface、updateComponents、updateDataModel和deleteSurface分开，能支持结构不变时仅更新数据；这些思想适合会议增量表达。[README](https://raw.githubusercontent.com/a2ui-project/a2ui/main/README.md)、[协议schema](https://raw.githubusercontent.com/a2ui-project/a2ui/main/specification/v0_9/json/server_to_client.json)

对本产品最有价值的改变：Agent自由选择图、表、文字与控件组合，数值和来源通过可信字段绑定更新。这样既不退回固定预算卡，也减少每次改数字都生成整块HTML。A2UI本身不提供本产品的来源版本、personal／meeting权限、命令CAS或语义正确性；需要宿主继续约束。

当日README标记当前生产协议v0.9.1、v1.0为候选，同时总体仍为早期公开预览。v0.9.1规范元数据写Created 2025-11-20、Last Updated 2025-12-03；这是规范页字段，不是当日仓库最后提交日期，发布页不足以核验后者。core为Apache-2.0。v0.9.1的prompt-first取舍依赖生成后校验，不能直接假设复杂catalog可原样喂现有strict Structured Outputs。[当前规范](https://a2ui.org/specification/v0.9.1-a2ui/)、[LICENSE](https://raw.githubusercontent.com/a2ui-project/a2ui/main/LICENSE)

建议先在现有Artifact协议中吸收绑定与稳定组件身份，暂不新增A2UI、AG-UI或A2A全套传输依赖。只有出现多宿主互通需求，再试验一个A2UI adapter；普通桌面IPC无需因此换协议。

### 5.4 QMSum：把“找对证据”从“总结得像”中分离

2021年NAACL的QMSum用query、summary与相关发言span研究会议按问题总结。仓库数据schema允许一个问题关联多个非连续span，提供定位与总结分开的路径。对本项目更有价值的是评估“回到旧话题时找齐分散证据”，不是部署2021年的总结模型。[论文](https://aclanthology.org/2021.naacl-main.472/)、[数据结构与定位入口](https://raw.githubusercontent.com/Yale-LILY/QMSum/main/README.md)

这是离线研究数据，不含本项目持续状态写入、个人隔离、STT乱序修订与UI更新验收。仓库LICENSE为MIT，但不能据此宣称所有原始会议音频均可再分发；实际引入数据前需检查对应原始语料条件。本轮只读schema与方法，不下载数据或训练模型。它是历史研究资产，不按“活跃生产框架”评价。[LICENSE](https://raw.githubusercontent.com/Yale-LILY/QMSum/main/LICENSE)

### 5.5 Harness实践：保持可替换的边界

Anthropic 2024年的文章强调简单可组合工作流，但页面已明确提醒工具生态变化，不能把它作为今天拒绝框架的绝对依据。2026-04-08的Managed Agents文章进一步把session记录、harness循环与执行环境分开，并指出旧模型的补偿机制可能在新模型上成为负担。这里可迁移的原则是稳定接口与持续重评，不是照搬其托管服务或文件系统工具。[S7](https://www.anthropic.com/engineering/building-effective-agents)、[S10](https://www.anthropic.com/engineering/managed-agents)

本产品的Harness应明确包含：来源投影、工具白名单、调用预算、调度、验证、命令提交、表达预览、诊断与评估。LangGraph承担其中编排部分。提示词、模型、检索算法和编排库能分别替换，才能知道哪项改动产生收益。

## 6. LangGraph三种路线的明确取舍

| 路线 | 收益 | 成本／风险 | 判断 |
|---|---|---|---|
| 持续自写async | 依赖最小、运行模型直观；当前短链可用 | 检索分支、独立任务恢复、修复与追踪继续手写，团队若熟悉LangGraph会重复建设 | 可保留为对照runner和回退实现，不作为长期首选 |
| 局部LangGraph JS | 明确节点／状态／分支；统一个人推演和实时小图的调试方式 | 需要学清state reducer、interrupt、重试与checkpoint；增加依赖和版本验证 | **推荐目标方案** |
| 整体迁移／整场会议一个大图 | 看起来统一；有托管部署入口 | 把采音、UI、DB、长期等待混成图；状态复制、恢复副作用和锁阻塞更难 | 当前不推荐，缺乏相称业务收益 |

团队熟悉度的敏感性：如果至少一位成员能独立完成自定义状态、失败恢复和部署排查，且另一位能读懂图，局部引入的价值明显上升。如果只是用过教程，优先顺序仍可保持局部采用，但把持久恢复视为新学习成本；若无持续维护者，先保留async runner，不能以选型名义造成无人能修的系统。建议通过一次合成故障定位／加节点演练观察，不用虚构评分或询问偏好替代能力核验。

### 实时主链和用户推演采用不同工作流

| 维度 | 实时理解图 | 个人推演图 |
|---|---|---|
| 触发 | 稳定来源批次、修订 | 显式个人问题、比较、条件变更 |
| 目标 | 及时维护当前会议含义 | 解决一个有界个人问题 |
| 模型调用建议硬上限 | 正常1次，总计至多2次；回查后的再判断和修复共享第二次额度 | 总计至多4次，含规划、补证据、解释与修复；工具执行另限6次 |
| 超出复杂度 | 登记待核对／延后分析，不自由循环 | 返回部分有据结果与缺失项；用户后续可继续 |
| 持久化 | 初期不需要图checkpoint；job与提案必须持久 | 独立job，存在暂停／长任务时使用持久checkpoint |
| 等人 | 图退出，业务库保存clarification | 可interrupt，但只暂停该requestId |
| 写入范围 | 合法会议对象提案 | 个人分支、个人产物；不能自动改会议对象 |
| 优先级 | 输入接收最高，理解有保留预算 | 可排队／取消；不占用主链锁 |

这些是建议初值，不是最优性能结论。任何网络重试也计入总调用硬上限；不能图重试×SDK重试×修复次数叠乘。复杂表达另有至多2次生成调用预算，不计成“主链只调用一次”而隐去。

## 7. 目标结构、节点与接口

```text
Capture／STT adapter → SegmentLog → Scheduler
                                      ├ LiveGraph(batchId)
                                      │   context → interpret → validate
                                      │      ├ needs_evidence → retrieve → reinterpret
                                      │      ├ repairable → repair_once
                                      │      └ proposed / no_change / clarification / failed
                                      └ PersonalGraph(requestId)
                                          context → choose_step → bounded read/compute
                                            → verify → answer/plan 或 independent wait

所有模型输出 → ProposalRepository → TrustedCommandExecutor
                  → 短事务：读集CAS、ID映射、领域变化、处理结果、表达job
                  → ExpressionWorker：generate/bind → validate → preview → repair ≤1
                  → commitArtifact → revision snapshot → UI

DB：原话／版本、语义对象、依赖、决定、个人分支、提案、命令、任务
checkpoint：某个个人job的执行位置和已完成节点输出
Trace：阶段、引用、错误、耗时／用量；不代替DB事实
```

图只返回提案；可信执行器始终复验当前版本与权限。节点可以是普通函数；无需把全部领域函数改成LangChain Tool。会议理解图和表达图不是互相自治的多Agent，二者遵守同一个提交协议。

### 7.1 建议的图状态

以下为接口草案，未编译、未写入运行时契约：

```ts
type RunState = {
  schemaVersion: number;
  graphVersion: string;
  runId: string;
  meetingId: string;
  batchId?: string;
  requestId?: string;
  scope: 'meeting' | 'personal';
  inputRefs: SourceVersion[];
  contextSnapshotId: string;
  readSet: ReadVersion[];       // 可信装载器产生，模型不能覆盖
  evidenceManifest: EvidenceHit[];
  pendingQuestions: string[];
  proposalId?: string;
  validationIssues: Issue[];
  callsUsed: number;
  toolsUsed: number;
  deadlineAt: string;
  outcome?: 'proposed' | 'no_change' | 'clarification' | 'failed' | 'deferred';
};
```

状态存本次工作所需投影和引用，不存全场可写Meeting对象、不无限追加messages、不携带key、IPC对象或数据库连接。工具／模型通过runtime依赖注入，不能序列化进checkpoint。reducer对证据按id＋revision去重；计数由可信runner增加，不让模型改预算。

数据库是原话、语义版本、确认快照、命令和任务的唯一权威。索引可重建，checkpoint可清理，二者损坏不能删除会议事实。checkpoint与业务store属于不同职责，即便物理上同一数据库也不意味着自动共用事务。

### 7.2 节点职责与源码落点

| 节点／模块建议 | 输入→输出 | 位置与边界 |
|---|---|---|
| claimBatch / claimRequest | 持久任务→租约及输入refs | 新增`src/service/jobs.ts`；不在模型节点领取音频 |
| loadContext | 固定输入refs＋scope→投影／可信read set／证据清单 | 从`src/agent/context.ts`抽出ContextPort；保留现有策略作为基线 |
| interpret / chooseStep | 结构化投影→提案或有限EvidenceRequest／ToolRequest | 新增`src/agent/graphs/live.ts`、`personal.ts`，调用既有ModelPort |
| retrieveEvidence | 限定查询→版本化原话、候选对象、完整性提示 | 新增`src/agent/tools/meeting-search.ts`；仅本会议与允许scope |
| calculate / compare | 明确输入与单位→可信ToolResult | 扩展`src/domain/calculator.ts`，新增工具适配；不执行任意代码 |
| validateProposal | 提案→精确path／code／可修复标记 | 复用并逐步从`renderers/validate.ts`分离语义校验到domain |
| persistProposal | 提案＋上下文hash→immutable proposalId | 新增`src/service/proposals.ts`；重试重发同一提案 |
| executeProposal | proposalId＋可信actor＋read set→Applied/Conflict/Rejected | 从session提交逻辑抽到`src/service/execute-proposal.ts` |
| generate / validate / preview / repair | 表达job→候选与RenderReport→验证后的产物 | 抽取`src/agent/graphs/expression.ts`及`src/service/expression-worker.ts` |
| reconcile | 已存全场状态→closeout／待核对项 | 保留`src/domain/meaning.ts`、`closeout.ts`，不改为模型自述成功 |

不把音频采集、窗口生命周期、SQLite领域事务、React草稿、公式执行内核迁入图。provider可继续使用fetch或切换官方SDK；LangGraph不要求同时迁移Responses API。主流程schema拆成独立的语义与表达意图片段后，可避免表达格式错误使合法语义整体重试；必须先定义片段独立验证规则，不能从坏JSON中随便截取半份对象提交。

### 7.3 提案、服务端ID与CAS

新对象建议用`{newRef:'n1'}`，旧对象用`{id:'existing'}`。模型不能自填永久ID、actor、已验证版本。一次事务先为所有newRef分配ID，再解析关系／条件／表达引用，处理循环引用时先分配后校验；遇到重复临时ref或悬空ref整笔拒绝。

ID分配解决身份可信性，**不自动解决同义重复对象**。新建必须经过候选定位：明确独立对象可新建，不明确则查回历史或澄清；不能只按标题相等合并不同方案。已有ID不重编，历史SourceRef与ArtifactRef继续有效。

可信read set包括用于结论或定位的对象rev、关系rev、来源rev、输出语言配置，以及确实影响指代的焦点／索引版本；不要仅记录“将修改的对象”。所有上下文候选先保守纳入，后续在测得冲突过高时细化读取范围，不由模型自行删读集。仅新增无关发言不应使已处理批次失效。

建议持久表先新增：`agent_jobs`、`agent_proposals`、`agent_batch_results`、`artifact_keys`；沿用commands。唯一成功batch键用meetingId＋排序规范化的来源ID／revision＋scope；修订是新批，重试attempt不是新输入。job输入覆盖重叠时同时核对来源处理记录，避免换一个batchId就重复应用同一来源。

短事务内：查命令结果／请求哈希 → 验证租约fencing token及scope → 检查读版本与来源处理记录 → 分配ID／执行领域操作 → 保存成功批次结果、水位与表达job → 保存命令结果。网络／模型／预览都在事务外。

### 7.4 ensure表达身份与增量更新

唯一身份建议为meeting＋scope＋purposeId＋规范化object-role binding；scope为personal时还包含个人分支标识。对象角色区分基准／备选；无序对象集合可排序，有序角色不能乱序。purpose由服务维护稳定别名，模型的purposeKey只作建议，不能凭每批新字符串绕过复用。

已有产物保持ID，内容变更增加revision；结构版本与数据依赖版本分开。普通数值变化优先让可信绑定更新view model；如果数值变化让原图刻度／布局不再合适，再触发表达重排。历史版本保存完整resolved view，避免回看旧图时悄悄显示新数字。

## 8. “更强Agent”应体现的能力

### 8.1 有界主动检索

先确定性提供本批、有效条件索引和相关候选；模型发现“证据缺失／指代多解／依赖待核对”时返回EvidenceRequest。工具支持按对象ID读版本、按话题／词项查发言、按SourceRef取邻近片段。命中返回原话、revision、时间依据、选中原因和hasMore；不能把检索摘要当原始来源。

第一次优先使用当前词项＋对象／依赖查询，再试SQLite FTS5与中文预分词索引。FTS5原生trigram对少于3个Unicode字符的全文查询不匹配，不能直接替代现有中文双字策略；短中文名词、别名、中英混说需专门样例。[S15](https://www.sqlite.org/fts5.html)

只有在离线召回评估发现同义／跨语言缺口后，再加入embedding作为候选召回，和词项／图依赖融合；向量相似不授予事实成立或身份同一。embedding索引保存source revision与模型版本，来源修订后失效重建。无需先部署外部向量库，更不把跨会长期记忆加入本轮默认范围。

对于必要记忆超限，保留全部有效事项的紧凑目录与数量／省略范围，按本批相关依赖装载详细原文；未装载不等于撤销。全场影响核对拆为有水位的分页job，未扫完前显示coverage incomplete。若当前最小证据闭包本身仍超限，保持失败／待拆分，不能以压缩为名丢关键条件。混合“预先召回＋按需回查”与作者的context engineering实践相符，具体容量与召回收益仍由本项目测试确定。[S8](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

### 8.2 条件变化与影响解释

已有dependency传播继续作为确定性底座。新增能力是：用户问“如果审批再晚两天，哪些安排受影响”，工具先列依赖闭包，模型再区分确定影响、条件性影响、缺少工期的未知；生成可追溯的个人对比，不自动把会议日期改掉。

优先做依赖闭包、已知算式、给定参数敏感性分析。工作日历、关键路径、概率评分只有输入足够且存在明确业务需求才扩展。未知地区节假日、未提供任务工期不能靠模型补全。Agent的价值在于知道该查什么、怎么算、哪些不能算，而不是始终给一个数字。

### 8.3 受控工具协议

```ts
type ToolRequest =
  | { kind: 'read_sources'; refs: SourceVersion[] }
  | { kind: 'search_meeting'; query: string; cursor?: string; limit: number }
  | { kind: 'dependency_impact'; objectIds: string[] }
  | { kind: 'calculate'; formulaId: string; baseRev: number; overrides: InputValue[] };

type ToolResult = {
  resultId: string; toolVersion: string; inputHash: string;
  inputRefs: ReadVersion[];
  status: 'known' | 'conditional' | 'unknown' | 'error';
  value: unknown; unit?: Unit; reasons: string[];
};
```

服务补meetingId、scope、授权与预算；限制query长度、结果数、时间和总字节。工具错误作为结构化观察，不能让模型据报错编造结果。read/search默认只读；计算结果持久化但不改变会议事实。新增能力无shell、文件路径、任意URL、发送、采音或发布工具。

### 8.4 澄清只针对受阻事项

例如“把那个移到下周”对应两个方案时，先回查；仍多解才形成`Clarification{id, candidateIds, sourceRefs, affectedObjectIds, status, supersedes}`，给出一个具体问题。服务去重同一歧义，不重复弹出；其他无歧义内容继续更新。

用户回答以独立命令／新来源记录，重查原候选版本后再解释。个人回答只能先改变个人分支；不能因正在解决会议歧义就自动成为全体决定。后续会议发言自然消解歧义也可以关闭问题，保留证据。过期问题应标superseded或resolved，不永远累积成待办。

### 8.5 表达验证与修复

建议RenderReport包含blockId、errorCode、viewport、元素边界、缺失绑定、允许修复范围；worker传递报告而非布尔值。修复仅改布局／载体／措辞，不改已提交对象的事实和来源。生成、验证、预览、一次修复全部属于一个独立表达job；总次数预算含修复。

先做确定性来源／单位／关系方向／版面边界检查；高风险表达或离线样本再用模型评价条件遗漏、语义忠实与可读性。LLM裁判需要人工校准，不能自证正确。若修复仍失败，保留旧版并明确其依赖是否已过期；旧图不能继续伪装最新状态。

### 不建议默认增加的复杂度

每句多Agent投票、每句planner＋critic＋summarizer三调用、无界ReAct、每批视觉截图裁判、把全文反复总结成唯一记忆、用外部知识自动补会议未知、为展示智能而生成图表。这些机制仅在针对性评估证明收益大于额外延迟与错误后才采用。

## 9. checkpoint、恢复、等待与调试

### 9.1 三种恢复必须分开

| 场景 | 应有行为 |
|---|---|
| 提案生成前崩溃 | 同job／input refs恢复；可重新调用模型，计入调用账目 |
| 提案已保存、领域提交前崩溃 | 读取相同proposalId与commandId重发；不先重新随机生成 |
| 领域已提交、checkpoint或响应未保存 | 查询commands返回原结果；不再次改对象／新增产物 |

checkpoint记录执行位置，不替代command唯一键。租约过期可重新领取，但必须用递增fencing token拒绝旧worker晚提交；仅leaseUntil不够。单进程也会遇到超时后旧Promise继续完成，不必等到分布式部署才处理。

官方指出从历史checkpoint replay会重跑其后的节点，包括LLM和API；这不同于逐帧播放已存trace。调试界面应区分“查看旧轨迹”“无写入重跑”“创建个人分支重算”，默认查看不触发模型或领域写入。[S2](https://docs.langchain.com/oss/javascript/langgraph/checkpointers)

### 9.2 不让人工确认阻断会议

实时图把clarification作为结果落库后结束；之后批次继续处理。只有个人长任务才使用独立`thread_id=requestId`和durable checkpointer。官方interrupt恢复会从该节点开头重执行，因而interrupt之前不做非幂等副作用，也不把它包进吞异常的通用catch。恢复时核对用户、scope、request版本和原基线，不能只凭一个threadId授权。[S3](https://docs.langchain.com/oss/javascript/langgraph/interrupts)

暂停个人任务不持有会议锁／数据库事务，不占用供应商调用槽。会议结束后可以继续整理已接收内容；结束不等于可以再启动采集。输出基于旧状态时标注基线与变化，不静默切成最新假设。

### 9.3 调试与可观察性

保留现有调用账目，新增关联链：meetingId→sourceRefs→batch/requestId→runId/node/attempt→modelCallId/toolResultId→proposalId→commandId→对象rev→artifact/job/revision。记录队列等待、STT、检索、理解、修复、提交、生成、预览、可见更新各自耗时及预算状态。

本地trace默认记录ID、状态、错误码、hash与用量；受控的合成评估可以保存完整上下文和模型输出供回归。真实会议正文不默认上传LangSmith或其他tracing服务；不开启工具文档示例里的自动上报环境变量。可先用本地结构化日志和图节点事件，再通过adapter接OpenTelemetry或LangSmith，不需要先部署观测平台。

错误至少区分输入缺口、供应商不可用、证据不足、schema错误、语义拒绝、CAS冲突、依赖失效、渲染失败、预算耗尽、存储失败。当前`MODEL_HTTP_*`需保留可判断的status与retryable，但不把供应商原始敏感内容写日志。UI展示“正在回查两条来源”“条件未明”“图形修复失败”等有限动作说明，不展示隐藏推理。

## 10. 分阶段实施与迁移边界

所有阶段为下一轮建议，不是本轮开发承诺。顺序按风险依赖安排，不估造黑客松剩余工时。

| 阶段 | 具体交付 | 通过门槛／回退 |
|---|---|---|
| P0 评估与可追踪基线 | 语义标注规范、分层结果、batch关联trace、scope合并回归、主链／个人排队测量 | 对同一输入可解释每个失败；不把人工未判样本计为pass |
| P1 可信提交与持久任务 | newRef映射、read set、immutable proposal、成功batch唯一、job租约／fencing、scope唯一键 | 重启／超时／重复请求无重复领域写入，现有ID和历史可读 |
| P2 个人LangGraph切片 | 独立request队列、只读检索／计算、明确基线、可取消／澄清 | 推演等待时会议继续理解；个人不回写会议；async对照runner可切回 |
| P3 实时小图与记忆扩展 | 保留interpret接口迁入小图；证据回查至多一次、轻索引＋分页核对 | 同fixtures无机制退步；召回／语义增益可归因；主链调用上限受控 |
| P4 表达闭环 | RenderReport、一次定向修复、可信数据绑定、稳定用途身份 | 修数字不随意换布局；过期结果不提交；失败保留旧版并准确标状态 |
| P5 输入与完整产品验收 | 流式STT adapter、真实设备与供应商对照、双端完整会议 | 分别报告macOS／Windows、线上／线下、中英、时延和费用 |

P5的协议设计和测试用例可提前准备；真实采音／付费执行需要另行明确授权。不要把LangGraph迁移、Responses迁移、换模型、换STT和换UI协议放在同一次对比里。

迁移采用单写切换：同一job只由一个runner提交；shadow runner仅比较提案，不写业务。保留旧async实现通过统一`interpretBatch`接口进行对照，迁移稳定后再决定删除。新增DB表先做向后可读迁移和副本恢复验证，不覆盖原会议历史；旧产物ID、来源、对象revision与决定快照不重建。

## 11. 小型验证实验设计

本节**只设计，未执行**。所有阈值为建议验收门槛；样本量与预算需在执行前根据实际供应商和失败方差调整。

### E1 编排等价性与恢复

使用固定ModelPort替身，对async和LangGraph小图输入相同的成功、一次修复、拒绝、超时、预算耗尽、取消、来源改版、scope碰撞序列。正常提案／领域结果应等价；统计调用次数、任务状态与处理水位。故障注入点覆盖模型完成、提案持久化、命令提交、响应返回、checkpoint写入之间。

硬门槛：所有确定性不变量100%通过，重复提交／越scope写入／过期覆盖为0；这是有限用例门槛，不代表真实错误率为0。基准重复1000次纯替身运行测编排额外开销，报告p50/p95、内存和冷启动；不凭框架名称预测速度。

### E2 主动检索是否值得一次额外调用

建立至少40个有标注问题：远距离话题回归、中文短词、同义改写、中英切换、两个候选指代、先提议后否定、多处条件分散、旧证据已修订。分开比较现有上下文、轻索引＋词项查询、一次主动回查、必要时embedding融合。保持模型／提示词其余部分／输出预算一致。

指标：证据span召回、错误版本召回、对象定位正确率、无依据新增率、澄清准确率与不必要澄清率、每问题调用／tokens／耗时。人工标注哪些证据是必要、哪些可替代；不要求固定措辞。对同一用例重复3次观察稳定性，以配对差异报告提升；样本有限时同时给原始计数，不用小样本p95作生产承诺。

QMSum可提供分散span的评估结构，自己的合成语料必须补来源revision、个人请求和输入乱序。只有源数据引入范围与条件明确后才实际下载或用于外部模型。[S14](https://aclanthology.org/2021.naacl-main.472/)

### E3 条件、承诺与影响的语义回归

建议至少60个最小对照：明确承诺／提议／条件承诺、否定负责人、相对时间、延后审批、隐含依赖、问题已解决、条件未撤销、个人采纳与会议确认。加一组长序列检验条件首次抽取、被保留、被正确解除三个阶段，而不只测最后一轮。

结构化断言检查对象／关系／来源／scope／状态；两位评审对有争议语义给出可解释判定，不能协商时记ambiguous。重点报告事实升级错误、条件遗漏、依赖影响漏报和错误修订；流畅度不能抵消事实错误。真实模型试验另获调用预算，本轮不读取key或试调用。

### E4 非阻塞个人推演

合成会议每2秒入一条来源；在中间启动等待30秒的个人工具任务和一个待用户答复问题。持续观察会议接收水位、理解水位、表达水位；取消／恢复个人任务；期间修改其基础来源。比较共享队列基线与独立请求队列。

硬门槛：个人等待不持有会议理解锁；没有新来源丢失；旧基线个人结果准确标过期；scope相同／不同purpose均不错误合并。供应商全局并发有限时，需验证实时任务有保留槽和预算，而不是仅在内存分成两个数组。

### E5 表达修复与数值绑定

构造长标签、表格缺单位、相反关系边、窄窗口、200%缩放、重复purpose、非法绑定和错误公式basis。对比“保留旧版＋手动重试”和“结构化报告＋一次修复”。检查修复成功率、语义不变、稳定blockId、来源完整以及额外调用。对于无效算式，期望unknown/rejected，不以渲染成功判通过。

### E6 输入、长会与真实质量

先用明确标记的合成包模拟乱序、重复final、partial改写、断线重连、停止后旧epoch和尾段；再在获授权后做真实麦克风、耳机远端＋本机、线下多人、重叠发言和中英混说。macOS和Windows分别记录设备／系统／网络／适配器，不能把跨平台构建当真机通过。

实时STT与5秒切片保持相同已授权音频及可比配置；记录字词错误、数字／否定错误、句边界、漏段／重段、稳定段落至理解提交与发言结束至可见结果的分段时延。至少30条代表性语音只用于初步分布，不宣布已达生产稳定性；长会再测30／60／120分钟、多有效约束与多历史产物，观察内存、写入时间、必要记忆超限及积压。

官方当前实时转写支持24kHz PCM、delta与completed，跨turn完成顺序不保证；用item_id对应输入，不能按回包顺序排列事实。它不返回说话人标签、逐词时间和置信度。本项目适配器必须保持未知字段，而不是为满足统一接口填0或伪造身份。[S11](https://developers.openai.com/api/docs/guides/realtime-transcription)

### E7 团队维护与依赖验证

让实际维护者在合成故障中定位一次错误、增加一个只读节点、修改预算并解释重放副作用；记录用时与需要帮助的位置，作为团队熟悉度的证据，不评价个人能力。锁定稳定包后验证TS/Zod、esbuild、Electron utility process、两平台安装包和持久saver。未安装时不能宣布兼容。

最终采纳标准不是“LangGraph跑通”，而是：机制不回退，关键语义／召回有可观察改善或维护成本确实下降，调用与时延在可接受范围，失败可定位且可恢复。若只改善维护，不改善语义，应如实只宣称维护收益。

## 12. 源码索引与来源

### 本地源码定位

行号对应本轮HEAD，只作阅读锚点；后续修改以函数名和Git版本重新定位。

| 文件／锚点 | 本文判断 |
|---|---|
| [session.ts](../../src/service/session.ts)，34／133／300／397行 | 内存调度、用户命令幂等、调用账目、理解与自动提交 |
| 同文件，556／609／617／701行附近 | purpose合并、依赖检查、表达队列、预览位于修复循环之后 |
| [context.ts](../../src/agent/context.ts)，58／189／211行 | 批次、scope投影、实际模型payload与产物索引 |
| [provider.ts](../../src/agent/provider.ts)，59／84／96／238行 | 默认配置、无工具提示、Chat Completions、文件STT |
| [model.ts](../../src/contracts/model.ts)，14／150／204／241行附近 | meaning、公式、产物与Proposal实际schema |
| [meaning.ts](../../src/domain/meaning.ts)，14／76／95／122行 | 字面证据、依赖、传播、模型ID增量提交 |
| [validate.ts](../../src/renderers/validate.ts)，14／107／161行 | 内容安全、产物验证、语义校验 |
| [calculator.ts](../../src/domain/calculator.ts)、[commands.ts](../../src/domain/commands.ts) | 有限四则计算与个人scenario／decision |
| [store.ts](../../src/service/store.ts)，29／64行附近 | 两表聚合快照、命令同事务写入 |
| [worker.ts](../../src/service/worker.ts)、[preflight.ts](../../src/desktop/preflight.ts) | 预览布尔协议、隔离窗口与有限边界检查 |
| [model-eval.ts](../../scripts/model-eval.ts)、[结果索引](../../tests/results/README.md) | 真实模型评估入口与当前验证边界 |

### 外部原始资料目录

访问日均为2026-09-12；未标发布时间的网页是动态文档，不将抓取日期当发布日。源码链接指向当日所读main，未声称锁定SHA或安装；未来实施需另锁稳定release。以下仅列实际读取并用于判断的资料。

| ID | 作者／维护者、资料与日期 | 支撑范围 |
|---|---|---|
| S1 | LangChain，[LangGraph overview](https://docs.langchain.com/oss/javascript/langgraph/overview)，动态文档 | runtime定位、混合确定与模型节点 |
| S2 | LangChain，[Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)／[Checkpointers](https://docs.langchain.com/oss/javascript/langgraph/checkpointers)，动态文档 | MemorySaver、thread、持久与replay边界；旧durable-execution链接已重定向 |
| S3 | LangChain，[Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)，动态文档 | 恢复从节点开头执行、独立thread |
| S4 | LangChain，[retry.ts](https://raw.githubusercontent.com/langchain-ai/langgraphjs/main/libs/langgraph-core/src/pregel/retry.ts)／[Fault tolerance](https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance) | opt-in重试、错误分类、版本要求 |
| S5 | LangChain，[SQLite saver源码](https://raw.githubusercontent.com/langchain-ai/langgraphjs/main/libs/checkpoint-sqlite/src/index.ts) | checkpoint／pending writes的独立保存职责 |
| S6 | LangChain，[核心包](https://raw.githubusercontent.com/langchain-ai/langgraphjs/main/libs/langgraph-core/package.json)／[SQLite包](https://raw.githubusercontent.com/langchain-ai/langgraphjs/main/libs/checkpoint-sqlite/package.json)／[releases](https://github.com/langchain-ai/langgraphjs/releases) | MIT、peer依赖、RC与原生saver；不等于npm稳定版核验 |
| S7 | Erik S.、Barry Zhang／Anthropic，[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)，2024-12-19；现页有过时提示 | 简单可组合模式与复杂度取舍 |
| S8 | Anthropic，[Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)，2025-09-29 | 有限上下文、即时检索、混合召回 |
| S9 | Anthropic，[Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)，2026-01-09 | 轨迹与实际结果、分层评价与人工校准 |
| S10 | Anthropic，[Scaling Managed Agents](https://www.anthropic.com/engineering/managed-agents)，2026-04-08 | session／harness／执行环境分离与重评旧假设 |
| S11 | OpenAI，[Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)，动态文档 | 流式事件、顺序、格式及身份能力限制 |
| S12 | OpenAI，[Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs)，动态文档 | schema约束与refusal边界，不证明语义正确 |
| S13 | LiveKit，[项目](https://github.com/livekit/agents-js)／[STT源码](https://raw.githubusercontent.com/livekit/agents-js/main/agents/src/stt/stt.ts)／[session源码](https://raw.githubusercontent.com/livekit/agents-js/main/agents/src/voice/agent_session.ts)／[turns](https://docs.livekit.io/agents/logic/turns/)／[releases](https://github.com/livekit/agents-js/releases) | 连续媒体与回合分工、部署／许可证和维护观察 |
| S14 | Ming Zhong等，NAACL 2021，[QMSum论文](https://aclanthology.org/2021.naacl-main.472/)／[README](https://raw.githubusercontent.com/Yale-LILY/QMSum/main/README.md)／[LICENSE](https://raw.githubusercontent.com/Yale-LILY/QMSum/main/LICENSE) | 按问题定位多个证据span的离线评估结构 |
| S15 | SQLite，[FTS5官方文档](https://www.sqlite.org/fts5.html)，动态文档 | token／trigram边界与短中文检索注意点 |
| S16 | A2UI项目，[README](https://raw.githubusercontent.com/a2ui-project/a2ui/main/README.md)／[v0.9 schema](https://raw.githubusercontent.com/a2ui-project/a2ui/main/specification/v0_9/json/server_to_client.json)／[v0.9.1规范](https://a2ui.org/specification/v0.9.1-a2ui/)／[LICENSE](https://raw.githubusercontent.com/a2ui-project/a2ui/main/LICENSE) | 声明式组合、数据绑定、增量协议、版本及Apache-2.0 |

### 保留的不确定性

团队LangGraph熟练程度、锁定包的实际构建兼容、主动检索的语义收益、适合的模型与调用预算、流式STT相对切片的真实增益、Windows真机、长会容量上限仍需实验。没有真实运行证据前，不能给“智能提高百分比”“端到端几秒”或“两个平台已完成”的结论。

本报告的完成意味着研究、取舍与实施设计已交付；不是产品改造完成。研究交接见[本轮记录](../sessions/2026-09-12-agent-architecture-research.md)。

后续实施入口：[运行时说明](../agent-workflow-runtime.md)与[实施session](../sessions/2026-09-12-agent-workflow-implementation.md)。本文仍保留研究当时的判断，不回写为当时已实现。
