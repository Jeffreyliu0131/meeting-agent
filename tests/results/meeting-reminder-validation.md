# 会议候选提醒验证

日期：2026-09-12 11:41（Asia/Singapore）。基线：HEAD 2661764＋本轮未提交代码／测试，macOS arm64／Electron44.3.0。实现阶段未提交；后续PR交付见本轮session，已有其他任务文档保留。

## 本轮实现与结果

已实现“检测信号之后”的双渠道提醒、中英文文案、8秒气泡／悬停暂停、关闭与过期、去重、静默开始、配置例外、隐藏／恢复设置与托盘入口。真实检测器没有接入，正常运行不会自行产生会议候选。

- `npm run build`、最终TypeScript检查及`npm run format:check`通过。
- `npm test`：99通过／0失败，包括13项新增提醒边界测试。
- 最终完整Electron回归：19通过／0失败／0重试／0跳过；[统计](meeting-reminder-tests.json)。涵盖原有14项与新增5项双语气泡、保持与过期、静默开始、偏好持久化、系统通知替身及IPC隔离。
- 首轮发现新增复选框使旧位置选择器定位错误、CDP越出Electron窗口不稳定产生leave、测试进程退出与临时目录删除竞争。已改明确字段定位、通过实际React组件派发leave事件，并等待进程close／清理连接后删除测试目录。保留真实hover和实际计时检查；不能用此测试声称所有跨窗口鼠标情形已真机验收。
- 点击开始使用合成振荡器及localhost转写替身；未开启真实麦克风、未调用真实模型或真实STT。提醒本身不申请录音权限，普通UI／生成页面不可注入候选。
- 已视觉查看实际[中文气泡](meeting-reminder-bubble-zh-CN.png)和[英文气泡](meeting-reminder-bubble-en.png)，文字与关闭／点击入口完整，没有抢占工作页焦点。

## 双端包与Mac隔离运行

从同一dist打包，macOS使用本机Electron运行时，Windows使用已有44.3.0 x64运行时并保持`signAndEditExecutable=false`。产物为`release/mac-arm64/Meeting Agent.app`与`release/win-unpacked`。这是本地目录包同步，不是签名安装器或远程安装。

[逐文件与源码指纹](meeting-reminder-packages.json)证明两端14个dist文件均与本地构建完全一致，整个app.asar SHA-256相同。

[Mac包隔离检查](meeting-reminder-package-smoke.json)通过：独立空库0会议，中文／英文设置均可见，隐藏入口成功；即使设置开发环境变量，打包应用仍拒绝候选测试注入。已检查[中文设置](meeting-reminder-package-zh-CN.png)与[英文设置](meeting-reminder-package-en.png)。脚本见[reminder-package-check.mjs](../../scripts/reminder-package-check.mjs)，不操作日常数据库、不重开用户日常实例。原生截图必须等待新语言绘制完成，不能把旧合成帧作为英文截图。

| 平台 | 源码／包 | 运行与平台能力 |
|---|---|---|
| macOS arm64 | 已同步本轮代码及原路径包 | 包启动、双语设置、隐藏和隔离通过；真实系统通知投递／点击未验，构建发现无有效签名身份 |
| Windows x64 | 已同步同一份源码及完整目录包 | 构建／内容指纹通过；无Windows真机运行证据，通知注册与实际投递未验 |

## 不能推导的完成状态

1. 真实自动检测会议尚未实现；这里仅有可信适配器接入点和合成验证，不能声称打开会议软件即可收到提醒。
2. 原生通知逻辑经替身测试，但系统实际投递／点击尚未通过双端验收。macOS需有效签名，Windows需匹配的快捷方式／通知注册及系统权限；本轮没有创建证书、修改系统注册或绕过免打扰。通知不可用不回退气泡。
3. 自定义气泡尚未增加系统专注模式查询；完整屏幕阅读器、复杂多显示器及Windows实际窗口行为未覆盖。候选去重为本进程生命周期，重启去重须在后续检测器接入时协调。

结论：提醒代码／双端本地包已同步，合成流程验收通过；真实检测与原生投递仍待接入／验收。详见[规范](../../docs/meeting-reminder-spec.md)和[交接](../../docs/sessions/2026-09-12-meeting-reminder.md)。
