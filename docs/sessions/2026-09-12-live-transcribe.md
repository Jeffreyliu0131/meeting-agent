# GPT Live Transcribe 接入

记录类型：本任务执行记录。状态：实现、本地验证与切换完成，真实会议效果未验收。更新时间：2026-09-12（Asia/Shanghai）。

## 目标与授权

用户已接受将 Whisper 切换为 `gpt-live-transcribe` 流式转写的方案，DeepSeek Agent 保持不变。范围包括现有音频流程的必要改造、协议／生命周期测试、合成语音实际调用及本地重启；不自动采集真实会议，不提交／推送。

## 接手基线

HEAD `3f6279a`。已有本地启动任务对 README、状态、session 索引和启动记录的未提交修改，保留。当前采音为 16 kHz、约 5 秒 WAV，后端 HTTP 转写队列；已有音频 lease 支持暂停／结束后完成已接受输入。

## 实际变化与依据

依据 [官方实时转写文档](https://developers.openai.com/api/docs/guides/realtime-transcription)：24 kHz PCM、WebSocket transcription session、持续 append、显式 commit、按 item_id 对齐 delta／completed。已核对账号模型列表可见 `gpt-live-transcribe`，安装 ws 及类型依赖。

实施顺序：先协议与音频收尾回归测试，再接入后台独立音源会话、100ms 采音包和临时转写展示；最后构建、实际供应商合成音频与桌面检查。每个音源按会议／epoch 隔离，最终文本沿用 lease 入库，临时文本不参与 Agent 或持久化。保留显式配置的旧 HTTP 模型路径，不静默降级。断线／超时记录缺口，暂停与结束提交尾音并关闭会话。

以上已完成：[转写连接](../../src/integrations/live-transcription.ts)、[采音](../../src/integrations/capture.ts)／[worklet](../../public/pcm-worklet.js)、[worker](../../src/service/worker.ts)、[会话服务](../../src/service/session.ts)、桌面收尾与UI暂定文本接入；默认及本地配置切换为 `gpt-live-transcribe`。修复旧停止计时器影响恢复采音，以及Windows测试退出后临时数据库占用问题。

## 验证与未验证

构建成功；44项单元、8项真实Electron桌面测试通过。模型列表HTTP 200，实际WebSocket握手成功；合成语音约2.274秒收到首个delta，最终两句转写正确且无缺口。定向格式、文档和差异检查通过；全库格式检查仍存在未修改文件的Windows CRLF差异。完整证据与范围见 [验证记录](../../tests/results/live-transcription-validation.md)。

已重启本地应用并打开主工作页，PID16984响应正常；重启前后只核对状态／数量，3场记录和当前26段原话保留，当前会议仍暂停。本轮没有自动调用真实麦克风，真实会议质量与长连接负载未测。

## 未完项与下一步

本轮切换目标完成。用户可在现有暂停会议恢复音频，或开始新会议使用流式转写。断线时停止本轮输入，恢复会创建新连接；真实设备、噪声、中英混说、线上双通道和长时会话仍需后续专门验证。

## 文件同步与交付

已同步README、配置、源码导航、技术设计、契约、ADR旧路线说明、来源、结果索引、状态和session索引。保留原启动任务未提交内容；本轮未提交／推送。
