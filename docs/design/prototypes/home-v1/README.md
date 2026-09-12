# 首页高保真 HTML 预览

状态：用户已明确否定此版，保留对比。当前重做见[第三版](../home-v3/README.md)。仅本地独立预览，不是正式产品实现。

入口：[index.html](index.html)。单个自包含HTML，所有图标来自项目现有Lucide，字体沿用系统字体，无CDN、后台、音频、模型或真实会议数据。

布局：开始会议＋成果预览、最近会议。底部设计预览工具切换首次使用／有记录／需要设置；内容和状态均为synthetic。设置仅在页面内保存，不改变系统或正式应用。

运行：直接打开HTML；也可在本目录执行 `python3 -m http.server 4178 --bind 127.0.0.1`，打开 `http://127.0.0.1:4178/`。

本轮交接：[首屏预览session](../../../sessions/2026-09-12-home-html-preview.md)。用户认可后另行接入Windows与macOS正式产品；本轮无需重打包。

验证：[视觉与交互核验](design-qa.md)／[20项检查](qa/checks.json)。桌面、窄窗与200%缩放已核验；不代表正式产品或Windows真机验收。
