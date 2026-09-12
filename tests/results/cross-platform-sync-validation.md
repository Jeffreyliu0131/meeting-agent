# Mac 与 Windows 本地包同步验证

日期：2026-09-12；本机macOS arm64／Electron 44.3.0。HEAD `6628213`，产品实现提交 `9b6886d`，未改产品源码。已有飞书交接及共享文档修改保留。

## 结论

本地 `release/mac-arm64/Meeting Agent.app` 与 `release/win-unpacked/Meeting Agent.exe` 已更新到同一产品源码。两端包内14个dist文件均与当前构建一致，整个app.asar SHA-256也相同；85个源码／配置／测试指纹与前次独立验收完全相同。此前Mac包停在图标迭代、Windows包更旧；差异来源是本地构建包未同步。

## 本轮执行

- `npm run build`通过。
- macOS：`npx electron-builder --mac --dir --config.electronDist=node_modules/electron/dist`通过。
- Windows x64：从原Windows目录包复制独立临时Electron 44.3.0运行时，以`--win --x64 --dir --config.electronDist=<临时运行时> --config.win.signAndEditExecutable=false`离线打包通过。旧包已保留临时回退副本；运行时未升级，未制作签名安装器。
- 两端[逐文件校验](cross-platform-sync-packages.json)通过。
- `MEETING_E2E_REPORT=/tmp/meeting-sync-e2e.json MEETING_E2E_OUTPUT=/tmp/meeting-sync-e2e npx playwright test`：11 passed，0 failed；[本轮汇总](cross-platform-sync-e2e.json)。覆盖历史列表、搜索、语言、来源、图标、窗口尺寸与缩放、合成输入、表达和个人工作流恢复。未改源码，86项单元测试未重跑；这里只核对其既有源码指纹。
- 更新后的Mac目录包[隔离启动](cross-platform-sync-mac-smoke.json)通过，服务ready，0事件；[日常数据启动](cross-platform-sync-daily.json)通过，随后已正常打开应用。
- 目视核验[合成会议恢复界面](cross-platform-sync-synthetic.png)及[日常首页](cross-platform-sync-daily.png)，未见空白截图或本轮相关显示错误。

## 事件与语言核对

产品无自动seed事件；新库为空。合成测试事件通过服务进入实际Electron前端，使用独立临时数据库；未复制进日常库。当前Mac日常库前后均0场会议。旧交接中的两条历史仅是当时环境证据；当前工作区解析到iCloud目录，而会议数据库保存于每台机器的应用数据目录，不随项目代码或包跨机器同步，不能据旧记录声称当前存在两条会议。

启动会保存规范化状态，因此原始payload哈希变化。本轮重建旧状态序列化并匹配原哈希，确认差异仅为跟随系统的已解析uiLocale／defaultOutputLocale由zh-CN变en，其他保存偏好一致；未主动更改用户语言选择或音频设置。日常截图是在显式禁用模型凭证的检查进程中拍摄，不能由其中未连接提示推断用户实际凭证状态。

## 未验证边界

本轮能确认包内代码、布局、样式、资源和业务实现一致，不能确认Windows真机像素或音频表现一致。未连接Windows设备；没有Windows实机运行、字体／DPI、权限或音频验收。系统字体与平台权限说明有刻意的平台差异。包更新发生在当前工作区，未远程替换任何Windows机器的安装。同步验证阶段未采真实音频或调用真实模型；用户随后授权将本轮文档与验证结果提交推送，应用包及日常库不入库。

接续见[本轮session](../../docs/sessions/2026-09-12-cross-platform-sync.md)。
