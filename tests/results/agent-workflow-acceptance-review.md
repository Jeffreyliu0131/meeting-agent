# Agent工作流独立验收与GitHub交付

状态：验收修正与最终全量检查通过，准备提交／推送。用户已明确授权验收通过后交付GitHub。

## 审查范围与发现

基线为a7d5771＋W1–W6未提交实现。先核对原84文件指纹全部匹配；按恢复、历史证据、并发／范围、协议容量、旧数据兼容、文档职责和暂存内容独立审查。

- 历史来源读取被错误加入最新版CAS约束：两个版本存在时，旧版回查的合法批次始终不能提交。已拆分historical读取并同时保护查询时观察的当前版本。
- 持久提案业务校验失败后反复恢复：已复现坏澄清阻塞后续输入；现rejected终态隔离原输入，保留缺口，继续独立话题。SQLite保存失败仍恢复原提案。
- 请求容量未扣schema：当前schema约33KB＋提示词约6KB，固定24KB投影可能超过60KB请求预算。装载器现使用provider计算的有效容量，并保留最终请求检查。
- 旧new_前缀ID兼容：现在按真实已存在ID识别更新，拒绝跨对象／关系种类串用。
- 表达规范正文误替换为入口规范：恢复HEAD中的表达规则，保留新增工作流说明；文档检查增加职责标题校验。此前链接检查通过不能证明内容正确，本次已复核核心正文。

- 200%缩放截屏为空：实际检查了旧图，确认CDP截图为空白；桌面测试改为原生capturePage，等待滚动绘制且检查像素颜色数量，避免把空白图片当视觉证据。

上述代码反例与保护用例见[acceptance-review.test.ts](../../tests/unit/acceptance-review.test.ts)。前两条修复前实际失败；全部5项修复后通过。对应原AC-02、AC-03、AC-14至AC-17、AC-21；其余覆盖继续使用[W1–W6／25项证据映射](agent-workflow-validation.md)，最终指纹以本报告为准。最后仅补截图等待绘制，单独复验受影响桌面用例通过；生产代码未变，未重复计入11项总数。

## 验证

- `npm test`：86 passed／0 failed，包含30秒合成工具等待、三个恢复故障窗口和本轮5项审查回归。
- `npm run build`、`npm run format:check`、`git diff --check`：通过。
- `MEETING_E2E_REPORT=/tmp/agent-acceptance-final-e2e.json MEETING_E2E_OUTPUT=/tmp/agent-acceptance-final-e2e npx playwright test`：11 passed／0 failed；覆盖生产HTTP路径、实际Electron、个人取消／澄清／重启、800×600与200%缩放。
- macOS arm64与Windows x64目录包构建通过；各14个dist文件与app.asar逐一hash一致，macOS空白临时库启动service ready。详见[打包与烟测](agent-acceptance-packages.json)。
- `python3 scripts/check-docs.py`：本地61篇MD／15条session的结构检查通过；提交树单独核验以排除未提交飞书文件的断链。
- [机器汇总及85文件指纹](agent-workflow-acceptance-summary.json)；manifest SHA-256：`2c79d530e36557894e391f6c4cdc5afb853a895da486fd525c0d0ea8ac4f4dea`。测试与代码对应本轮工作树，不继承旧81项记录的适用范围。

实际界面：[窄窗口澄清与个人状态](agent-acceptance-ui/workflow-personal-clarification.png)、[重启恢复](agent-acceptance-ui/workflow-restored.png)。

全量回归还捕获并修正了错误分类回退：数据库原始异常现在统一为STORAGE_FAILED，使存储故障继续恢复原提案；业务校验拒绝才进入rejected。原有保存恢复测试已复验通过。

## 交付边界

仅合成数据与localhost协议替身，未调用真实模型、未采真实音频。Windows只验构建，真实语义、音源、实机／完整辅助技术仍未验收。不得据此称整套产品零缺陷。

提交只包含工作流实现、依赖、相关研究／任务书、验证与文档；原有飞书交接文件及其索引行保留在本地，不顺带提交。日常安装包未替换。

暂存树已核验：85个源码／配置／测试文件hash与验收结果一致；暂存树60篇MD／14条session通过链接／职责／入口检查；未发现凭证模式，未包含日常数据库或构建包。飞书交接及其状态／索引行未暂存。
