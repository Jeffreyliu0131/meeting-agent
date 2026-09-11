# Meeting Agent｜会议事件与生成式表达

独立桌面会议助手：支持线上与线下会议，以每场会议为独立事件。Agent持续理解讨论，自主规划、生成和修订简洁的文字、逻辑图、对比、时间安排与交互推演产物。

**当前状态：实现设计已整理，产品尚未开发。** 没有安装依赖、采集真实音频、调用模型或完成产品测试。`tests/fixtures/`是合成测试材料，不是识别结果。本目录不是已运行的应用。

GitHub：[Jeffreyliu0131/meeting-agent](https://github.com/Jeffreyliu0131/meeting-agent)（私有）。本目录是独立Git根目录；父目录所有资料仅保留本地。

## 从这里开始

| 阅读顺序 | 文档 | 回答的问题 |
|---|---|---|
| 1 | [产品定义](docs/product-definition.md) | 用户、产品形态、闭环和范围是什么？ |
| 2 | [会议表达语言](docs/expression-language.md) | Agent要生成什么，如何判断该不该生成？ |
| 3 | [技术设计](docs/technical-design.md) | 输入、理解、生成、交互和保存如何连接？ |
| 4 | [数据与操作契约](docs/contracts.md) | 状态、来源、版本和模块接口是什么？ |
| 5 | [表达运行环境](docs/rendering-runtime.md) | SVG、图语言、图表和HTML如何承接？ |
| 6 | [验收标准](docs/acceptance-criteria.md) | 怎样证明行为正确、表达清楚且能更新？ |
| 7 | [实施与交接计划](docs/implementation-plan.md) | 下一轮从哪里开始，做到哪里算完成？ |

[决策与确认](docs/decisions.md)区分用户确认与工程建议；[官方来源](docs/sources.md)说明外部能力与未验证条件。先阅读[协作约定](AGENTS.md)。

## 独立目录边界

本目录是用户2026-09-11要求建立的未来代码仓库边界，可单独作为工作区和GitHub仓库根目录。业务与实现依据均在本目录内，运行或开发不得依赖父目录的报告应用、个人Downloads文件或本机绝对路径。

父目录保留早期研究、报告和旧方向记录，本轮未修改。那些材料包含“人物归属不可降级”“有限固定视图”等较早表述；本目录以[最新确认记录](docs/decisions.md)解释当前产品，不从旧材料恢复已被修正的要求。

```text
meeting-agent/
├── AGENTS.md
├── README.md
├── .gitignore
├── docs/                  # 自包含的产品、设计、契约和验收
│   └── adr/               # 尚待开发验证的技术决策建议
├── src/                   # 产品代码位置；当前仅目录占位
│   ├── desktop/
│   ├── service/
│   ├── integrations/
│   ├── agent/
│   ├── domain/
│   ├── renderers/
│   └── contracts/
└── tests/
    ├── fixtures/          # 三类合成讨论及机器可读输入
    └── results/           # 只存真实执行结果；当前无产品结果
```

## 开发与发布状态

尚无`package.json`或可运行命令，不要把占位目录误报为脚手架完成。下轮收到实际开发请求后，按实施计划建立构建工具和测试命令，再更新本页。

本次用户已授权创建远端仓库并首次提交、推送本目录；仓库根为本目录，父目录的研究、报告和私人文件不纳入。后续提交、推送和发布仍需按当次请求授权。`.gitignore`用于减少误纳入，不能替代提交前检查。暂不添加未经用户选择的许可证，也不写未核验的黑客松赛程或参赛成果。
