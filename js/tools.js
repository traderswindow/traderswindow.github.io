// Uneltele de pe /tools/. Datele vin direct de la API-ul public Binance Futures (fără server).
(() => {
  "use strict";
  const API = "https://fapi.binance.com";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const k = (root, name) => $(`[data-k="${name}"]`, root);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  async function get(path) {
    const r = await fetch(API + path);
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return r.json();
  }

  function showError(root, err) {
    const el = $("[data-msg]", root);
    if (!el) return;
    el.hidden = false;
    el.textContent = err && (err.status === 451 || err.status === 403)
      ? "Binance doesn't serve its futures data to your location (it blocks some countries, including the US), so the live numbers can't load here."
      : "Couldn't reach Binance right now. Retrying in a moment…";
  }
  function clearError(root) {
    const el = $("[data-msg]", root);
    if (el) el.hidden = true;
  }

  let perpsPromise;
  const perps = () => (perpsPromise ||= fetch("/data/perps.json").then((r) => r.json()).catch(() => null));

  const pct = (x, d = 4) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(d)}%`;
  const cls = (x) => (x > 0 ? "up" : x < 0 ? "down" : "");
  function price(p) {
    if (!isFinite(p)) return "—";
    const d = p >= 1000 ? 2 : p >= 1 ? 4 : p >= 0.01 ? 5 : 8;
    return p.toLocaleString("en-US", { minimumFractionDigits: Math.min(d, 2), maximumFractionDigits: d });
  }
  function money(v) {
    if (!isFinite(v)) return "—";
    if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
    return `$${v.toFixed(0)}`;
  }
  const usd = (v) => `$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  function dur(ms) {
    if (ms <= 0) return "now";
    const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d >= 1) return `${d}d ${h % 24}h`;
    if (h >= 1) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
    const s = Math.floor(ms / 1000) % 60;
    return `${m}m ${String(s).padStart(2, "0")}s`;
  }
  const hhmm = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const base = (sym) => sym.replace(/USDT$/, "");
  const setPressed = (btns, on) => btns.forEach((b) => b.setAttribute("aria-pressed", String(b === on)));

  // ---------------------------------------------------------------------------
  // Funding rates
  // ---------------------------------------------------------------------------
  function funding(root) {
    let rows = [];
    let sort = { key: "vol", dir: -1 };
    let filter = "all";
    let side = 1; // 1 = long, -1 = short
    let calcTouched = false;

    async function load() {
      try {
        const [list, prem, info, tick] = await Promise.all([
          perps(),
          get("/fapi/v1/premiumIndex"),
          get("/fapi/v1/fundingInfo").catch(() => []),
          get("/fapi/v1/ticker/24hr"),
        ]);
        const allowed = list ? new Set(list) : null;
        const iv = new Map(info.map((x) => [x.symbol, x.fundingIntervalHours]));
        const vol = new Map(tick.map((x) => [x.symbol, +x.quoteVolume]));
        rows = prem
          .filter((x) => (allowed ? allowed.has(x.symbol) : /USDT$/.test(x.symbol) && !x.symbol.includes("_")))
          .filter((x) => x.lastFundingRate !== "")
          .map((x) => {
            const rate = +x.lastFundingRate * 100;
            const h = iv.get(x.symbol) || 8;
            return { sym: base(x.symbol), rate, iv: h, ann: rate * (24 / h) * 365, next: +x.nextFundingTime, mark: +x.markPrice, vol: vol.get(x.symbol) || 0 };
          });
        clearError(root);
        render();
        k(root, "updated").textContent = `Updated ${hhmm(new Date())} · refreshes every 30 s`;
        const dl = $("#fr-syms");
        if (dl && !dl.options.length) dl.innerHTML = rows.map((r) => `<option value="${esc(r.sym)}">`).join("");
        if (!calcTouched) fillCalcFromCoin();
        calc();
      } catch (e) {
        showError(root, e);
        if (!rows.length) k(root, "rows").innerHTML = `<tr><td colspan="7" class="muted">No data.</td></tr>`;
      }
    }

    function render() {
      const by = (s) => rows.find((r) => r.sym === s);
      for (const s of ["btc", "eth"]) {
        const r = by(s.toUpperCase());
        if (!r) continue;
        const b = k(root, s);
        b.textContent = pct(r.rate);
        b.className = `num ${cls(r.rate)}`;
        k(root, `${s}-ann`).textContent = `${pct(r.ann, 1)} a year`;
      }
      const pos = rows.filter((r) => r.rate > 0).length, neg = rows.filter((r) => r.rate < 0).length;
      k(root, "split").textContent = `${pos} / ${neg}`;

      const liquid = rows.filter((r) => r.vol >= 2e7);
      const li = (r) => `<li><a href="#" data-coin="${esc(r.sym)}">${esc(r.sym)}</a><span class="${cls(r.rate)}">${pct(r.rate)}</span><small>${r.iv}h · ${pct(r.ann, 0)}/yr</small></li>`;
      k(root, "top").innerHTML = [...liquid].sort((a, b) => b.ann - a.ann).slice(0, 5).map(li).join("");
      k(root, "bottom").innerHTML = [...liquid].sort((a, b) => a.ann - b.ann).slice(0, 5).map(li).join("");

      const q = k(root, "q").value.trim().toUpperCase().replace(/USDT$/, "");
      let view = rows.filter((r) => (filter === "pos" ? r.rate > 0 : filter === "neg" ? r.rate < 0 : true));
      if (q) view = view.filter((r) => r.sym.includes(q));
      const { key, dir } = sort;
      view.sort((a, b) => (key === "sym" ? a.sym.localeCompare(b.sym) * dir : ((a[key] - b[key]) || 0) * dir));
      const now = Date.now();
      k(root, "rows").innerHTML = view.length
        ? view.map((r) => `<tr>
            <th scope="row">${esc(r.sym)}</th>
            <td class="r num ${cls(r.rate)}">${pct(r.rate)}</td>
            <td class="r num ${cls(r.ann)}">${pct(r.ann, 1)}</td>
            <td class="r num">${r.iv}h</td>
            <td class="r num" data-next="${r.next}">${dur(r.next - now)}</td>
            <td class="r num">${price(r.mark)}</td>
            <td class="r num">${money(r.vol)}</td>
          </tr>`).join("")
        : `<tr><td colspan="7" class="muted">No coin matches “${esc(q)}”.</td></tr>`;
      k(root, "count").textContent = `${view.length} of ${rows.length} Binance USDT perpetuals`;
      $$("[data-sort]", root).forEach((b) => b.setAttribute("aria-sort", b.dataset.sort === key ? (dir > 0 ? "ascending" : "descending") : "none"));
    }

    function tick() {
      const now = Date.now();
      $$("[data-next]", root).forEach((td) => { td.textContent = dur(+td.dataset.next - now); });
      // următoarea plată pentru monedele la 8 ore: 00, 08, 16 UTC
      const d = new Date(now);
      const nextH = (Math.floor(d.getUTCHours() / 8) + 1) * 8;
      const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), nextH);
      k(root, "next").textContent = dur(t - now);
    }

    // calculator
    const form = k(root, "calc");
    const c = (n) => $(`[data-c="${n}"]`, form);
    function fillCalcFromCoin() {
      const s = c("sym").value.trim().toUpperCase().replace(/USDT$/, "");
      const r = rows.find((x) => x.sym === s);
      if (!r) return;
      c("rate").value = r.rate.toFixed(4);
      c("iv").value = String(r.iv);
    }
    function calc() {
      const size = +c("size").value, rate = +c("rate").value / 100, iv = +c("iv").value, days = +c("days").value;
      const out = k(root, "out");
      if (!(size > 0) || !isFinite(rate) || c("rate").value === "") {
        out.innerHTML = `<p class="muted">Enter a position size and a funding rate.</p>`;
        return;
      }
      const per = size * rate * side; // >0 = plătești
      const perDay = per * (24 / iv);
      const total = perDay * (days > 0 ? days : 0);
      const pays = per > 0, zero = per === 0;
      const word = zero ? "Nothing to pay" : pays ? "You pay" : "You receive";
      const c2 = zero ? "" : pays ? "down" : "up";
      out.innerHTML = `
        <div><span>${word} each payment</span><b class="num ${c2}">${usd(per)}</b></div>
        <div><span>Per day (${24 / iv} payments)</span><b class="num ${c2}">${usd(perDay)}</b></div>
        <div><span>Over ${days > 0 ? days : 0} days</span><b class="num ${c2}">${usd(total)}</b></div>
        <div><span>As a yearly rate</span><b class="num ${c2}">${(Math.abs(rate) * (24 / iv) * 365 * 100).toFixed(1)}%</b></div>`;
    }
    form.addEventListener("input", (e) => {
      if (e.target === c("sym")) { calcTouched = false; fillCalcFromCoin(); }
      else if (e.target === c("rate") || e.target === c("iv")) calcTouched = true;
      calc();
    });
    $$("[data-c=long],[data-c=short]", form).forEach((b) => b.addEventListener("click", () => {
      side = b.dataset.c === "long" ? 1 : -1;
      setPressed($$("[data-c=long],[data-c=short]", form), b);
      calc();
    }));

    root.addEventListener("click", (e) => {
      const coin = e.target.closest("[data-coin]");
      if (coin) {
        e.preventDefault();
        c("sym").value = coin.dataset.coin;
        calcTouched = false;
        fillCalcFromCoin();
        calc();
        $("#calc-h").scrollIntoView({ behavior: "smooth", block: "start" });
      }
      const s = e.target.closest("[data-sort]");
      if (s) {
        const key = s.dataset.sort;
        sort = sort.key === key ? { key, dir: -sort.dir } : { key, dir: key === "sym" ? 1 : -1 };
        render();
      }
      const f = e.target.closest("[data-filter]");
      if (f) {
        filter = f.dataset.filter;
        setPressed($$("[data-filter]", root), f);
        render();
      }
    });
    k(root, "q").addEventListener("input", render);

    calc();
    load();
    tick();
    setInterval(load, 30000);
    setInterval(tick, 1000);
  }

  // ---------------------------------------------------------------------------
  // Market hours
  // ---------------------------------------------------------------------------
  const SESSIONS = [
    { id: "tokyo", name: "Tokyo", tz: "Asia/Tokyo", open: 540, close: 900, note: "Asia's main session" },
    { id: "london", name: "London", tz: "Europe/London", open: 480, close: 990, note: "Europe's main session" },
    { id: "ny", name: "New York", tz: "America/New_York", open: 570, close: 960, note: "US stock market" },
    { id: "cme", name: "CME Bitcoin futures", tz: "America/Chicago", cme: true, note: "Weekend closure creates the CME gap" },
  ];
  const DAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const fmts = new Map();
  function at(tz, date) {
    let f = fmts.get(tz);
    if (!f) fmts.set(tz, (f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })));
    const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
    return { day: DAYS[p.weekday], min: +p.hour * 60 + +p.minute };
  }
  function isOpen(s, date) {
    const { day, min } = at(s.tz, date);
    if (s.cme) {
      // duminică 17:00 – vineri 16:00 CT, pauză zilnică 16:00–17:00
      if (day === 6) return false;
      if (day === 0) return min >= 1020;
      if (day === 5) return min < 960;
      return min < 960 || min >= 1020;
    }
    return day >= 1 && day <= 5 && min >= s.open && min < s.close;
  }
  const Q = 15 * 60000;
  function nextChange(s, now) {
    const open = isOpen(s, new Date(now));
    let t = Math.ceil((now + 1) / Q) * Q; // toate granițele cad pe sferturi de oră
    for (let i = 0; i < 8 * 96; i++, t += Q) if (isOpen(s, new Date(t)) !== open) return t;
    return null;
  }

  function hours(root) {
    let utc = false;
    const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(utc ? { timeZone: "UTC" } : {}) });
    const fmtDay = (ms) => new Date(ms).toLocaleDateString([], { weekday: "short", ...(utc ? { timeZone: "UTC" } : {}) });
    let cache = { at: 0, next: {} };

    function dayStart(now) {
      const d = new Date(now);
      return utc ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    }

    function timeline(now) {
      const start = dayStart(now);
      const end = utc ? start + 864e5 : new Date(new Date(start).getFullYear(), new Date(start).getMonth(), new Date(start).getDate() + 1).getTime();
      const span = end - start;
      cache.start = start; cache.span = span;
      const pos = (t) => ((t - start) / span) * 100;
      const rows = SESSIONS.map((s) => {
        const segs = [];
        let segStart = null;
        for (let t = start; t <= end; t += Q) {
          const o = t < end && isOpen(s, new Date(t));
          if (o && segStart === null) segStart = t;
          if (!o && segStart !== null) { segs.push([segStart, t]); segStart = null; }
        }
        const bars = segs.map(([a, b]) => `<span class="bar ${s.id}" style="left:${pos(a)}%;width:${pos(b) - pos(a)}%" title="${esc(s.name)} ${fmtTime(a)}–${fmtTime(b)}"></span>`).join("");
        return `<div class="tl-row"><span class="tl-name">${esc(s.name)}</span><div class="tl-track">${bars || `<span class="tl-closed">Closed today</span>`}</div></div>`;
      }).join("");
      const ticks = [0, 3, 6, 9, 12, 15, 18, 21].map((h) => `<span style="left:${pos(start + h * 36e5)}%">${String(h).padStart(2, "0")}</span>`).join("");
      k(root, "timeline").innerHTML = `${rows}<div class="tl-row tl-axis"><span class="tl-name"></span><div class="tl-track">${ticks}<i class="tl-now" style="left:${pos(now)}%"></i></div></div>`;
    }

    function draw() {
      const now = Date.now();
      if (now - cache.at > 60000 || cache.utc !== utc) {
        cache = { at: now, utc, next: Object.fromEntries(SESSIONS.map((s) => [s.id, nextChange(s, now)])) };
        timeline(now);
      } else {
        const tl = $(".tl-now", root);
        if (tl) tl.style.left = `${((now - cache.start) / cache.span) * 100}%`;
      }
      const open = SESSIONS.filter((s) => isOpen(s, new Date(now)));
      const main = open.filter((s) => !s.cme);
      k(root, "status").innerHTML = main.length
        ? `Open now: <b>${main.map((s) => esc(s.name)).join(" + ")}</b>`
        : `No major stock market is open right now. <b>Crypto is still trading.</b>`;
      k(root, "clock").textContent = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", ...(utc ? { timeZone: "UTC" } : {}) });
      k(root, "zone").textContent = utc ? "UTC" : `your time (${Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " ")})`;
      k(root, "cards").innerHTML = SESSIONS.map((s) => {
        const o = isOpen(s, new Date(now));
        const n = cache.next[s.id];
        const when = n ? `${o ? "Closes" : "Opens"} in <b class="num">${dur(n - now)}</b> <span class="muted">(${fmtDay(n)} ${fmtTime(n)})</span>` : "";
        return `<div class="sess ${o ? "open" : ""}"><p class="sess-h"><i class="dot ${s.id}"></i>${esc(s.name)} <span class="pill">${o ? "Open" : "Closed"}</span></p><p>${when}</p><p class="muted">${esc(s.note)}</p></div>`;
      }).join("");
    }

    $$("[data-tz]", root).forEach((b) => b.addEventListener("click", () => {
      utc = b.dataset.tz === "utc";
      setPressed($$("[data-tz]", root), b);
      draw();
    }));
    draw();
    setInterval(draw, 1000);
  }

  // ---------------------------------------------------------------------------
  // Long/short ratio
  // ---------------------------------------------------------------------------
  const MAJORS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB", "ADA", "SUI"];

  function spark(values, mid, label) {
    if (values.length < 2) return "";
    const w = 300, h = 64, pad = 4;
    let lo = Math.min(...values, mid), hi = Math.max(...values, mid);
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const x = (i) => pad + (i / (values.length - 1)) * (w - 2 * pad);
    const y = (v) => pad + (1 - (v - lo) / (hi - lo)) * (h - 2 * pad);
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const last = values[values.length - 1];
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">
      <line x1="0" x2="${w}" y1="${y(mid)}" y2="${y(mid)}" class="mid"/>
      <polyline points="${pts}" class="${last >= mid ? "up" : "down"}"/>
    </svg>`;
  }

  function ls(root) {
    let sym = "BTC";
    let period = "1h";
    let timer;

    async function loadCoin() {
      const s = `${sym}USDT`;
      const q = `?symbol=${s}&period=${period}&limit=48`;
      try {
        const [g, top, tk] = await Promise.all([
          get(`/futures/data/globalLongShortAccountRatio${q}`),
          get(`/futures/data/topLongShortPositionRatio${q}`),
          get(`/futures/data/takerlongshortRatio${q}`),
        ]);
        clearError(root);
        const card = (title, series, value, mid, sub, label) => `
          <div class="ls-card">
            <span>${title}</span>
            <b class="num ${value >= mid ? "up" : "down"}">${sub}</b>
            ${spark(series, mid, label)}
          </div>`;
        const gl = g.map((x) => +x.longAccount * 100);
        const tp = top.map((x) => +x.longAccount * 100);
        const tr = tk.map((x) => +x.buySellRatio);
        const lastG = g[g.length - 1], lastT = top[top.length - 1], lastK = tk[tk.length - 1];
        if (!lastG) throw new Error("empty");
        k(root, "cards").innerHTML = [
          card(`${esc(sym)} · all accounts`, gl, gl.at(-1), 50, `${(+lastG.longAccount * 100).toFixed(1)}% long · ${(+lastG.longShortRatio).toFixed(2)}`, `Share of accounts long, last ${gl.length} periods`),
          lastT ? card(`${esc(sym)} · top traders (positions)`, tp, tp.at(-1), 50, `${(+lastT.longAccount * 100).toFixed(1)}% long · ${(+lastT.longShortRatio).toFixed(2)}`, `Top traders' long share, last ${tp.length} periods`) : "",
          lastK ? card(`${esc(sym)} · taker buy/sell`, tr, tr.at(-1), 1, `${(+lastK.buySellRatio).toFixed(2)}`, `Taker buy/sell volume ratio, last ${tr.length} periods`) : "",
        ].join("");
        k(root, "updated").textContent = `Last ${g.length} periods of ${$("option:checked", k(root, "period")).textContent} · updated ${hhmm(new Date())}`;
      } catch (e) {
        showError(root, e);
        k(root, "cards").innerHTML = e.status === 400 ? `<p class="muted">Binance has no long/short data for ${esc(sym)}.</p>` : "";
      }
    }

    async function loadMajors() {
      try {
        const res = await Promise.all(MAJORS.map((m) => Promise.all([
          get(`/futures/data/globalLongShortAccountRatio?symbol=${m}USDT&period=1h&limit=25`),
          get(`/futures/data/topLongShortPositionRatio?symbol=${m}USDT&period=1h&limit=1`),
        ]).catch(() => null)));
        k(root, "rows").innerHTML = MAJORS.map((m, i) => {
          if (!res[i] || !res[i][0].length) return "";
          const [g, t] = res[i];
          const last = g[g.length - 1], first = g[0];
          const long = +last.longAccount * 100;
          const r = +last.longShortRatio, r0 = +first.longShortRatio;
          const tl = t[0] ? +t[0].longAccount * 100 : NaN;
          return `<tr>
            <th scope="row"><a href="#" data-coin="${m}">${m}</a></th>
            <td><div class="lsbar" role="img" aria-label="${long.toFixed(1)}% long"><span style="width:${long}%"></span></div><small class="num">${long.toFixed(1)}% long · ${(100 - long).toFixed(1)}% short</small></td>
            <td class="r num">${r.toFixed(2)}</td>
            <td class="r num ${cls(r - r0)}">${r - r0 >= 0 ? "+" : "−"}${Math.abs(r - r0).toFixed(2)}</td>
            <td class="r num">${isFinite(tl) ? `${tl.toFixed(1)}% long` : "—"}</td>
          </tr>`;
        }).join("");
      } catch (e) {
        showError(root, e);
      }
    }

    function choose(s) {
      sym = s;
      setPressed($$("[data-pick]", root), $(`[data-pick="${s}"]`, root));
      loadCoin();
    }

    k(root, "coins").innerHTML = MAJORS.map((m) => `<button type="button" data-pick="${m}" aria-pressed="${m === sym}">${m}</button>`).join("");
    perps().then((list) => {
      if (list) $("#ls-syms").innerHTML = list.map((s) => `<option value="${esc(base(s))}">`).join("");
    });
    root.addEventListener("click", (e) => {
      const p = e.target.closest("[data-pick]");
      if (p) choose(p.dataset.pick);
      const c = e.target.closest("[data-coin]");
      if (c) { e.preventDefault(); choose(c.dataset.coin); k(root, "cards").scrollIntoView({ behavior: "smooth", block: "center" }); }
    });
    k(root, "sym").addEventListener("change", async (e) => {
      const v = e.target.value.trim().toUpperCase().replace(/USDT$/, "");
      if (!v) return;
      const list = await perps();
      if (list && !list.includes(`${v}USDT`)) {
        k(root, "cards").innerHTML = `<p class="muted">${esc(v)} isn't a Binance USDT perpetual.</p>`;
        return;
      }
      choose(v);
    });
    k(root, "period").addEventListener("change", (e) => { period = e.target.value; loadCoin(); });

    loadCoin();
    loadMajors();
    clearInterval(timer);
    timer = setInterval(() => { loadCoin(); loadMajors(); }, 60000);
  }

  const tool = $("[data-tool]");
  if (tool) ({ funding, hours, ls })[tool.dataset.tool]?.(tool);
})();
