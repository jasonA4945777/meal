"use strict";

const STORE_KEY = "meal-tracker-v1";
const SLOT_TAGS = ["早", "午", "晚"];
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const FOOD_KEYS = Object.keys(FOODS).sort((a, b) => b.length - a.length);
const CN_NUM = { 半: 0.5, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5 };

// state.meals: 餐點清單（名稱）; state.kcal: 手動輸入的熱量; state.plan: { "YYYY-MM-DD": [早, 午, 晚] }
let state = load();
const MOBILE = window.matchMedia("(max-width: 820px)");
let mode = localStorage.getItem("meal-view") || (MOBILE.matches ? "week" : "month");
let cursor = new Date(); // 目前檢視的週 / 月所包含的日期
let picked = null; // 點選模式中被選取的餐點
let drag = null; // { type: "meal", name } | { type: "slot", date, i }

const $ = (id) => document.getElementById(id);

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && Array.isArray(s.meals) && s.plan) return { meals: s.meals, kcal: s.kcal || {}, plan: s.plan };
  } catch (e) { /* 資料損毀時改用預設值 */ }
  return {
    meals: ["蛋餅", "鮪魚三明治", "雞腿便當", "牛肉麵", "滷肉飯", "水餃", "健康餐盒", "咖哩飯"],
    kcal: {},
    plan: {},
  };
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    toast("無法儲存到瀏覽器，請確認未使用無痕模式");
  }
}

// ---------- 熱量估算 ----------

function quantityOf(part) {
  let m = part.match(/[x×*]\s*(\d+(?:\.\d+)?)/i) ||
    part.match(/(\d+(?:\.\d+)?)\s*(?:份|碗|個|杯|片|顆|粒|盤|塊|條|根|貫|包|瓶|罐)/);
  if (m) return parseFloat(m[1]);
  m = part.match(/([半一二兩三四五])(?:份|碗|個|杯|片|顆|粒|盤|塊|條|根|貫|包|瓶|罐)/);
  return m ? CN_NUM[m[1]] : null;
}

// 回傳估算的大卡數；完全比對不到時回傳 null
function estimate(name) {
  let total = 0;
  let matched = false;
  for (const raw of name.toLowerCase().split(/[\s+＋、,，&＆/]+/)) {
    if (!raw) continue;
    const qty = quantityOf(raw);
    let rest = raw;
    for (const key of FOOD_KEYS) {
      while (rest.includes(key)) {
        const piece = PIECE_FOODS[key];
        total += piece ? piece[0] * (qty ?? piece[1]) : FOODS[key] * (qty ?? 1);
        matched = true;
        rest = rest.replace(key, " ");
      }
    }
  }
  return matched ? Math.round(total) : null;
}

function kcalOf(name) {
  return name in state.kcal ? state.kcal[name] : estimate(name);
}

// ---------- 資料操作 ----------

const dateKey = (dt) =>
  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
const getSlot = (date, i) => (state.plan[date] || [])[i] || "";

function setSlot(date, i, name) {
  const day = state.plan[date] || ["", "", ""];
  day[i] = name;
  if (day.some(Boolean)) state.plan[date] = day;
  else delete state.plan[date];
}

function addMeal(name) {
  name = name.trim();
  if (!name || state.meals.includes(name)) return false;
  state.meals.unshift(name);
  return true;
}

function commit() {
  save();
  render();
}

// ---------- 畫面 ----------

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function render() {
  renderList();
  renderCalendar();
  document.body.classList.toggle("picking", !!picked);
  $("pick-bar").hidden = !picked;
  if (picked) $("pick-text").textContent = `已選「${picked}」，點日曆格子放入`;
}

function renderList() {
  const list = $("meal-list");
  const options = $("meal-options");
  list.replaceChildren();
  options.replaceChildren();
  if (!state.meals.length) list.append(el("li", "hint", "清單是空的，先新增幾樣常吃的餐點吧。"));

  for (const name of state.meals) {
    options.append(Object.assign(el("option"), { value: name }));

    const li = el("li", "meal" + (picked === name ? " selected" : ""));
    li.draggable = true;
    li.append(el("span", "name", name));

    const custom = name in state.kcal;
    const input = el("input", "kcal-input" + (custom ? "" : " est"));
    input.type = "number";
    input.min = "0";
    input.inputMode = "numeric";
    input.placeholder = "?";
    input.title = custom ? "手動輸入的熱量（清空可恢復自動估算）" : "自動估算，可直接修改";
    const k = kcalOf(name);
    if (k != null) input.value = k;
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("change", () => {
      const v = parseFloat(input.value);
      if (Number.isFinite(v) && v >= 0) state.kcal[name] = Math.round(v);
      else delete state.kcal[name];
      commit();
    });
    li.append(input, el("span", "unit", "大卡"));

    const del = el("button", "icon-btn", "×");
    del.title = "從清單刪除";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      state.meals = state.meals.filter((m) => m !== name);
      if (picked === name) picked = null;
      commit();
    });
    li.append(del);

    li.addEventListener("click", () => {
      picked = picked === name ? null : name;
      render();
    });
    li.addEventListener("dragstart", (e) => {
      // 從熱量欄位開始拖曳時不啟動，讓使用者能選取數字
      if (e.target !== li) return;
      drag = { type: "meal", name };
      e.dataTransfer.setData("text/plain", name);
      e.dataTransfer.effectAllowed = "copy";
    });
    li.addEventListener("dragend", endDrag);
    list.append(li);
  }
}

function renderCalendar() {
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const days = [];
  let blanks = 0;
  if (mode === "week") {
    const start = cursor.getDate() - cursor.getDay();
    for (let i = 0; i < 7; i++) days.push(new Date(y, m, start + i));
    const end = days[6];
    $("month-label").textContent =
      `${days[0].getFullYear()} 年 ${days[0].getMonth() + 1}/${days[0].getDate()} – ${end.getMonth() + 1}/${end.getDate()}`;
  } else {
    blanks = new Date(y, m, 1).getDay();
    const count = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= count; d++) days.push(new Date(y, m, d));
    $("month-label").textContent = `${y} 年 ${m + 1} 月`;
  }
  document.body.dataset.mode = mode;
  document.querySelectorAll(".mode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));

  const cal = $("calendar");
  cal.replaceChildren();
  const todayKey = dateKey(new Date());
  for (let i = 0; i < blanks; i++) cal.append(el("div", "day blank"));

  let monthTotal = 0;
  let recordedDays = 0;
  let unknown = 0;

  for (const dt of days) {
    const date = dateKey(dt);
    const cell = el("div", "day" + (date === todayKey ? " today" : ""));
    cell.dataset.date = date;

    const head = el("div", "day-head");
    head.append(
      el("span", "day-num", mode === "week" ? `${dt.getMonth() + 1}/${dt.getDate()}` : dt.getDate()),
      el("span", "day-wd", `週${WEEKDAYS[dt.getDay()]}`),
    );
    const total = el("span", "day-kcal");
    const dice = el("button", "icon-btn dice", "🎲");
    dice.title = "從清單隨機填滿空的餐";
    dice.addEventListener("click", () => randomFill(date));
    head.append(total, dice);
    cell.append(head);

    let sum = 0;
    let hasMeal = false;
    for (let i = 0; i < 3; i++) {
      const name = getSlot(date, i);
      cell.append(renderSlot(date, i, name));
      if (!name) continue;
      hasMeal = true;
      const k = kcalOf(name);
      if (k == null) unknown++;
      else sum += k;
    }
    if (hasMeal) {
      total.textContent = `${sum} 大卡`;
      monthTotal += sum;
      recordedDays++;
    }
    cal.append(cell);
  }

  const span = mode === "week" ? "本週" : "本月";
  $("summary").textContent = recordedDays
    ? `${span}已記錄 ${recordedDays} 天，平均每天約 ${Math.round(monthTotal / recordedDays)} 大卡` +
      (unknown ? `（${unknown} 餐熱量未知，未計入）` : "")
    : `${span}還沒有紀錄`;
}

function renderSlot(date, i, name) {
  const slot = el("div", "slot" + (name ? " filled" : ""));
  slot.dataset.i = i;
  slot.append(el("span", "tag", SLOT_TAGS[i]), el("span", "name", name));

  if (name) {
    const k = kcalOf(name);
    slot.title = `${name}（${k == null ? "熱量未知" : `約 ${k} 大卡`}）`;
    slot.append(el("span", "kcal", k == null ? "?" : k));
    const del = el("button", "icon-btn", "×");
    del.title = "清除";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      setSlot(date, i, "");
      commit();
    });
    slot.append(del);

    slot.draggable = true;
    slot.addEventListener("dragstart", (e) => {
      drag = { type: "slot", date, i };
      e.dataTransfer.setData("text/plain", name);
      e.dataTransfer.effectAllowed = "move";
      document.body.classList.add("dragging-slot");
    });
    slot.addEventListener("dragend", endDrag);
  }

  slot.addEventListener("click", () => {
    if (picked) {
      setSlot(date, i, picked);
      commit();
    } else {
      editSlot(slot, date, i, name);
    }
  });
  slot.addEventListener("dragover", (e) => {
    if (!drag) return;
    e.preventDefault();
    slot.classList.add("over");
  });
  slot.addEventListener("dragleave", () => slot.classList.remove("over"));
  slot.addEventListener("drop", (e) => {
    e.preventDefault();
    if (!drag) return;
    if (drag.type === "meal") {
      setSlot(date, i, drag.name);
    } else if (drag.date !== date || drag.i !== i) {
      // 格子互拖：交換兩餐
      const moving = getSlot(drag.date, drag.i);
      setSlot(drag.date, drag.i, name);
      setSlot(date, i, moving);
    }
    drag = null;
    commit();
  });
  return slot;
}

// 直接在格子內輸入餐點名稱
function editSlot(slot, date, i, current) {
  if (slot.querySelector("input")) return;
  const input = el("input");
  input.value = current;
  input.setAttribute("list", "meal-options");
  input.placeholder = "輸入餐點";
  slot.draggable = false;
  slot.classList.add("editing");
  slot.replaceChildren(el("span", "tag", SLOT_TAGS[i]), input);
  input.focus();
  input.select();

  let done = false;
  const finish = (saveIt) => {
    if (done) return;
    done = true;
    if (saveIt) {
      const name = input.value.trim();
      if (name !== current) {
        setSlot(date, i, name);
        if (name) addMeal(name);
        save();
      }
    }
    render();
  };
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("keydown", (e) => {
    if (e.isComposing) return; // 注音 / 倉頡選字中的 Enter 不送出
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

function randomFill(date) {
  if (!state.meals.length) return toast("清單是空的，先新增餐點才能隨機挑選");
  const used = new Set([0, 1, 2].map((i) => getSlot(date, i)).filter(Boolean));
  if (used.size === 3) return toast("這天三餐都填好了，先清掉想重抽的那一餐");
  for (let i = 0; i < 3; i++) {
    if (getSlot(date, i)) continue;
    const fresh = state.meals.filter((m) => !used.has(m));
    const pool = fresh.length ? fresh : state.meals;
    const choice = pool[Math.floor(Math.random() * pool.length)];
    used.add(choice);
    setSlot(date, i, choice);
  }
  commit();
}

function endDrag() {
  drag = null;
  document.body.classList.remove("dragging-slot");
  document.querySelectorAll(".over").forEach((n) => n.classList.remove("over"));
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

// ---------- 事件 ----------

$("add-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("add-name");
  const name = input.value.trim();
  if (!name) return;
  if (!addMeal(name)) toast(`「${name}」已經在清單裡了`);
  else if (kcalOf(name) == null) toast(`估不出「${name}」的熱量，可在清單右側手動填寫`);
  input.value = "";
  $("add-hint").textContent = "拖曳餐點到日曆格子；手機可先點餐點、再點格子。";
  commit();
});

$("add-name").addEventListener("input", (e) => {
  const name = e.target.value.trim();
  const k = name ? estimate(name) : null;
  $("add-hint").textContent = !name
    ? "拖曳餐點到日曆格子；手機可先點餐點、再點格子。"
    : k == null ? "估不出熱量，新增後可手動填寫" : `估算約 ${k} 大卡`;
});

function shift(delta) {
  if (mode === "week") {
    cursor.setDate(cursor.getDate() + 7 * delta);
  } else {
    cursor.setDate(1);
    cursor.setMonth(cursor.getMonth() + delta);
  }
  renderCalendar();
}
$("prev").addEventListener("click", () => shift(-1));
$("next").addEventListener("click", () => shift(1));
$("today").addEventListener("click", () => {
  cursor = new Date();
  renderCalendar();
  scrollToToday();
});
document.querySelectorAll(".mode button").forEach((b) =>
  b.addEventListener("click", () => {
    mode = b.dataset.mode;
    try { localStorage.setItem("meal-view", mode); } catch (e) { /* 僅影響下次開啟的預設檢視 */ }
    renderCalendar();
  }));
// 手機上清單預設為精簡側欄，按「編輯」展開成完整面板
$("panel-toggle").addEventListener("click", () => {
  const open = document.body.classList.toggle("panel-open");
  $("panel-toggle").textContent = open ? "完成" : "編輯";
});
$("pick-cancel").addEventListener("click", () => {
  picked = null;
  render();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && picked) {
    picked = null;
    render();
  }
});

// 把格子拖到「移除區」或清單面板即可清除
const panel = $("panel");
panel.addEventListener("dragover", (e) => {
  if (drag?.type !== "slot") return;
  e.preventDefault();
  $("drop-remove").classList.add("over");
});
panel.addEventListener("dragleave", (e) => {
  if (!panel.contains(e.relatedTarget)) $("drop-remove").classList.remove("over");
});
panel.addEventListener("drop", (e) => {
  if (drag?.type !== "slot") return;
  e.preventDefault();
  setSlot(drag.date, drag.i, "");
  endDrag();
  commit();
});

$("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = "meal-backup.json";
  a.click();
  URL.revokeObjectURL(a.href);
});
$("import").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const s = JSON.parse(await file.text());
    if (!Array.isArray(s.meals) || typeof s.plan !== "object" || !s.plan) throw new Error("format");
    if (!confirm("匯入會取代目前所有紀錄，確定嗎？")) return;
    state = { meals: s.meals.map(String), kcal: s.kcal || {}, plan: s.plan };
    commit();
    toast("已匯入備份");
  } catch (err) {
    toast("檔案格式不正確，無法匯入");
  }
});

function scrollToToday() {
  if (MOBILE.matches && mode === "month") {
    document.querySelector(".day.today")?.scrollIntoView({ block: "center" });
  }
}

render();
