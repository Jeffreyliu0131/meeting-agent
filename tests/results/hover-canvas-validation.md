# 悬浮球实时画板验证

2026-09-12，macOS arm64。基线为HEAD `55267d6`＋当时工作树；[108个运行源码文件指纹](hover-canvas-source.json)对应本轮最终实现，包含原有并行改动，不将其全部归为本轮新增。所有会议／供应商输入均为synthetic，未使用真实采音或外部模型。

| 验证 | 结果与证据 |
|---|---|
| 构建／类型 | `npm run build`、最终`tsc --noEmit`通过 |
| 单元 | `npm test`，231/231，[最终日志](hover-canvas-final-unit.txt) |
| 源码画板专项 | 5/5，[报告](hover-canvas-complete-e2e.json)：后台修订、滚动保持、联合区域、拖动与菜单、来源和草稿、左右边缘／200%、结束清空及隔离SVG |
| 既有桌面与提醒 | 10/10，[最终报告](hover-canvas-final-regression.json)：原窗口、身份／IPC隔离、语言、提醒及采集生命周期 |
| Mac最终应用包 | 5/5，[最终报告](hover-canvas-final-package.json)：直接运行打包可执行文件，隔离数据目录 |
| 双端构建内容 | Mac arm64＋Windows x64成功；[14运行文件](hover-canvas-candidate-packages.json)完全匹配，两端app.asar一致 |
| 日常包同步 | [同步记录](hover-canvas-packages.json)：Mac256个普通文件、Windows72个文件逐一核对，符号链接保持；dist更新 |
| 文档 | [结构检查](hover-canvas-doc-check.json)，仅证明结构／链接，不替代产品测试 |

过程中发现并修复：结束快照暂时持有旧产物导致空引用、DOM悬停对隔离iframe不可靠。最终改用原生鼠标事件及窗口坐标。初轮夹具缺少动作来源、错误控件定位和焦点前台假设已校准；旧失败报告保留作诊断，不作为最终结论。200%截图改用原生capturePage，避免自动化截图裁切。

Windows真机、跨显示器实机、真实会议声音与实际在线会议全屏空间未验；几何单元覆盖含负坐标显示器。Mac检查只用合成会议，不代表真实模型质量或会议效果。日常实例未重启，正常退出再打开才使用新主进程。Vite既有大包提示与本地未签名构建提示仍在，不影响已执行的包内结果。
