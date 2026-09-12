# 语言与本地化实施规范

> 文件职责：产品／工程设计要求，不是完成清单。当前进度与最新修订见[状态页](status.md)；已交付首版取舍见[ADR-003](adr/003-cross-platform-first-version.md)，实际结果见[验证记录](../tests/results/README.md)。具体实现以代码核对，未实现的要求仍是目标。
2026-09-11｜最新用户确认：语言默认跟随系统，中文系统使用简体中文，其他语言系统默认英文；设置可手动覆盖。本条取代早期固定英文默认，会议与Agent继续支持中文、英文。交互与迁移见[会议入口规范](meeting-entry-spec.md)，系统偏好解析与双语前端已接入，程序范围见[前端验证](../tests/results/frontend-refresh-validation.md)；真实语音及模型语言质量仍待验收。

## 1. 三种语言分开

| 层次 | 默认值 | 切换影响 |
|---|---|---|
| Interface language | `system`，解析为`en`或`zh-CN` | 固定UI、按钮、菜单、错误、辅助标签与设置；不修改原话和既有产物 |
| Meeting output language | 新会议解析默认输出偏好（默认`system`），保存为本场明确的`en`或`zh-CN` | Agent标题、纪要、图标签、比较与解释；属于这场会议的属性 |
| Spoken input languages | English＋Mandarin Chinese | STT预期语言及理解上下文；允许混说，不由UI语言限制 |

中文界面首版指简体中文`zh-CN`，语音中文首版验证普通话；不把方言／其他地区语种自动纳入已验证范围。UI使用内部枚举`en | zh-CN`，供应商语言代码由适配器转换，不把UI locale原样当API参数。

首次使用跟随系统语言：主语言为`zh`（含地区变体）映射简体中文，其余映射英文；这是界面回退规则，不承诺繁体本地化或方言语音质量。设置支持跟随系统／English／简体中文，手动选择优先并持久化。跟随系统时在启动／系统语言变化通知后重新解析界面；活动会议输出保持启动时快照。旧存储无选择来源时保留已保存值，不猜测是否手选；允许用户切回跟随系统。全英文工作流不出现中文占位提示、未翻译错误、无障碍标签或图例。原始中文发言作为来源出现不算UI漏翻译。

## 2. 语言切换规则

- 在完整设置中选择Interface language立即独立保存并更新可信外壳，无需点击“保存设置”；该写入只携带已保存偏好与新界面语言，不提交音频／显示／快捷键等未保存草稿。切换期间防止重复写入和整份保存竞争，失败在语言字段附近提示并保留原语言与其他草稿，不停止会议、不触发全场模型重跑，也不把当前输出语言偷偷改掉。
- 新建会议不询问Output language；服务从默认输出偏好解析本场语言并保存。可在会中设置明确更改；当前“会议输出语言”选择会立即发送语言变更，不等待全局保存。界面和系统语言变化不自动改变本场输出。页面与右键菜单不常驻语言快捷切换。
- 更改当前Output language后，新生成内容使用新语言；当前可见产物基于相同事实与来源生成对应语言版本。保留旧版直至新版本通过校验，并显示`Updating language…`。
- 未打开的历史产物按需生成语言版本，不因为一个设置重算全部历史。新旧语言不同的过渡状态可见，不混排成用户无法识别的半翻译内容。
- 语言改写不得新增业务主张、改变条件、数字、责任或决定范围。对象ID和SourceRef不因翻译改变。
- 生成期间会议条件变化或用户再次切换语言，旧任务不得覆盖新事实或目标语言；同时检查内容依赖与语言revision。

## 3. 原话、翻译与证据

Segment保存供应商原始转写语言内容，不先统一翻译再当“原话”。英文输出可以引用中文原文；来源抽屉默认显示原文，提供Show translation，翻译标注Translated。

翻译是来源的派生表示：保存对应原段落与revision、目标locale、生成状态及版本。原文修订后旧翻译标过期，不继续作为准确译文。用户纠正原文与纠正译文是不同操作；修正译文不改变会议历史。

专有名词、产品名、代码标识默认保留。缩写解释只有依据充分时提供；“不”“仅当”“预计”“尚未确认”等限定词不得为缩短文本而省略。数字保持真实币种与单位，语言切换不做汇率换算。

时间按会议时区解析，按界面或输出locale格式化显示。日历日期、UTC时刻、工期分别处理，不用翻译重新解释“下周五”的参照日期。无法确定时保持待确认。

## 4. Agent上下文与契约

模型接收`outputLocale`、预期输入语言、必要术语与当前视觉配置。模型的schema键、对象类型、IDs、actionIds固定，不随语言翻译。标题与正文由模型用指定语言表达，事实与来源仍用稳定ID链接。

概念类型示意（不是当前schema的逐字段副本）：

```ts
type ProductLocale = 'en' | 'zh-CN';
type UserPreferences = {
  uiLanguage: "system" | ProductLocale;
  defaultOutputLanguage: "system" | ProductLocale;
  // UI有效locale由系统语言与偏好解析；会议outputLocale保存解析结果。
  reduceTransparency: boolean;
  reduceMotion: boolean;
};
type MeetingLanguage = {
  outputLocale: ProductLocale;
  languageRevision: number;
  expectedInputLanguages: ['en', 'zh-CN'];
};
type ArtifactPresentation = {
  artifactId: string;
  locale: ProductLocale;
  languageRevision: number;
  visualProfileId: 'collaborative-light-v2';
  revision: number;
};
```

`languageRevision`属于会议表达配置，切换输出时递增；`uiLocale`改变不递增会议事实版本。产物提交校验表达配置与对象依赖，避免英文任务晚到后覆盖中文目标，或译文覆盖新事实。

当前偏好字段与语言revision见 `src/contracts/model.ts`／`src/domain/preferences.ts`；visualProfileId由全局主题配置提供，未逐产物持久化。桌面启动使用`app.getPreferredSystemLanguages()[0]`取得macOS／Windows首选系统语言，空列表才回退`app.getLocale()`；`MEETING_SYSTEM_LOCALE`保留测试覆盖。应用语言和地区格式不能替代系统首选语言（[Electron API](https://www.electronjs.org/docs/latest/api/app#appgetpreferredsystemlanguages)）。当前系统语言在启动和偏好解析时使用，运行中系统语言变化通知仍属目标能力，未据此宣称实测。

`expectedInputLanguages`是产品候选集，不证明供应商会自动准确识别；实际STT配置与语言质量按提供商能力验证。当前官方实时转写支持传多个预期语言，仍需实测混说、口音、日期和数字。[S05](sources.md)

## 5. UI实现要求

固定文案使用集中字典key；[ui-copy.json](design/ui-copy.json)提供首版核心菜单、设置、状态与操作文案，两种语言key完全一致。`src/ui/i18n.ts`合并该字典及新增的中英前端文案；新增界面文案补齐两个locale，不能到处硬编码中文。

插值和复数由本地化工具处理，不拼接自然语言片段；机器错误code与展示文字分开。生产环境缺key可以英文回退并记录诊断，但英文回退不作为中文完成验收。

日期／数字使用平台本地化格式化能力，值保持不变。英文句子式大小写，中文不夹多余英文缩写；界面默认不同时显示两份完整译文。重要业务内容的双语对照只在来源或用户明确请求时展示。

中文字体回退与英文长度扩张都要测试。字号不能因为中文或翻译更长就缩小；应换行、调整布局或按需展开。输入法组合期间Enter不发送消息。

## 6. 验证矩阵与成本边界

| 测试条件 | 必须检查 |
|---|---|
| 英文UI＋英文会议＋英文输出 | 全部固定UI与生成内容可直接用于英文演示 |
| 英文UI＋中文会议＋英文输出 | 原文不改、译出重点正确、条件与数字一致 |
| 中文UI＋英文会议＋中文输出 | UI完整本地化，生成图形和来源操作无漏项 |
| 中英混说＋任一输出语言 | 不中断话题关系，专有名词保留，无凭空翻译事实 |
| 处理中切换UI／输出语言 | 不重启采集，不丢输入，旧任务不覆盖新语言／新事实 |

界面本地化属于有限增量工作；实际转写与生成质量没有“切一个按钮就完成”的保证。按实际输出测试，不因模型自称多语言就验收。用户本轮已选择双语，不能自行退回English-only；若时间受限，报告未完成项，不暗改需求。

开发新增[双语合成样例](../tests/fixtures/bilingual-meeting.json)用于语义和语言版本逻辑；它不能证明实际中文音频或口音识别效果。

## 会议提醒文案

[提醒规范](meeting-reminder-spec.md)使用集中ui-copy字典：中文“你可能正在开会／点击开始记录”，英文“You might be in a meeting / Click to start recording”。连接、记录中、关闭及设置全部双语。气泡即时切换；已投递系统通知保留投递时语言，不因语言切换重发。
