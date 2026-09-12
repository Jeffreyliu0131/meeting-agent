# 已保存个人试算依据提示验证

日期：2026-09-12。环境：macOS arm64／Node 22.14.0。基线：HEAD `596c8b7`＋本轮及已有会中工作页等工作树改动。[源码快照](scenario-basis-build-source.json)和[双端包／测试指纹](scenario-basis-packages.json)记录了实际范围。

## 变化与边界
新增[scenario-basis.ts](../../src/domain/scenario-basis.ts)，现有已保存试算区域接入三态提示：记录内未变化／已变化／缺依据。无关输入、其他产物和纯显示变化不误报；原话、对象／关系、传递条件或公式改变仍提醒。参数、公式快照和结果保持原值，无存储迁移。

依赖粒度为保存产物的对象／关系读集，尚无每条公式的独立对象读集；没有提示不证明全场语义正确。不修改Agent生成、动态组件或计算器，工作树中此前的相关改动属于其他任务。

## 验证结果
| 检查 | 实际结果与证据 |
|---|---|
| 新增领域专项 | 9项通过：无关输入、来源纠正、传递条件、对象／关系改变、公式改变或移除、缺依据、历史兼容／循环依赖、SQLite重开 |
| npm test | 114通过，0失败；[原始记录](scenario-basis-unit.txt) |
| 源码Electron中英文 | 2通过；[结果](scenario-basis-e2e-verified.json) |
| 新Mac包中英文 | 2通过；[结果](scenario-basis-package-e2e.json) |
| 既有生成—计算—保存流程 | 1通过；[结果](scenario-basis-existing-e2e.json) |
| build／TypeScript／修改文件Prettier／差异 | 通过 |
| 文档入口检查 | 通过，只证明结构与链接 |
| macOS arm64包 | 已更新；包内功能通过 |
| Windows x64包 | 已更新；PE x86-64确认；真机未运行 |
| 构建一致性 | 81个产品／配置文件在构建期间未变；双端14个dist文件与当前构建逐项一致，app.asar SHA-256相同 |

## 复现
- 领域：`npm test`。
- 构建：`npm run build`。
- 源码桌面：`node node_modules/@playwright/test/cli.js test tests/e2e/scenario-basis.spec.ts`。
- Mac：`node node_modules/electron-builder/cli.js --mac --arm64 --dir`。
- Windows：`node node_modules/electron-builder/cli.js --win --x64 --dir`。
- 包内：上述桌面命令增加环境变量`MEETING_BASIS_PACKAGE=1`。
- 既有流程：`node node_modules/@playwright/test/cli.js test tests/e2e/provider-contract.spec.ts --grep 'provider transport'`。
- 报告通过`MEETING_E2E_REPORT`／`MEETING_E2E_OUTPUT`设独立路径，避免覆盖其他任务结果。
- 文档：`python3 scripts/check-docs.py`。

## 已修正的验证问题
[初次](scenario-basis-e2e.json)及[第二次](scenario-basis-e2e-final.json)桌面检查因测试多余点击已打开会议的标题，触发重命名弹窗而遮挡。最初误判为音频设置，补齐设置后仍失败，最终确认并移除多余点击。最终源码及包内测试通过。夹具audio可选字段类型错误已修正并通过build。

初次跨构建默认跟随宿主生成Windows ARM目录，随后显式构建既有Windows x64目标并核验。额外目录未删除，不属于Windows ARM验收。

## 未验证与交付
全部为隔离合成数据，无真实模型／转写或采音；Windows真机待验。日常数据库未访问，日常进程未重启；本地包更新后重启应用使用新版本。未远程安装、未提交／推送／部署。
