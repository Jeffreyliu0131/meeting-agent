# 来源与验证边界

整理日期：2026-09-11。产品方向依据本任务用户确认，见[决策记录](decisions.md)。下列官方文档在本任务中查阅，支持能力与接口边界；不证明当前账号可用、依赖已安装或产品已跑通。

| ID | 官方来源 | 本设计采用的事实／实施时复核点 |
|---|---|---|
| S01 | [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security) | Node／context／sandbox、IPC发送者、权限和导航需要分别约束；生成内容不能继承可信应用权限 |
| S02 | [Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer) | 桌面采集存在系统与权限差异；实际音轨必须真机验证 |
| S03 | [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process) | 可用于独立可信服务进程；不是生成代码的通用安全沙箱 |
| S04 | [Zoom RTMS媒体数据](https://developers.zoom.us/docs/rtms/meetings/media/) | 平台内容流可作为输入适配；参与者信息、语言和权限以实际流验证 |
| S05 | [OpenAI实时转写](https://developers.openai.com/api/docs/guides/realtime-transcription) | 当前推荐实时转写路线不返回说话人标签；需独立处理身份，模型与参数实施时复核 |
| S06 | [OpenAI说话人标注](https://developers.openai.com/api/docs/guides/speech-to-text#speaker-diarization) | 文件转写可按片段输出说话人；不能直接等同于实时实名识别 |
| S07 | [OpenAI结构化输出](https://developers.openai.com/api/docs/guides/structured-outputs) | 可约束模型输出结构，仍需处理失败并做业务校验 |
| S08 | [Mermaid Usage](https://mermaid.js.org/config/usage) | 图描述可渲染为SVG；图形交互与安全配置要独立处理 |
| S09 | [Vega-Lite Parameters](https://vega.github.io/vega-lite/docs/parameter.html) | 声明参数和选择可支持交互；本产品还需绑定可信数据与业务操作 |
| S10 | [MDN SVG as an image](https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image) | 作为图片的SVG与直接嵌入文档的能力不同，不能混淆脚本和交互边界 |
| S11 | [MDN iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox) | iframe sandbox能力和限制需与实际宿主隔离、导航、网络及资源控制组合 |
| S12 | [pyannote官方模型评测](https://huggingface.co/pyannote/speaker-diarization-community-1#benchmark) | 不同数据集的分组表现不同；分组错误率不等于实名正确率，不能保证本产品90%／99% |
| S13 | [Apple HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials) | 材质用于层级且须克制，重视可读性与减少透明度；前端参考原则，不代表原生效果已实现 |
| S14 | [Apple HIG Typography](https://developer.apple.com/design/human-interface-guidelines/typography) | 字阶、可读性和字体一致性参考；本项目具体token为设计建议 |

S13、S14的网页入口需要JavaScript，本轮通过Apple官方同源[Materials文档数据](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/materials.json)和[Typography文档数据](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/typography.json)读取；没有将搜索摘要当作原生实现验证。

## 工程设计与外部事实分开

本目录的模块划分、对象模型、命令命名、产物规范、限制初值、阶段安排和验收目标均是本项目设计，不是供应商承诺。官方有能力也不代表运行者有对应额度或权限。

设计阶段尚未验证的能力已部分进入本地程序验证；当前完成边界统一查[状态页](status.md)与[结果索引](../tests/results/README.md)。真实音频质量、身份、模型质量、真实时延／成本及双端实用性仍不能凭官方文档判定通过。无官方赛程、评分或提交要求的完整核验，因此不写具体比赛工时或成果。

外部下载技术设计仅被作为比较参照；当前产品与契约已在本目录独立表述，不需要复制或访问原文件。

## 实施时核对（2026-09-11）

- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)：结构化响应接口；本地 schema 校验独立保留。
- [OpenAI Speech to text](https://developers.openai.com/api/docs/guides/speech-to-text)：音频文件转写接口；本版为 PCM 切片上传，不宣称 Realtime API。
- [Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer)：系统音频／平台权限差异；代码存在不代表两端音轨已实测。
- 实际依赖精确版本在 package-lock.json。官方 Electron macOS arm64 与 Windows x64 压缩包 SHA-256 已与 npm electron 包内 checksums.json 比对。
