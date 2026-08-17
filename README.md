<h1 align="center">dsh-sleep-send</h1>
<p align="center">
  <a href="https://www.npmjs.com/package/dsh-sleep-send"><img src="https://img.shields.io/npm/v/dsh-sleep-send?style=flat-square&color=00ff41&labelColor=050607" alt="npm version"></a>
  <a href="https://github.com/Awu12277/dsh-sleep-send"><img src="https://img.shields.io/github/stars/Awu12277/dsh-sleep-send?style=flat-square&color=00ff41&labelColor=050607" alt="GitHub stars"></a>
  <img src="https://img.shields.io/badge/license-MIT-ff1493?style=flat-square&labelColor=050607" alt="MIT">
</p>


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

| 工具行按钮与武装芯片 | 配置弹窗（智能时段） | 配置弹窗（自定义日期时间） |
| :---: | :---: | :---: |
| ![工具行按钮与武装芯片](docs/screenshots/toolbar-armed-chip.png) | ![配置弹窗-智能时段](docs/screenshots/popover-smart-window.png) | ![配置弹窗-自定义日期时间](docs/screenshots/popover-custom-datetime.png) |

> 截图为清新天蓝主题；替换 `docs/screenshots/` 下同名文件即可更新。

## 安装（推荐）

`dsh-sleep-send` 是一个标准的 **DSH web 插件包**（bundle），一条命令即可装入 web profile：

```bash
dsh plugin --profile web add dsh-sleep-send@latest
```

`@latest` 让 npm 始终解析当前最新版本，**无需手动指定版本号**——后续发版后再次执行同一条命令即可拉到最新版。

该命令会：在 `~/.dsh/profiles/web` 中执行 `pnpm add dsh-sleep-send@latest`，随后 **reconcile** —— 因本包声明了 `dsh.bundle.patch`，会被自动追加到 profile 的 `dsh.profile.bundles` 层；浏览器端（client half）由 `dsh-client-modules` 根据 `dsh.client.platform: "web"` 自动拾取加载。重启 `dsh web` 后生效。

移除：

```bash
dsh plugin --profile web remove dsh-sleep-send
```

也可以作为普通库安装（源码 / 集成参考）：

```bash
npm install dsh-sleep-send
```

包结构（DSH web 插件协议）：

```
dsh-sleep-send/
├── index.js          # host 侧 cordis 插件骨架（纯 client 插件，无 host 逻辑）
├── client.js         # 浏览器端：window.__ModuleLoader__.load({ id, factory })
├── cordis.patch.yml  # bundle patch：注册 dsh-sleep-send 条目
└── package.json      # dsh.bundle.patch + dsh.client.platform: "web"
```

## 运行环境

- **DSH Web**（DeepSeek Harness 的浏览器界面）。client bundle 运行于浏览器页面：
  - `require("react")` 获取 React；`apply(ctx)` 中的 `ctx` 为 client root context；
  - 通过 `ctx.get("slots")` 访问 `conversation.input.right` 与 `conversation.input.overlay` 槽位；
  - 调度定时器优先使用 cordis `timer` 服务，缺失时自动降级为浏览器定时器；
  - 任务与偏好持久化在 `localStorage['dsh.sched-send.v1']`，刷新页面后自动恢复。
- 纯 ESM、零运行时依赖、无需构建。

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
