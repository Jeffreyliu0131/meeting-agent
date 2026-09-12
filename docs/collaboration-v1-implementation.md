# 首版协作组件 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. 当前用户要求依次执行，沿用当前YH工作目录，不派发子任务，不提交／推送。复用已批准设计，不重复等待批准。

**Goal:** 在本地会议中完成四类组件的自动准备、发起者发放、独立模拟参与者互动及LangGraph分析回流。

**Architecture:** 严格schema与纯领域规则控制业务；SQLite单事务持久化会议和协作数据，Electron可信窗口绑定身份。M理解图衔接C组件与R分析图，回应和统计保持零模型。

**Tech Stack:** 现有TypeScript、Zod、React、Electron、node:sqlite、LangGraph；不新增运行时依赖。

核心路径已按顺序接入；检查完成表示已执行该步骤，不表示设计62项全部达标。[实际差距](collaboration-v1-runtime.md)与[逐项结果](../tests/results/collaboration-v1-validation.md)是接手依据。115项单元与17项Electron通过，变更代码格式／diff和75份文档结构检查通过；全仓既存格式问题另记。

**Spec:** [完整设计](collaboration-v1-design.md)、[契约](collaboration-v1-contracts.md)、[验收](collaboration-v1-acceptance.md)。

## Global Constraints

- 首版四类组件；普通生成式表达与个人推演保持独立。
- 发起者正式发放／记录；模型和未识别声音无权限代操作。
- 回应绑定公开版本与可信actor；幂等、旧版本拒绝、来源／分析欠账阻止确认。
- 独立模拟窗口、权限投影；Windows与macOS同代码，分别说明实际验证范围。
- 保留现有未提交设计；测试用独立数据库与合成数据，不操作日常库。

## 1. 运行时契约与领域规则

Files: 新增`src/contracts/collaboration.ts`、`src/domain/collaboration.ts`、`tests/unit/collaboration.test.ts`；修改`src/contracts/model.ts`引入可选协作状态。

Interfaces: `createCollaboration(meetingId,names): CollaborationState`；`applyCollaborationCommand(meeting,state,actorId,command): unknown`；`projectCollaboration(state,actorId): CollaborationSnapshot`。函数只操作传入克隆，提交由服务负责。

- [x] 先写投票、权限、改版、明确确认、分工接受和冲突的失败测试。
- [x] 运行`node --import tsx --test tests/unit/collaboration.test.ts`确认功能缺失。
- [x] 用严格判别联合实现schema、业务门槛、确定性统计和角色投影。核心断言：
```ts
assert.equal(view.result.counts[0].count, 1);
assert.throws(() => respondAsOtherPerson(), /UNAUTHORIZED/);
assert.throws(() => recordWithPendingParticipants(), /CONFIRMATION_INCOMPLETE/);
```
- [x] 验证本层测试通过，记录准确通过数。

## 2. 持久化与可信服务

Files: 新增`src/service/collaboration-store.ts`、`src/service/session.ts`中的协作方法、`tests/unit/collaboration-service.test.ts`；修改`src/service/store.ts`、`src/service/session.ts`。

Interfaces: `writeCollaboration(db,state)`、`loadCollaboration(db,meetingId)`与`SessionService.collaborate(raw,actor)`；复用同一SQLiteStore.save事务，拒绝嵌套BEGIN。

- [x] 写重启恢复、重复命令、事务失败、截止边界的失败测试并运行。
- [x] 规范化协作表、唯一约束；事务内保存状态、命令结果和事件；成功后才交换内存状态。
```ts
const before = service.snapshot();
assert.throws(() => failingWrite());
assert.deepEqual(service.snapshot(), before);
```
- [x] 结束会议关闭互动，重启恢复开放轮与逾期截止；执行本层及现有存储回归。

## 3. 本地角色窗口与四组件界面

Files: 新增`src/ui/collaboration/Panel.tsx`、`src/ui/collaboration/styles.css`；修改`src/desktop/main.ts`、`src/service/worker.ts`、`src/ui/main.tsx`；新增`tests/e2e/collaboration.spec.ts`。

Interfaces: host使用`collaborationCommand`／`collaborationSnapshot`／`openComponent`／`openParticipant`；participant仅能使用绑定身份下的协作方法。独立`role=component`悬浮窗编辑发放、`role=participant`悬浮窗回应；准备就绪后悬浮球显示数量和类型提示，主工作区保留索引。准备完成不抢焦点，关闭窗口不取消组件。

- [x] 写Electron多窗口测试，明确期望参与者不能取主snapshot或伪造身份。
- [x] 接入可信IPC白名单、窗口actor映射和投递ack；四组件固定视图及表单从runtime schema生成合法命令。
```ts
await participant.getByRole('button', { name: '提交投票' }).click();
await expect(participant.getByText('已提交')).toBeVisible();
```
- [x] 验证手工准备→三人互动→截止／记录闭环、错误保留输入、200%缩放。

## 4. M意图、C准备与R影响图

Files: 新增`src/agent/collaboration.ts`、`src/service/collaboration-runtime.ts`、`tests/unit/collaboration-workflow.test.ts`；修改`src/agent/provider.ts`、`src/agent/context.ts`、`src/agent/workflow.ts`与SessionService衔接。

Interfaces: `runComponentWorkflow(ports)`、`runImpactWorkflow(ports)`；协作提案只能提交私有草稿／分析记录。来源采用现有Ref(id,rev)，保留模型预算与fence。

- [x] 写带有序合成模型输出的真实图测试：准备、持续收集、歧义、否定、异议回流。
- [x] 添加意图schema／prompt、有界组装修复、规则优先冲突分析、来源前沿和分析水位、幂等因果事件。
```ts
assert.equal(rounds.length, 0); // 语音“开始”只提案
assert.equal(updatedDraft.id, originalDraft.id); // 跨批收集同一组件
```
- [x] 验证普通票零模型、超预算结束、个人分支不发布、旧提案不能覆盖手工编辑。

## 5. 闭环验证与交接

Files: 完善上述测试，新增`tests/results/collaboration-v1-validation.md`；同步实际运行时、README、状态、session及结果索引。

- [x] 运行`npm test`、`npm run build`与相关Electron测试，修复真实失败。
- [x] 按62项验收逐项给出已覆盖／未验证及证据；真实模型测试与程序测试分列，真实麦克风不擅自开启。
- [x] 文档检查、格式检查、`git diff --check`，确认无密钥、日常数据或构建包进入改动。
- [x] 记录Windows实际结果及macOS未测边界；不把部分测试写成全部交付。
