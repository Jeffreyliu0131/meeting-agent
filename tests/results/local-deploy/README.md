# 本地部署验证证据

2026-09-12，macOS arm64／Electron 44.3.0；基线 main `55267d6` 加本地未提交改动，固定为本轮14:45验证快照。输入均为synthetic/test，没有调用真实模型或采集真实音频。

- [源码指纹](source-manifest.json)、[三份安装包核对](packages.json)：Mac独立安装、Mac保留包、Windows x64保留包的app.asar完全一致，14个dist文件与构建匹配。
- [单元完整复验](unit-final.txt)：227/227通过；随后流式完成逻辑变化，相关[9项单元](unit-targeted.txt)通过。不是对后续悬浮预览改动的验证。
- [初轮桌面](e2e-initial.txt)：30/33通过，容量故障／旧界面断言被发现。
- [第二轮桌面](e2e-final.json)：32/33通过；此前3项已通过，剩余提醒测试误把HTTP替身配成WebSocket。固定测试模型为whisper-1后，[受影响6项桌面](e2e-targeted.json)全部通过，包括提醒启动／设置恢复、4项原话与局部更新、模型传输／图形与试算。保留失败记录，不将分阶段结果写成同一次33/33。
- [构建](build.txt)、[Mac打包](pack-mac.txt)、[Windows打包](pack-win.txt)、[最终Mac隔离启动](mac-smoke.json)通过。未签名验证包，Windows只交叉构建／内容核对，未做Windows真机运行。
- [日常启动](daily-start.json)：独立安装到用户Applications并已启动；原数据目录保留、启动时0会议、无真实采音。旧日常进程无响应，在确认0活动会议后精确结束。
- [后续源码差异](source-drift.json)：共享工作区随后新增悬浮预览工作，且其他打包曾在日常启动时重建release；因此最终运行包独立安装，固定双端包保留到版本目录。当前移动中的工作树与部署快照不完全一致。

安装路径：`~/Applications/Meeting Agent.app`。同源包：`release/deployed-20260912-1445/mac-arm64/Meeting Agent.app` 和 `release/deployed-20260912-1445/win-unpacked/Meeting Agent.exe`；Windows需保留整个目录。

GitHub main已回读为55267d6；本轮未提交／推送。详情见[部署交接](../../../docs/sessions/2026-09-12-local-latest-deploy.md)。
