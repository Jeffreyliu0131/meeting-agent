# launcher-dialogue-v1 生成提示

工具：内置 `image_gen.imagegen`。用途：生产桌面入口位图。输入：纯文本新生成，没有输入图像编辑目标。

```text
Use case: logo-brand. Create ONE final production desktop launcher icon asset for 'Agents, Everywhere', a thoughtful meeting understanding and reasoning assistant. Brand feeling: extraordinarily refined, quiet, confident, contemporary professional collaboration software. It must work at 44x44 pixels. Square 1024x1024 PNG with genuine transparent alpha outside the rounded square. A softly rounded square (continuous superellipse corners), almost fills the canvas, exact centered frontal view, no perspective. Surface rich midnight cobalt / ink indigo (#172D63 to #244EAB), very restrained satin tonal depth, absolutely NO outline, NO white rim, NO metallic bevel, NO border, NO surrounding shadow. Central mark: a beautifully proportioned abstract conversational aperture, composed of two substantial interlocking ivory curved ribbon strokes, suggesting two voices resolving into one clear open space. The negative space is essential. Bold simple elegant silhouette, distinctive deliberate geometry, no tiny details. The mark should occupy about 52% of tile width with generous internal breathing room. Think a high-end finished productivity app icon, not a sound recorder. NO waveform, NO microphone, NO headphones, NO AI sparkle or star, NO literal text or letters, NO extra badges or status dot. One icon only, no grid, no mockup, no desktop background, no captions. Outer corners must be truly transparent, not a checkerboard graphic. Do not draw any white edging around the tile. The operational status indicator will be added separately by the application.
```

实际输出为1254×1254带alpha的PNG；未冒充提示请求的1024×1024。运行尺寸由44 DIP窗口和CSS承接。
