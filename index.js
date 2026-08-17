/**
 * dsh-sleep-send — 服务端（host 侧）入口
 *
 * 定时发送为纯客户端插件：全部调度与 UI 位于 client.js
 * （conversation.input.right / conversation.input.overlay 槽位），
 * host 侧仅提供 cordis 插件骨架，供 cordis.patch.yml 注册
 * （dsh.bundle.patch），使 dsh plugin 的 reconcile 能识别本包为 profile 层。
 */

const name = "dsh-sleep-send";

/** 必需服务：无（纯 client 插件）。 */
const inject = [];

function apply(ctx) {
  // host 侧无逻辑：功能在浏览器端（client.js）实现。
  ctx; // 保持签名完整
}

export { apply, inject, name };
export default { name, inject, apply };
