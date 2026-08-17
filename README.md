# dsh-sleep-send

DSH Web 的**定时发送** Cordis 客户端插件：在输入框右侧提供「定时发送」按钮与配置面板，支持智能时段、自定义日期时间、多个定时任务，并通过 `localStorage` 持久化任务，刷新页面后自动恢复。

> 🕐 **"sleep-send"** —— 把消息"睡"到合适的时刻再发送：默认只在 12:00–14:00 与 18:00–次日 08:00 这类得体时段内自动挑最近的时间发出，也可以完全自定义日期与时刻。

## 功能

- **输入框右侧按钮**：`conversation.input.right` 槽位，紧挨发送按钮；空草稿禁用、输入后激活。
- **智能时段（默认）**：在 `12:00 – 14:00`、`18:00 – 次日 08:00` 两个时段内自动选取**最近的可发送时间**（当前时间 + 2 分钟起；不在时段内则取下一时段起点）。
- **自定义日期时间**：时间选择器 + 日期快捷（今天 / 明天 / 后天）+ 原生日期选择器（过去日期不可选）；已过时间自动顺延一天；发送时间按具体日期显示（如 `8月19日 周三 12:00`）。
- **多个定时任务**：确认后追加任务并清空输入框（输入框恢复自由，可连续排队多条）；弹窗内可查看 / 逐个删除已设定任务；工具行芯片显示任务数徽标 + 下次发送时间 + 实时倒计时。
- **localStorage 持久化**（`dsh.sched-send.v1`）：任务与自定义偏好刷新后自动恢复；恢复时未到期任务保留、**15 分钟内过期的自动补发**、更早的过期任务丢弃。
- **防误覆盖**：到点发送前若输入框内容已被修改，自动取消本次发送而不是覆盖新内容。
- **无障碍与性能**：全部可交互元素带 `:focus-visible` 焦点环；动画遵循 `prefers-reduced-motion`；脉冲动画仅使用 transform/opacity。

## 截图

> 🖼️ 截图占位 —— 待补充实际运行截图。
> 请将截图放入 `docs/screenshots/` 并替换下方占位链接（或直接替换为 GitHub 相对路径）。

| 工具行按钮与武装芯片 | 配置弹窗（智能时段） | 配置弹窗（自定义日期时间） |
| :---: | :---: | :---: |
| ![按钮与芯片占位](docs/screenshots/placeholder-1.png) | ![智能时段占位](docs/screenshots/placeholder-2.png) | ![自定义日期占位](docs/screenshots/placeholder-3.png) |

> 说明：`docs/screenshots/` 目录当前为空，三个占位图片将在补图后替换。

## 安装

```bash
npm install dsh-sleep-send
```

包导出 `apply(ctx)`（Cordis 插件 client half），以及 `meta` 元信息：

```js
import dshSleepSend, { apply, meta } from 'dsh-sleep-send'

console.log(meta) // { id: 'dsh-sleep-send', name: '定时发送', ... }
// 在 DSH Web 的会话上下文中将 apply 注册为 client half
```

## 运行环境

- **DSH Web**（DeepSeek Harness 的浏览器界面）。插件运行于 client runner：
  - `ctx`、`React`（createElement / useState / useEffect）、`styles` 由 DSH client runner 注入；
  - `timer`、`slots` 通过 `ctx.get()` 获取；
  - 需要 `conversation.input.right` 与 `conversation.input.overlay` 两个槽位。
- 不依赖任何运行时依赖，纯 ESM 源码发布（`"type": "module"`），无需构建。

### 在 DSH 中手动加载（开发）

1. 打开侧边栏「🔌 Cordis 插件」面板；
2. 点击「运行」加载包含本插件 client half 的包；
3. 刷新页面后需在插件面板中重新点一次「运行」（动态 Client 插件按页面实例运行，任务数据保存在 `localStorage`，不会丢失）。

## 使用

1. 在输入框输入消息；
2. 点击输入框右侧的 **⏰ 定时**（或 ⚙ 配置）打开配置面板；
3. 选择 **智能时段** 或 **自定义时间**（含日期快捷 / 日期选择器）；
4. 点击 **加入 · HH:MM 发送** —— 任务加入列表，输入框自动清空，可继续输入下一条并排队；
5. 工具行芯片显示最近任务时间与实时倒计时；点击 ✕ 取消全部任务；
6. 到点后消息自动发送；等待期间若修改了输入框内容，该任务自动取消（不会覆盖新输入）。

## 持久化与恢复

- 存储键：`localStorage['dsh.sched-send.v1']`，内容为 `{ mode, custom, schedules }`；
- 每次任务增删 / 到期发送后即时写回；
- 页面刷新并重新激活插件后，自动认领本会话的持久化任务：
  - 未到期任务保留并继续倒计时；
  - **15 分钟内过期**的任务立即补发；
  - 更早的过期任务丢弃（避免刷新后补发陈旧消息）。

## 数据与隐私

- 所有任务仅保存在**当前浏览器**的 `localStorage` 中，不上传任何服务器；
- 更换浏览器 / 无痕窗口 / 清除站点数据会丢失任务。

## 开发

```bash
npm test          # node --check src/index.js
```

## License

[MIT](LICENSE)
