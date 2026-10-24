// Pagina /tools/crypto-technical-analysis/: alegi moneda, vezi statistica istorică (calculul e în ta-core.js).
import { COINS, NAMES, analyze, coinSlug, dayKey } from "./ta-core.js";

const root = document.querySelector('[data-tool="ta"]');
const $ = (sel, r = document) => r.querySelector(sel);
const $$ = (sel, r = document) => [...r.querySelectorAll(sel)];
const k = (name) => $(`[data-k="${name}"]`, root);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const setPressed = (btns, on) => btns.forEach((b) => b.setAttribute("aria-pressed", String(b === on)));

const name = (s) => NAMES[s] || s;
const D = 864e5;
const START = Date.UTC(2017, 0, 1);

const pct0 = (x) => `${Math.round(x * 100)}%`;
const sgn = (x, d = 1) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(d)}%`;
function price(p) {
  if (!isFinite(p)) return "—";
  const d = p >= 1000 ? 0 : p >= 1 ? 2 : p >= 0.01 ? 4 : 8;
  return `$${p.toLocaleString("en-US", { minimumFractionDigits: Math.min(d, 2), maximumFractionDigits: d })}`;
}
const fmtDay = (t) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const num = (n) => n.toLocaleString("en-US");

// ---------------------------------------------------------------------------
// Prețuri zilnice închise: Binance (2 adrese), apoi Coinbase dacă Binance e blocat
// ---------------------------------------------------------------------------
async function binance(host, sym) {
  const out = [];
  let start = START;
  for (let i = 0; i < 8; i++) {
    const r = await fetch(`${host}/api/v3/klines?symbol=${sym}USDT&interval=1d&limit=1000&startTime=${start}`);
    if (r.status === 400) throw Object.assign(new Error("unknown"), { unknown: true });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const kl = await r.json();
    kl.forEach((x) => out.push({ t: x[0], c: +x[4], end: x[6] }));
    if (kl.length < 1000) break;
    start = kl[kl.length - 1][0] + D;
  }
  const now = Date.now();
  return out.filter((x) => x.end < now).map(({ t, c }) => ({ t, c }));
}
async function coinbase(sym) {
  const today = Math.floor(Date.now() / D) * D;
  const out = new Map();
  let end = today;
  for (let i = 0; i < 12; i++) {
    const start = end - 300 * D;
    const r = await fetch(`https://api.exchange.coinbase.com/products/${sym}-USD/candles?granularity=86400&start=${new Date(start).toISOString()}&end=${new Date(end).toISOString()}`);
    if (r.status === 404) throw Object.assign(new Error("unknown"), { unknown: true });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const kl = await r.json();
    if (!kl.length) break;
    kl.forEach((x) => { const t = x[0] * 1000; if (t < today) out.set(t, +x[4]); });
    end = start;
  }
  return [...out].sort((a, b) => a[0] - b[0]).map(([t, c]) => ({ t, c }));
}
const lastClosedDay = () => Math.floor(Date.now() / D) * D - D;
async function daily(sym) {
  const key = `ta:${sym}:${dayKey(Date.now())}`;
  try { const hit = JSON.parse(sessionStorage.getItem(key) || "null"); if (hit) return hit; } catch {}
  let data, unknown = 0, src = "Binance";
  for (const f of [() => binance("https://data-api.binance.vision", sym), () => binance("https://api.binance.com", sym), () => coinbase(sym)]) {
    try { data = await f(); if (data.length) break; } catch (e) { if (e.unknown) unknown++; }
    src = "Coinbase";
  }
  if (!data || !data.length) throw Object.assign(new Error("no data"), { unknown: unknown >= 2 });
  const v = { src, candles: data };
  // în primele minute după 00:00 UTC bursa poate să nu aibă încă ziua de ieri; atunci nu păstrăm datele
  if (data[data.length - 1].t >= lastClosedDay()) try { sessionStorage.setItem(key, JSON.stringify(v)); } catch {}
  return v;
}

// ---------------------------------------------------------------------------
// Afișare
// ---------------------------------------------------------------------------
const LABEL = { up: "Leaning up", down: "Leaning down", side: "Sideways", none: "No clear direction", few: "Not enough history" };
const CLS = { up: "up", down: "down" };
const TREND = { up: ["Uptrend", "up"], down: ["Downtrend", "down"], mixed: ["Mixed", ""] };

function verdictText(a, coin, hl) {
  const p = pct0(a.p), base = pct0(a.base), lo = sgn(a.lo / a.price - 1), hi = sgn(a.hi / a.price - 1);
  if (a.verdict === "up") return `In ${num(a.cases)} past days with the same setup, ${coin} was higher ${hl} later ${p} of the time. On an ordinary day: ${base}.`;
  if (a.verdict === "down") return `In ${num(a.cases)} past days with the same setup, ${coin} was lower ${hl} later ${pct0(1 - a.p)} of the time. On an ordinary day: ${pct0(1 - a.base)}.`;
  if (a.verdict === "side") return `No clear lean: ${p} of similar days were higher ${hl} later (${base} on an ordinary day). The market is quieter than usual, so a move between ${lo} and ${hi} is the likely case.`;
  if (a.verdict === "none") return `No clear lean: ${p} of similar days were higher ${hl} later (${base} on an ordinary day), and the market is moving a lot. It could go either way, between ${lo} and ${hi}.`;
  return `Only ${a.indep} separate past cases look like today. That's fewer than the 20 needed to say anything.`;
}

function why(a, coin, hl) {
  const items = [];
  items.push([a.dist200 > 0 ? "up" : "down", `Price is <b>${sgn(a.dist200)}</b> ${a.dist200 > 0 ? "above" : "below"} its 200-day average, the line most traders use to tell a long uptrend from a downtrend.`]);
  items.push([a.gold ? "up" : "down", `The 50-day average is <b>${a.gold ? "above" : "below"}</b> the 200-day average${a.gold ? " (the zone after a “golden cross”)" : " (the zone after a “death cross”)"}.`]);
  items.push([a.mom30 > 0 ? "up" : "down", `${coin} is <b>${sgn(a.mom30)}</b> over the last 30 days. In crypto, a move over the past month has more often continued for a while than reversed.`]);
  items.push(["", a.volPct <= 50
    ? `Volatility is <b>low</b>: calmer than ${100 - a.volPct}% of the last year's days. Quiet periods tend to end with a bigger move, but not in a predictable direction.`
    : `Volatility is <b>high</b>: more volatile than ${a.volPct}% of the last year's days, so the likely range is wide.`]);
  items.push(["", `RSI(14) is <b>${Math.round(a.rsi)}</b>${a.rsi >= 70 ? ", above 70 (often called overbought)" : a.rsi <= 30 ? ", below 30 (often called oversold)" : ": neither overbought (70) nor oversold (30)"}. Shown for context only; it doesn't count towards the reading.`]);
  const setup = `price ${a.setup[0] === "A" ? "above" : "below"} the 200-day average and ${a.setup[1] === "+" ? "up" : "down"} over 30 days`;
  items.push(["", `Similar days: ${setup}. Found <b>${num(a.cases)}</b> since ${fmtDay(a.since)}, or ${a.indep} separate ${h}-day periods.`]);
  return items.map(([c, t]) => `<li${c ? ` class="${c}"` : ""}>${t}</li>`).join("");
}

function chart(a) {
  // lățimea reală a cutiei, ca textul să rămână lizibil și pe telefon
  const W = Math.max(320, Math.round(k("chart").clientWidth - 36) || 730), H = W < 520 ? 250 : 240;
  const padR = 78, padY = 12, axisH = 22, n = Math.min(365, a.closes.length), from = a.closes.length - n;
  const cs = a.closes.slice(from), m200 = a.sma200.slice(from), m50 = a.sma50.slice(from);
  const steps = 24, fan = [];
  for (let s = 0; s <= steps; s++) { const f = Math.sqrt(s / steps); fan.push([a.price * (a.lo / a.price) ** f, a.price * (a.hi / a.price) ** f]); }
  const vals = [...cs, ...m200.filter(isFinite), ...m50.filter(isFinite), a.lo, a.hi];
  const lo = Math.log(Math.min(...vals)), hi = Math.log(Math.max(...vals));
  const plotW = W - padR, fanW = Math.max(30, plotW * (a.h / (n + a.h)));
  const histW = plotW - fanW, plotH = H - axisH;
  const x = (i) => (i / (n - 1)) * histW;
  const y = (v) => padY + (1 - (Math.log(v) - lo) / (hi - lo)) * (plotH - 2 * padY);
  const line = (arr, cls) => `<polyline class="${cls}" points="${arr.map((v, i) => (isFinite(v) ? `${x(i).toFixed(1)},${y(v).toFixed(1)}` : "")).filter(Boolean).join(" ")}"/>`;
  const fx = (s) => histW + (s / steps) * fanW;
  const cone = `<polygon class="cone" points="${fan.map(([, h], s) => `${fx(s).toFixed(1)},${y(h).toFixed(1)}`).join(" ")} ${fan.slice().reverse().map(([l], s) => `${fx(steps - s).toFixed(1)},${y(l).toFixed(1)}`).join(" ")}"/>`;
  // etichetele de preț nu se suprapun
  let yh = y(a.hi) + 4, yl = y(a.lo) + 4;
  if (yl - yh < 14) { const m = (yh + yl) / 2; yh = m - 7; yl = m + 7; }
  const f = (t) => new Date(t).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
  const ax = plotH + 16;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(`${name(sym)} daily closes for the last ${n} days with the 200-day and 50-day averages, and the likely range for the next ${a.h} days: ${price(a.lo)} to ${price(a.hi)}`)}">
    ${cone}${line(m200, "ma200")}${line(m50, "ma50")}${line(cs, "px")}
    <line class="now" x1="${histW}" x2="${histW}" y1="${padY}" y2="${plotH}"/>
    <text x="${plotW + 6}" y="${yh.toFixed(1)}" class="hi">${esc(price(a.hi))}</text><text x="${plotW + 6}" y="${yl.toFixed(1)}" class="lo">${esc(price(a.lo))}</text>
    <text x="0" y="${ax}" class="ax">${f(a.times[from])}</text>
    <text x="${histW}" y="${ax}" class="ax" text-anchor="end">${fmtDay(a.at)}</text>
    <text x="${plotW}" y="${ax}" class="ax" text-anchor="end">+${a.h}d</text>
  </svg>`;
}

let sym = "BTC", h = 7, cur = null, req = 0;

function draw() {
  if (!cur) return;
  const a = analyze(cur.candles, h);
  const coin = name(sym), hl = h === 7 ? "7 days" : "30 days";
  k("v-coin").textContent = `${coin}, next ${hl}`;
  k("hl").textContent = hl;
  if (!a.ok) {
    k("v-label").textContent = LABEL.few;
    k("v-label").className = "";
    k("v-text").textContent = `${coin} has only ${a.days} days of price history. The reading needs about a year, because the 200-day average alone takes 200 days.`;
    ["p", "base", "range", "trend"].forEach((x) => (k(x).textContent = "—"));
    ["p-note", "range-note", "trend-note"].forEach((x) => (k(x).textContent = ""));
    k("chart").innerHTML = "";
    k("why").innerHTML = "";
    return;
  }
  k("v-label").textContent = LABEL[a.verdict];
  k("v-label").className = CLS[a.verdict] || "";
  k("v-text").textContent = verdictText(a, coin, hl);
  k("p").textContent = pct0(a.p);
  k("p-note").textContent = `of ${num(a.cases)} similar days (${a.indep} separate periods)`;
  k("base").textContent = pct0(a.base);
  k("range").innerHTML = `<span class="down">${sgn(a.lo / a.price - 1)}</span> <span class="up">${sgn(a.hi / a.price - 1)}</span>`;
  k("range-note").textContent = `${price(a.lo)} to ${price(a.hi)}, 8 in 10 past moves`;
  const [tl, tc] = TREND[a.trend];
  k("trend").textContent = tl;
  k("trend").className = tc;
  k("trend-note").textContent = `${a.dist200 > 0 ? "above" : "below"} 200-day avg, ${a.mom30 > 0 ? "up" : "down"} ${sgn(Math.abs(a.mom30), 0).replace("+", "")} in 30 days`;
    k("chart").innerHTML = chart(a);
  k("why").innerHTML = why(a, coin, hl);
  k("updated").innerHTML = `${esc(`Based on ${num(a.days)} daily closes from ${cur.src}, the last one on ${fmtDay(a.at)} at ${price(a.price)}.`)} <span data-k="next"></span>`;
  tick();
  record();
}

async function load(s) {
  sym = s;
  const my = ++req;
  const msg = $("[data-msg]", root);
  msg.hidden = true;
  k("v-coin").textContent = `${name(s)}, next ${h} days`;
  k("v-label").textContent = "Loading…";
  k("v-label").className = "";
  k("v-text").textContent = `Loading ${name(s)}'s full price history…`;
  try {
    const d = await daily(s);
    if (my !== req) return;
    cur = d;
    draw();
  } catch (e) {
    if (my !== req) return;
    cur = null;
    k("v-label").textContent = "—";
    k("v-text").textContent = "";
    msg.hidden = false;
    msg.textContent = e.unknown ? `${s} doesn't trade against USDT on Binance, so there's no history to analyze.` : "Couldn't load the price history from Binance or Coinbase. Try again in a minute.";
  }
  const u = new URL(location.href);
  if (s === root.dataset.coin || (!root.dataset.coin && s === "BTC")) u.searchParams.delete("coin"); else u.searchParams.set("coin", s);
  if (h === 7) u.searchParams.delete("days"); else u.searchParams.set("days", h);
  history.replaceState(null, "", u);
}

// Numărătoarea până la citirea următoare; la 00:00 UTC pagina se actualizează singură
let retryAt = 0;
function tick() {
  const el = k("next");
  if (!cur || !el) return;
  const now = Date.now(), next = Math.floor(now / D) * D + D;
  const last = cur.candles[cur.candles.length - 1].t;
  if (last < lastClosedDay() - D) { el.textContent = ""; return; } // monedă care nu se mai tranzacționează
  if (last < lastClosedDay()) {
    el.textContent = "A new day has closed, updating the reading…";
    if (now >= retryAt) { retryAt = now + 120000; logP = null; load(sym); }
    return;
  }
  const m = Math.ceil((next - now) / 60000);
  el.textContent = `Next reading in ${m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`}, after the daily close at 00:00 UTC. The page updates by itself.`;
}
setInterval(tick, 30000);

// ---------------------------------------------------------------------------
// Jurnalul public (scris zilnic de .github/snapshot.mjs în /data/ta-log.json)
// ---------------------------------------------------------------------------
let logP;
const HIT = { up: "Price higher at the end", down: "Price lower at the end", side: "Price ended inside the likely range" };
async function record() {
  logP ||= fetch("/data/ta-log.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const log = await logP;
  const rows = log ? log.e.filter((x) => x[2] === h) : [];
  const done = rows.filter((x) => x[7] != null);
  const hl = h === 7 ? "7-day" : "30-day";
  const row = (label, cls, list, test, what) => {
    const hits = list.filter(test).length;
    return `<tr><th scope="row"><span class="${cls}">${label}</span></th><td class="r num">${num(list.length)}</td><td class="r num">${num(hits)}</td><td class="r num">${list.length ? pct0(hits / list.length) : "—"}</td><td>${what}</td></tr>`;
  };
  const by = (v) => done.filter((x) => x[3] === v);
  k("record").innerHTML = [
    row(LABEL.up, "up", by("up"), (x) => x[7] > x[4], HIT.up),
    row(LABEL.down, "down", by("down"), (x) => x[7] < x[4], HIT.down),
    row(LABEL.side, "", by("side"), (x) => x[7] >= x[5] && x[7] <= x[6], HIT.side),
    row("Benchmark: always guess up", "muted", done, (x) => x[7] > x[4], "Every call checked, counted as if it had said up"),
  ].join("");
  if (!log) { k("record-note").textContent = "The log couldn't be loaded."; return; }
  const first = log.start ? Date.parse(log.start) : Date.now();
  k("record-note").textContent = done.length
    ? `${num(rows.length)} ${hl} calls since ${fmtDay(first)}, ${num(done.length)} of them old enough to check. “No clear direction” calls aren't scored, because they don't claim anything. A reading only beats guessing if its hit rate stays above the benchmark over many months.`
    : `The log started on ${fmtDay(first)}. The first ${hl} calls can be checked on ${fmtDay(first + h * D)}. Until then there's nothing to score, and we won't make up a number.`;
}

// ---------------------------------------------------------------------------
// Pornire
// ---------------------------------------------------------------------------
if (root) {
  const q = new URLSearchParams(location.search);
  const qc = (q.get("coin") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (q.get("days") === "30") h = 30;
  setPressed($$("[data-h]", root), $(`[data-h="${h}"]`, root));
  const mark = (c) => $$("[data-pick]", root).forEach((a) => (a.dataset.pick === c ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  const choose = (c) => { mark(c); k("sym").value = COINS.includes(c) ? "" : c; load(c); };
  root.addEventListener("click", (e) => {
    // monedele sunt linkuri spre pagina lor; păstrăm alegerea de 30 de zile
    const a = e.target.closest("a[data-pick]");
    if (a && h === 30 && !e.metaKey && !e.ctrlKey) { e.preventDefault(); location.href = `${a.getAttribute("href")}?days=30`; }
    const b = e.target.closest("[data-h]");
    if (b) { h = +b.dataset.h; setPressed($$("[data-h]", root), b); load(sym); }
  });
  let rt, lastW = innerWidth;
  addEventListener("resize", () => { if (innerWidth === lastW) return; lastW = innerWidth; clearTimeout(rt); rt = setTimeout(draw, 200); });
  k("sym").addEventListener("change", (e) => {
    const v = e.target.value.trim().toUpperCase().replace(/USDT$/, "").replace(/[^A-Z0-9]/g, "");
    if (!v) return;
    if (COINS.includes(v)) location.href = `/tools/crypto-technical-analysis/${coinSlug(v)}/${h === 30 ? "?days=30" : ""}`;
    else if (root.dataset.coin) location.href = `/tools/crypto-technical-analysis/?coin=${v}${h === 30 ? "&days=30" : ""}`;
    else choose(v);
  });
  choose(root.dataset.coin || qc || "BTC");
}
