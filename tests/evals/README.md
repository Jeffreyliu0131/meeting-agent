# 会议 Event 与 eval 数据

入口：[评测方案与 PR 判断](../../docs/event-evaluation.md)。这是可复跑的合成验收资料，不是真实会议，也不是已通过的产品清单。

- [events.json](events.json)：24类会议 Event，其中12类包含60条多轮文本案例（40中文、10英文、10混合）。每条有独立来源ID、输入顺序、预期意图与人工核查要点；其余12类覆盖桌面、音频、生命周期与真实效果。
- [metrics.json](metrics.json)：30项指标的定义、分母、目标依据和所需证据。已批准规范中的工程目标与尚待校准指标分开。
- [requirements.json](requirements.json)：当前两份验收标准中135个显式条目的路由。`mapped_not_proven`表示已找到评测入口，不代表完整断言或真实验收通过。
- [scoring.test.mjs](scoring.test.mjs)：评分反例，包括漏样本、空分母、假阳性、错误版本人工评审与不完整发布门槛。

语料由Agent依据业务规范起草，未经独立人工审定；没有训练集／验收集独立性的历史证据。不能称为人工金标或独立holdout。期望字段不会发送给模型。语料冻结以每次运行的SHA-256为准；若拿这些案例调提示词，下一次正式验收须另建未见过的案例。

执行：在仓库根目录运行 `node scripts/evaluate.mjs --offline --model`。自动执行领域、评测器、构建、全部Electron、加速长会与包内容读取；没有模型凭证时模型部分写blocked，绝不补替身分数。每次保留独立结果目录，来源见输出的`report.md`与`provenance.json`。
