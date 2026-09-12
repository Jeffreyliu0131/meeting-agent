# 四类意图首轮验证

日期2026-09-12，Windows x64、Node24.16.0，FTY HEAD2661764＋本轮未提交工作树。对应[交接](../../docs/sessions/2026-09-12-four-intents.md)与[实际范围](../../docs/collaboration-intents.md)。

## 已执行

- `node --import tsx --test tests/unit/*.test.ts`：107/107通过，含本轮21项；提交前审查修复建议性更新隔离与合并后重名校验后，全量再次通过；覆盖四类草稿、负向表达、来源／字段、跨批更新、手工锁／删除、目标歧义、停止收集、命令幂等、失败事务、临时ID、个人隔离与SQLite恢复。
- `node node_modules/typescript/bin/tsc --noEmit`、`node scripts/build.mjs`、`node node_modules/vite/bin/vite.js build`：通过。
- `node node_modules/@playwright/test/cli.js test tests/e2e/collaboration.spec.ts`：1/1通过（提交前最终10.1秒）。重启后显式打开保存会议；修正了原脚本假设自动选中的问题。实际Electron、生产HTTP模型适配器和IPC；供应商为本机合成测试替身，临时独立数据目录。四类卡片、投票字段保存、后续输出不覆盖手工字段、冻结和重启恢复通过；800×600窗口200%缩放检查无document横向溢出。原生窗口截图仅用于本轮可读性检查，不作为全平台验收。

本机npm启动脚本入口缺失，按package.json使用等价Node入口执行；未修改全局npm环境。tsx在受限环境调用Windows用户信息失败，正常本地权限下测试通过，非产品内存错误。

## 不表示通过的部分

没有调用真实模型或音频，没有语义F1／精确率、真实会议效果、macOS本轮实机或全量Electron回归结果。全部协作业务副作用尚未接入，不能用私有草稿测试宣布投票／分工接受／决定确认多人闭环完成。原有stream-evaluation.json和model-evaluation.json不属于本轮结果，未据此声明通过。

构建目录为本地dist；未更新release包；用户已授权推送FTY，实际提交引用见交接。格式、文档链接与diff检查结果由[交接](../../docs/sessions/2026-09-12-four-intents.md)收尾记录。
