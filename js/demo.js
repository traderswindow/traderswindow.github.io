// Traders Window — site: the live demo on the home page.
// A replica of the widget (not the app's code) with real Binance prices,
// draggable over a full-screen chart, plus the "read the widget" highlighter.

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------------- menu bar clock ---------------- */
const clock = document.querySelector(".clock");
if (clock) {
  const tick = () => { clock.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
  tick();
  setInterval(tick, 15_000);
}

/* ---------------- background chart ---------------- */
const desk = document.querySelector(".desk");
const chart = desk?.querySelector("canvas.chart");
let candles = [];
let lastPrice = 83_400;

function seedCandles(n) {
  let p = lastPrice * 0.985;
  candles = [];
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = o * (1 + (Math.random() - 0.47) * 0.004);
    const h = Math.max(o, c) * (1 + Math.random() * 0.0016);
    const l = Math.min(o, c) * (1 - Math.random() * 0.0016);
    candles.push({ o, h, l, c });
    p = c;
  }
}

function drawChart() {
  if (!chart) return;
  const dpr = devicePixelRatio || 1;
  const w = chart.clientWidth, h = chart.clientHeight;
  if (chart.width !== Math.round(w * dpr)) { chart.width = Math.round(w * dpr); chart.height = Math.round(h * dpr); }
  const ctx = chart.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // grid
  ctx.strokeStyle = "rgba(255,255,255,0.045)";
  ctx.lineWidth = 1;
  for (let y = 80; y < h; y += 72) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke(); }
  for (let x = 0; x < w; x += 120) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke(); }

  const step = 11;
  const n = Math.min(candles.length, Math.floor(w / step) + 1);
  const view = candles.slice(-n);
  const hi = Math.max(...view.map((c) => c.h)), lo = Math.min(...view.map((c) => c.l));
  const top = h * 0.14, bottom = h * 0.9;
  const y = (v) => bottom - ((v - lo) / (hi - lo || 1)) * (bottom - top);

  view.forEach((c, i) => {
    const x = w - (n - i) * step + step / 2;
    const up = c.c >= c.o;
    ctx.strokeStyle = ctx.fillStyle = up ? "rgba(0,255,156,0.55)" : "rgba(255,59,107,0.55)";
    ctx.beginPath(); ctx.moveTo(x + 0.5, y(c.h)); ctx.lineTo(x + 0.5, y(c.l)); ctx.stroke();
    const y1 = y(Math.max(c.o, c.c)), y2 = y(Math.min(c.o, c.c));
    ctx.fillRect(x - 3, y1, 7, Math.max(1, y2 - y1));
  });

  // last price line
  const last = view[view.length - 1];
  if (last) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(0,240,255,0.35)";
    ctx.beginPath(); ctx.moveTo(0, y(last.c) + 0.5); ctx.lineTo(w, y(last.c) + 0.5); ctx.stroke();
    ctx.setLineDash([]);
  }
}

function pushPriceToChart(p) {
  const last = candles[candles.length - 1];
  if (!last) return;
  // rescale the synthetic history once, so the chart ends at the real price
  if (Math.abs(last.c / p - 1) > 0.02) {
    const k = p / last.c;
    candles = candles.map((c) => ({ o: c.o * k, h: c.h * k, l: c.l * k, c: c.c * k }));
    return;
  }
  last.c = p;
  last.h = Math.max(last.h, p);
  last.l = Math.min(last.l, p);
}

if (chart) {
  seedCandles(260);
  drawChart();
  addEventListener("resize", drawChart);
  if (!reduce) {
    setInterval(() => {
      const last = candles[candles.length - 1];
      candles.push({ o: last.c, h: last.c, l: last.c, c: last.c });
      if (candles.length > 400) candles.shift();
    }, 6000);
    setInterval(drawChart, 1000);
  }
}

/* ---------------- the widget ---------------- */
const demo = document.querySelector(".demo");
if (demo) {
  const $ = (s) => demo.querySelector(s);
  const priceEl = $(".price"), chgEl = $(".chg"), dot = $(".dot"), src = $(".src"), stats = $(".stats"), spark = $("canvas");
  const pts = [];
  let price = null, prevSample = null, live = false, funding = null, nextFunding = null;

  const fmt = (p) => "$" + p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (x) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}%`;
  const until = (ms) => { const m = Math.max(0, Math.floor(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m}m`; };

  function setPrice(p, change) {
    if (price != null && p !== price) {
      priceEl.classList.remove("tick-up", "tick-down");
      void priceEl.offsetWidth;
      priceEl.classList.add(p > price ? "tick-up" : "tick-down");
      setTimeout(() => priceEl.classList.remove("tick-up", "tick-down"), 450);
    }
    price = p;
    priceEl.textContent = fmt(p);
    if (change != null) {
      chgEl.textContent = `${change > 0 ? "▲" : change < 0 ? "▼" : ""} ${pct(change)}`;
      chgEl.className = "chg " + (change > 0 ? "up" : change < 0 ? "down" : "");
    }
    pushPriceToChart(p);
  }

  function drawSpark() {
    const w = spark.clientWidth, h = spark.clientHeight, dpr = devicePixelRatio || 1;
    spark.width = w * dpr; spark.height = h * dpr;
    const ctx = spark.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (pts.length < 2) return;
    const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
    const x = (i) => ((20 - pts.length + i) / 19) * (w - 6) + 3;
    const y = (p) => 3 + (1 - (p - min) / span) * (h - 6);
    const color = pts[pts.length - 1] >= pts[0] ? "#00ff9c" : "#ff3b6b";
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p)) : ctx.moveTo(x(i), y(p))));
    ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.shadowColor = color; ctx.shadowBlur = 4; ctx.stroke();
  }

  function renderStats() {
    const parts = [];
    if (funding != null) parts.push(`F <b>${funding >= 0 ? "+" : "−"}${Math.abs(funding * 100).toFixed(4)}%</b>${nextFunding ? " " + until(nextFunding - Date.now()) : ""}`);
    parts.push(live ? "live from Binance" : "demo data");
    stats.innerHTML = parts.join(" · ");
  }

  // one point every 2 s, and the whole-window flash on a > 0.2% move
  setInterval(() => {
    if (price == null) return;
    if (prevSample != null) {
      const move = (price - prevSample) / prevSample * 100;
      if (Math.abs(move) > 0.2) {
        desk.classList.remove("flash-up", "flash-down");
        void desk.offsetWidth;
        desk.classList.add(move > 0 ? "flash-up" : "flash-down");
      }
    }
    prevSample = price;
    pts.push(price);
    if (pts.length > 20) pts.shift();
    drawSpark();
    renderStats();
  }, 2000);

  // live data: Binance's public market-data stream (no key, no account)
  function connectSpot() {
    let ws;
    try { ws = new WebSocket("wss://data-stream.binance.vision/stream?streams=btcusdt@miniTicker"); } catch { return simulate(); }
    const giveUp = setTimeout(() => { if (!live) { ws.close(); simulate(); } }, 6000);
    ws.onmessage = (e) => {
      const d = JSON.parse(e.data).data;
      const c = +d.c, o = +d.o;
      if (!live) { live = true; clearTimeout(giveUp); dot.classList.add("live"); src.textContent = "LIVE"; }
      setPrice(c, (c - o) / o * 100);
    };
    ws.onclose = () => { if (live) { live = false; dot.classList.remove("live"); setTimeout(connectSpot, 4000); } };
  }
  function connectFunding() {
    try {
      const ws = new WebSocket("wss://fstream.binance.com/market/stream?streams=btcusdt@markPrice@1s");
      ws.onmessage = (e) => { const d = JSON.parse(e.data).data; funding = +d.r; nextFunding = d.T; };
    } catch { /* funding is optional */ }
  }
  let simulating = false;
  function simulate() {
    if (simulating) return;
    simulating = true;
    src.textContent = "DEMO";
    let p = 83_400, open = 84_200;
    setPrice(p, (p - open) / open * 100);
    setInterval(() => { p *= 1 + (Math.random() - 0.5) * 0.0008; setPrice(p, (p - open) / open * 100); }, 1100);
  }
  connectSpot();
  connectFunding();
  renderStats();

  // drag it anywhere inside the desktop, like the real one
  let drag = null;
  demo.addEventListener("pointerdown", (e) => {
    const r = demo.getBoundingClientRect(), d = desk.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, d };
    demo.setPointerCapture(e.pointerId);
  });
  demo.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const { d } = drag;
    const x = Math.min(Math.max(e.clientX - d.left - drag.dx, 8), d.width - demo.offsetWidth - 8);
    const y = Math.min(Math.max(e.clientY - d.top - drag.dy, 8), d.height - demo.offsetHeight - 8);
    place(x, y);
  });
  demo.addEventListener("pointerup", () => { drag = null; });
  function place(x, y) {
    demo.classList.add("moved");
    demo.style.left = x + "px";
    demo.style.top = y + "px";
    demo.style.right = "auto";
  }
  // keyboard: arrow keys move it too
  demo.addEventListener("keydown", (e) => {
    const k = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[e.key];
    if (!k) return;
    e.preventDefault();
    const d = desk.getBoundingClientRect(), r = demo.getBoundingClientRect();
    place(Math.min(Math.max(r.left - d.left + k[0], 8), d.width - r.width - 8), Math.min(Math.max(r.top - d.top + k[1], 8), d.height - r.height - 8));
  });
}

/* ---------------- read the widget ---------------- */
const specimen = document.querySelector(".specimen");
if (specimen) {
  const hl = specimen.querySelector(".hl");
  const box = JSON.parse(specimen.dataset.boxes);
  const show = (key) => {
    const b = box[key];
    if (!b) return;
    const pad = 3;
    hl.style.left = `${((b[0] - pad) / box.W) * 100}%`;
    hl.style.top = `${((b[1] - pad) / box.H) * 100}%`;
    hl.style.width = `${((b[2] + pad * 2) / box.W) * 100}%`;
    hl.style.height = `${((b[3] + pad * 2) / box.H) * 100}%`;
    hl.classList.add("on");
  };
  for (const btn of document.querySelectorAll(".legend button")) {
    const on = () => {
      document.querySelectorAll(".legend button.on").forEach((b) => b.classList.remove("on"));
      btn.classList.add("on");
      show(btn.dataset.key);
    };
    btn.addEventListener("mouseenter", on);
    btn.addEventListener("focus", on);
    btn.addEventListener("click", on);
  }
  document.querySelector(".legend").addEventListener("mouseleave", () => hl.classList.remove("on"));
}
