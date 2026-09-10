const $ = (selector) => document.querySelector(selector);
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const labels = { ok: "成功", partial: "部分成功", empty: "暂无内容", running: "采集中", queued: "排队中", interrupted: "运行中断", needs_login: "需要登录", needs_setup: "需要配置", error: "失败" };
const chip = (status) => `<span class="status-chip ${escape(status)}">${escape(labels[status] || status || "—")}</span>`;
const time = (value) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }) : "—";

let state;
let platform;

async function api(url, body) {
  const response = await fetch(url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      data.error === "Not found"
        ? "服务接口未加载，请在终端运行 npm run dev 或 npm run up 重启后再打开此页"
        : data.error || `HTTP ${response.status}`,
    );
  }
  return data;
}

function notice(message) { $("#notice").textContent = message; }

function scheduleOptions(source) {
  const options = [{ value: "manual", label: "仅手动" }, { value: "hourly", label: "每小时" }];
  for (const hour of Array.from({ length: 24 }, (_, i) => i)) {
    options.push({ value: `daily:${hour}`, label: `每天 ${String(hour).padStart(2, "0")}:00` });
  }
  return options.map((opt) => `<option value="${escape(opt.value)}" ${source.schedule === opt.value ? "selected" : ""}>${escape(opt.label)}</option>`).join("");
}

async function refresh() {
  state = await api("/api/source-config");
  platform = await api("/api/platform");
  $("#queue-state").textContent = `执行中 ${platform.running} · 队列 ${platform.queueSize}`;
  $("#sources").innerHTML = state.sources.map((source) => `
    <tr>
      <td><strong>${escape(source.name)}</strong></td>
      <td>${escape(source.targetSummary)}</td>
      <td>${escape(source.scheduleLabel)}</td>
      <td><button class="ghost" type="button" data-edit="${escape(source.id)}">编辑</button></td>
      <td class="muted source-notes">${escape(source.notes)}</td>
    </tr>`).join("");
  $("#runs").innerHTML = platform.runs?.length
    ? platform.runs.slice(0, 20).map((run) => `<details class="run-row"><summary>${chip(run.status)}<strong>${escape(run.sourceId || run.taskName)}</strong><span>${run.itemCount} 条</span><span class="muted">${time(run.startedAt || run.queuedAt)} · ${run.trigger === "schedule" ? "定时" : "手动"}</span></summary><pre>${escape(JSON.stringify(run, null, 2))}</pre></details>`).join("")
    : "<p class=\"muted\">定时采集或首页手动采集后，记录会出现在这里。</p>";
}

function renderFields(source) {
  $("#edit-fields").innerHTML = source.fields.length
    ? source.fields.map((field) => `
      <label>
        ${escape(field.label)}
        ${field.type === "lines"
          ? `<textarea class="input" name="${escape(field.key)}" rows="4" placeholder="${escape(field.placeholder || "")}">${escape(source.values[field.key] || "")}</textarea>`
          : `<input class="input" name="${escape(field.key)}" type="${field.type || "text"}" value="${escape(source.values[field.key] || "")}" placeholder="${escape(field.placeholder || "")}">`}
        ${field.hint ? `<span class="muted">${escape(field.hint)}</span>` : ""}
      </label>`).join("")
    : "<p class=\"muted\">此来源使用内置 watchlist 或 API 规则，无需额外目标配置。可设置定时与条数。</p>";
  const login = [];
  if (source.id === "xiaohongshu") {
    login.push(`<button type="button" class="ghost" data-qr="xiaohongshu">${source.login?.loggedIn ? "重新登录小红书" : "扫码登录小红书"}</button>`);
    if (source.login?.loggedIn) login.push('<span class="source-login-badge">已登录</span>');
  }
  if (source.id === "wechat") {
    login.push(`<button type="button" class="ghost" data-qr="wechat">${source.login?.loggedIn ? "重新扫码授权" : "扫码登录公众号"}</button>`);
    if (source.login?.loggedIn) login.push('<span class="source-login-badge">已登录</span>');
  }
  $("#edit-login").innerHTML = login.join(" ");
}

function openEdit(sourceId) {
  const source = state.sources.find((entry) => entry.id === sourceId);
  if (!source) return;
  const form = $("#edit-form");
  form.reset();
  form.elements.sourceId.value = source.id;
  form.elements.limit.value = source.limit;
  form.elements.scheduleEnabled.checked = source.scheduleEnabled;
  $("#edit-schedule").innerHTML = scheduleOptions(source);
  form.elements.schedule.value = source.schedule;
  $("#edit-title").textContent = `编辑 · ${source.name}`;
  renderFields(source);
  $("#edit-error").textContent = "";
  $("#edit-dialog").showModal();
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.close) return $(`#${button.dataset.close}`).close();
  try {
    if (button.dataset.edit) return openEdit(button.dataset.edit);
    if (button.dataset.qr) {
      const isWechat = button.dataset.qr === "wechat";
      $("#qr-title").textContent = isWechat ? "微信公众号登录" : "小红书登录";
      $("#qr-image").hidden = true;
      $("#qr-message").textContent = "正在请求二维码…";
      $("#qr-dialog").showModal();
      const data = await api(isWechat ? "/api/wechat/qrcode" : "/api/xiaohongshu/qrcode", {});
      if (data.isLoggedIn) $("#qr-message").textContent = isWechat ? "已经授权。" : "已经登录。";
      else {
        $("#qr-message").textContent = isWechat ? "请用微信扫码授权。" : "请用小红书 App 扫码。";
        $("#qr-image").src = data.image;
        $("#qr-image").hidden = false;
      }
    }
  } catch (error) { notice(error.message); }
});

$("#edit-form").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const sourceId = form.elements.sourceId.value;
  const payload = Object.fromEntries(new FormData(form));
  payload.scheduleEnabled = form.elements.scheduleEnabled.checked;
  payload.limit = Number(payload.limit);
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await api(`/api/source-config/${sourceId}`, payload);
    $("#edit-dialog").close();
    notice("已保存，与首页采集共用此配置。");
    await refresh();
  } catch (error) {
    $("#edit-error").textContent = error.message;
  } finally {
    button.disabled = false;
  }
};

await refresh().catch((error) => notice(error.message));
const editId = new URLSearchParams(location.search).get("edit");
if (editId) openEdit(editId);
