# UI 位图素材

- [launcher-dialogue-v1.png](launcher-dialogue-v1.png)：桌面44×44 DIP入口的对话环标识，1254×1254、RGBA。2026-09-12由内置image_gen生成；不使用旧波形图标作编辑目标。原文件从生成目录复制进仓库，未覆盖其他素材。
- [生成提示](launcher-dialogue-v1.prompt.md)：实际使用的生成提示。内置工具未暴露可指定的模型ID，本轮没有使用CLI／外部API fallback。

图中没有状态点。UI通过CSS视口裁去约10%的透明安全边距，不改变原PNG像素；采用透明原生窗口，无白色描边及系统阴影。状态标记独立来自[launcher-status.ts](../launcher-status.ts)，不能用图像推导状态。当前不替换macOS Dock／系统托盘图标。

行为与证据见[图标规范](../../../docs/design/launcher.md)及[本轮记录](../../../docs/sessions/2026-09-12-launcher-icon.md)。
