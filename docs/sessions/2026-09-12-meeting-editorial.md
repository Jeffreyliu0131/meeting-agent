# 会中工作页与原话边注精修

记录类型：本任务执行记录。
状态：代码／双端本地包已同步，Mac实测通过，Windows真机待验。更新时间：2026-09-12 13:48（Asia/Singapore）。

## 目标与授权

用户确认第一张正文在左／原话在右的方向，要求原话更窄、比例舒适、精修细节，随后明确授权实现。范围含实际Electron代码、来源与阅读、双语响应式、合成验证、两端本地包及文档；已授权Playwright隔离截图。不采真实音频、不调用真实模型、不操作日常会议正文、不提交／推送／部署。

## 接手基线

初始HEAD62e3f5c，期间设置任务合并为596c8b7；个人试算依据提示也在共享文件中同步实现。保留两项任务及双平台规则、飞书／首页预览文档；不将其成果归为本轮。最终源码／测试／配置指纹见[包清单](../../tests/results/meeting-editorial-packages.json)。

## 实际变化与依据

- [当前会中规范](../design/meeting-editorial.md)与[已确认参考](../design/assets/meeting-editorial-reference.png)：无外层卡片、系统字阶与细分隔，左主文／右360–380px原话。1488宽时原话372px，开关主文x48／宽1020不变。
- 原话独立组件、稳定编号、精确ID＋revision引用；纠错后编号与原发言顺序不变，旧引用不会偷换新版。完整转写排除个人request，精确个人引用保留且注明类型。
- 原话核对期间保留产物，后台继续理解，用户可查看更新；主动切换历史／个人产物优先于阅读保护。长转写回看不拉底，提供回到最新。
- 反馈理解追加到现有草稿、不自动发送；纠错草稿关闭重开保留，冲突就地提示，保存防重。窄窗键盘／inert／Escape／焦点返回，200%极短视口采用全高来源模态。
- 生成提示、隔离HTML及tokens同步，Agent表达仍为动态通用结构。只在来源级别可靠标识，没有字符范围时不虚构句内高亮。编号／修订索引采用线性扫描。

## 验证与未验证

最终build／TypeScript／格式／差异通过。[115单元](../../tests/results/meeting-editorial-unit-final.txt)、[4项最终会中专项](../../tests/results/meeting-editorial-verified-e2e.json)、[16项受影响工作流](../../tests/results/meeting-editorial-acceptance-e2e.json)通过；最后边界还复核可靠性／试算／工作流。既有全量回归中的原生焦点／hover在打包干扰下失败后，[2项独立复查](../../tests/results/meeting-editorial-native-recheck.json)通过。中间测试退出确认／close事件清理超时未隐藏，最终仅终止自身隔离测试进程，不能据此宣称正常退出流程验收；详见[验证说明](../../tests/results/meeting-editorial-validation.md)。

[视觉QA](../../design-qa.md)passed：同尺寸全页／局部比较、窄窗、英文和真实200%缩放均检查。[Mac成品包](../../tests/results/meeting-editorial-package-smoke.json)隔离合成会议通过，原话3段／372px，无模型配置、开发输入或录音。两端14个dist文件及app.asar一致、目标架构核验通过。真实音频／模型、Windows真机及完整屏幕阅读器仍待验。

### Windows 与 macOS 同步状态（每轮必填）

| 平台 | 本轮影响与实现状态 | 本地包位置／架构／源码基线及一致性证据 | 实际验证与未验证 | 缺口与下一步 |
|---|---|---|---|---|
| Windows | 共用UI、来源、字阶与动态渲染已同步 | release/win-unpacked，x64，596c8b7＋最终工作树；14文件及asar与Mac／dist一致 | 构建／PE架构／代码包指纹通过，真机未运行 | 真机字体、DPI、键盘、音源另验 |
| macOS | 同一实现已同步 | release/mac-arm64/Meeting Agent.app，arm64，同工作树和指纹 | Electron来源／缩放／工作流与真实包合成会中截图通过 | 真实音频／模型效果未验；日常数据库未改 |

## 未完项与下一步

本轮代码与双端本地包同步完成；Windows运行与真实转写／模型质量是明确未验项。普通阅读仍自动跟随，来源核对与选中块才保护阅读；通用全场景重排队列和可靠句内范围不是本轮已实现能力。用户可重开更新后的日常包体验；本轮没有结束或重启日常录制进程。原话／个人推演真实效果应使用另行授权的真实会议验收。

## 文件同步与交付

同步会中专项、风格／前端正文、设计与产品决定、tokens、来源契约、验收、README、源码导航、结果索引、状态页及session索引；[最终截图](../../tests/results/meeting-editorial/mac-package.png)。本轮入口／链接无错误；较早全局99篇MD／25条session检查通过，最终重查出现并行首页home-v3缺index及home-v1路由未接续，已记入[检查边界](../../tests/results/meeting-editorial-doc-check.json)，未改其进行中文件。新增脚本scripts/editorial-package-check.mjs可在本轮合成测试后复验两端包。未提交／推送；保留所有其他任务改动。
