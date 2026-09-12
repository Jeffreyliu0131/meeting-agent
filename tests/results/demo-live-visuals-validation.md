# Demo 可视化与实时编辑验证

日期：2026-09-12（Asia/Singapore）。源码基线：本轮开始于5878c20，期间其他任务合并至55267d6；保留既有未提交正文／试算／评测成果。本轮代码为未提交修改，精确文件指纹见[构建基线](demo-live-visuals-build-source.json)。

## 已实现

- 自然讨论中有组成、依赖、条件、支持／质疑时主动选择图形；普通图与理解同轮返回。diagram支持思路／流程／论点布局意图、10种受控图标和与实际Relation对齐的连线类型。
- 连续Live STT提交上限8000→2400ms，静音600ms保留；默认理解合并1500→250ms。SSE返回实际focus／question／summary草稿，完成校验后替换正文；个人草稿和推理字段不进入会议实时栏。
- 新节点和连线有局部反馈，原话只保护对应块，新增对象导致产物ID变化时同一问题仍可局部更新。窄窗保留图形及文字关系入口。
- 重复的表达schema通过引用复用，完整请求仍保持60000字节上限；未放宽来源、租约、身份或决定校验。

## 实际结果

| 检查 | 结果／证据 | 范围 |
|---|---|---|
| 完整领域测试 | 227/227，[原始输出](demo-live-visuals-unit.txt) | 流式分包、草稿隔离、连续语音、图布局及现有整合功能 |
| 完整源码Electron | 34/34，[报告](demo-live-visuals-e2e.json) | 本地HTTP／WebSocket替身、实际桌面和预览；含原话、个人推演、协作、集合与设置 |
| 新动态图专项 | 草稿先于提交，4→5要点、语义图标、局部保护、布局切换、SVG及800宽可读性通过，[检查](demo-live-visuals/checks.json) | 合成输入和明确标注的SSE替身，不是实际模型语义成绩 |
| 最终Mac包专项 | 1项通过，[报告](demo-live-visuals-package-e2e.json) | 同一完整动态图流程运行于真实.app，数据目录隔离 |
| 双端包 | arm64 Mac、x64 Windows；14个dist文件与app.asar一致，[证据](demo-live-visuals-packages.json) | 完整源码回归后有连线标注位置精修，由Mac包专项再验 |
| 真实模型入口 | MODEL_NOT_CONFIGURED，[输出](demo-live-visuals-model.txt) | 无调用、无成绩；[新自然讨论语料](../fixtures/visual-expression.json)为后续选型验收准备 |

本轮也修正了三个测试揭示的问题：新增对象换产物ID造成整页冻结；扩展图形schema挤占上下文容量；旧窄窗断言仍要求隐藏图形。已有保护语义按新规范更新，其余回归继续保留。

截图：[思路图](demo-live-visuals-package/02-mindmap-detail.png)、[流程图](demo-live-visuals-package/04-flow-detail.png)、[草稿阶段](demo-live-visuals-package/01-live-draft.png)。这些是合成会议在实际应用包中的画面，不是概念稿或真实模型生成证明。

文档结构检查通过（133份MD、38条session、0错误），见[输出](demo-live-visuals-doc-check.txt)；本轮修改文件格式和git diff空白检查通过。文档检查不替代产品验证。

## 双平台及未测边界

- Windows：共用代码和x64本地包已更新；本轮无Windows真机运行、字体／DPI或音源证据。
- macOS：arm64本地包已更新并完成隔离运行；日常会议数据未改，未采真实音频，未主动重启用户正在使用的日常进程。
- 2.4秒与250ms是内部阈值，不能相加作为端到端延迟保证。真实供应商的选型质量、首字／完整画面时间和连续会议体验仍待配置后验收。
- 没有预写会议答案进入生产；模型评测语料的expected只用于评价，不传给模型。

## 重复验证

`node --import tsx --test tests/unit/*.test.ts`；`npm run build`后执行`node_modules/.bin/playwright test`。包核对使用`node scripts/demo-visual-package-check.mjs --capture`记录源码，构建两端后执行不带参数的同脚本；运行间源码发生变化会拒绝混用结果。

仅测自然表达选型：`MEETING_EVAL_FIXTURE=visual-expression npm run test:model`，需要当前环境已配置模型；缺配置时明确失败。
