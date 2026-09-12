# Agent 工作流验证与交付表

状态：2026-09-12实现阶段的验证记录；随后独立验收发现并修正边界问题，最新交付结论以[独立验收](agent-workflow-acceptance-review.md)为准。原记录保留其对应指纹。基线HEAD `a7d5771`＋本轮未提交工作树；原有研究和团队文档不计本轮代码。运行环境macOS arm64，Node/Electron版本以机器汇总为准。全部会议／HTTP响应／音源为合成，零付费模型调用，未操作日常会议数据库或安装包。

## 已执行与修复

- 基线58项单元通过；本轮最终81项单元全部通过，包含真实等待30秒的合成工具场景与3个恢复故障窗口。
- TypeScript与Vite／esbuild构建已通过；首次新增测试类型错误已修正。
- 首轮Electron沙箱拒绝启动窗口及监听localhost；在任务授权范围放行后，10项原有Electron合成检查通过。
- 新增Electron检查发现IPC未放行取消／澄清命令；已补齐，单独复验通过。修复后全量11项Electron合成检查通过，含新增800×600／200%澄清草稿与焦点检查。
- macOS／Windows目录包的首次沙箱构建无法解析github.com；在已授权网络构建下，macOS arm64／Windows x64目录包均成功；每端14个dist文件与app.asar逐一hash匹配。macOS临时包实际启动且service ready；未签名／未发布，Windows未启动实测。

## W1–W6 → 源码 → AC → 证据

| 工作包 | 实现模块 | AC | 程序证据与边界 |
|---|---|---|---|
| W1 | service/workflow-state.ts、store.ts、session.ts、contracts/workflow.ts | 03、12、15–17、20–21、24 | workflow.test：ID解析／read set／fencing／保存失败重开／失败隔离；core与reliability旧版恢复回归 |
| W2 | agent/context.ts、tools.ts、provider.ts | 02、08、11、14、23 | 中文短词、旧版本、邻近分页、私有输入排除、真实工作流补证据；长会目录超限回归 |
| W3 | agent/workflow.ts、service/call-pool.ts、session.ts、domain/commands.ts、ui/main.tsx、WorkflowPanel.tsx | 04–07、10、16、20、22 | 独立工具等待／取消／持久基线／保留槽；Electron对象标签、会中继续、基线变化与取消 |
| W4 | domain/commands.ts、closeout.ts、service/session.ts、WorkflowPanel.tsx | 08–09、13、24 | 先查后问、个人回答隔离、自然来源消解、取消后重开；既有结束核对 |
| W5 | domain/units.ts、calculator.ts、expression-repair.ts、renderers/validate.ts、desktop/preflight.ts、service/worker.ts | 03、06–07、10、18–19、22–23 | 有序角色／scope身份、单位拒绝、报告定向修复／内容不变；旧版来源／隔离／草稿和缩放回归 |
| W6 | tests/unit/workflow.test.ts、tests/e2e/workflow.spec.ts、scripts/workflow-eval.ts、model-eval.ts | 01–25 | 全量结果、离线人工评分清单及源码指纹；不将协议通过算为语义通过 |

## 各AC的证据落点

| AC | 实际验证路径 |
|---|---|
| 01 | live-agent.test 连续输入／批次；desktop隐藏不停止；provider-contract持续合成音源 |
| 02 | workflow.test主动证据分支＋中文原话／版本；workflow.spec生产HTTP先检索再澄清 |
| 03 | core来源修订、live-agent patch与稳定产物、workflow newRef映射 |
| 04 | workflow.test 30秒合成工具等待与会中继续；workflow.spec个人HTTP等待期间会中产物更新 |
| 05 | workflow.test发送时保存基线并重启；workflow.spec对象版本标签与基线变化提示 |
| 06 | provider-contract text／timeline／chart／SVG／HTML及关系图，业务适切性仍待人工语义评分 |
| 07 | core Decimal与个人保存隔离；provider-contract可信计算UI |
| 08 | workflow.test先回查再澄清；workflow.spec具体问题与来源 |
| 09 | workflow.test个人回答／自然来源消解；workflow.spec取消与重开 |
| 10 | workflow.test有序角色与个人branch独立ID |
| 11 | reliability条件变化与传递依赖回归 |
| 12 | core no_change／错误保存；workflow失败隔离且成功水位不前进 |
| 13 | core／reliability未知身份、引文／共识权限；自然语言分类正确性待验 |
| 14 | reliability长会目录incompleteEvidence与原条件保留；workflow分页工具 |
| 15 | workflow提案保存后领域写失败重开；SQLite不可变提案检查；提案保存前与提交后中断均有独立恢复测试 |
| 16 | core晚到纠错／语言；workflow read set／fence／cancel；live-agent预览失效 |
| 17 | workflow失败来源预算耗尽后独立输入推进，缺口仍可见 |
| 18 | workflow实际RenderFailure报告至一次生成修复；core/live-agent失败旧版保护 |
| 19 | core缺参数／除零，workflow单位不一致拒绝；公式basis字面校验不等于语义证明 |
| 20 | workflow持久模型／工具计数、取消晚到结果；live-agent小时预算 |
| 21 | core存储失败；workflow领域保存失败后恢复原提案 |
| 22 | provider-contract200%缩放／草稿／来源焦点；workflow对象标签及澄清输入。完整辅助技术与IME真机未验 |
| 23 | core安全净化、desktop无任意IPC／文件权限、provider-contract被动内容隔离；工具无外部能力 |
| 24 | reliability结束／尾音与重启；workflow澄清与个人任务恢复、不恢复采音 |
| 25 | 分开记录macOS、Windows目录包和未测项，不以构建代替实机 |

## 真实效果与未测

真实模型语义、证据召回质量、公式含义、多人中英转写、线上双音源、真实时延成本、Windows真机与完整辅助技术未验收。离线[人工评分清单](workflow-semantic-rubric.json)状态均为not_run，semanticPasses=0。没有未经验证的“完全准确”或生产p95结论。

实际机制与有限支持范围见[运行时说明](../../docs/agent-workflow-runtime.md)。源码／配置／测试等84个文件的SHA-256见[机器汇总](agent-workflow-summary.json)，manifest SHA-256：`0600fdc6815d29021c951b6f9926be8432f460398ec8df40cd1ea9c747e072a5`。

## 最终命令与证据

- `npm test`：81 passed／0 failed，约30.75秒（含30秒合成工具等待）。
- `npm run build`、`npm run format:check`、`git diff --check`：通过。
- `MEETING_E2E_REPORT=/tmp/workflow-verified-e2e-report.json MEETING_E2E_OUTPUT=/tmp/workflow-verified-e2e-artifacts npx playwright test`：11 passed／0 failed，约52.8秒；最终逐测试状态见[机器汇总](agent-workflow-summary.json)。
- `npx electron-builder --mac --dir --config.directories.output=/tmp/workflow-verified-pack-mac`、`npx electron-builder --win --x64 --dir --config.directories.output=/tmp/workflow-verified-pack-win`：目录包成功；[逐文件匹配](workflow-package-content.json)与[macOS启动烟测](workflow-package-smoke.json)。未替换日常.app，未创建签名分发包。
- `python3 scripts/check-docs.py`：最终结果见[文档结构检查](workflow-doc-check.json)。文档内容已按实际范围人工式复核，结构通过不替代内容真实性。
- `node --import tsx scripts/workflow-eval.ts`：生成4组离线人工评估清单，零模型调用、零语义通过。

界面证据复核：[原200%截屏](workflow-e2e/workflow-personal-clarification.png)在独立验收中确认为空白，不能证明视觉通过；有效原生截图已补录到[独立验收](agent-workflow-acceptance-review.md)。[结束后恢复](workflow-e2e/workflow-restored.png)保留作为合成界面记录，非真实会议质量证据。
