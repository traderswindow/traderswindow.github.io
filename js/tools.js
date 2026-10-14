// Uneltele de pe /tools/. Datele vin direct din API-uri publice (Binance, alternative.me, CoinPaprika), fără server.
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

  // Selector de monedă comun (long/short, open interest)
  function coinPicker(root, list, onPick) {
    k(root, "coins").innerHTML = MAJORS.map((m, i) => `<button type="button" data-pick="${m}" aria-pressed="${i === 0}">${m}</button>`).join("");
    perps().then((l) => { if (l) $(`#${list}`).innerHTML = l.map((s) => `<option value="${esc(base(s))}">`).join(""); });
    const choose = (s) => { setPressed($$("[data-pick]", root), $(`[data-pick="${s}"]`, root)); onPick(s); };
    root.addEventListener("click", (e) => {
      const p = e.target.closest("[data-pick]");
      if (p) choose(p.dataset.pick);
      const c = e.target.closest("[data-coin]");
      if (c) { e.preventDefault(); choose(c.dataset.coin); k(root, "stats").scrollIntoView({ behavior: "smooth", block: "center" }); }
    });
    k(root, "sym").addEventListener("change", async (e) => {
      const v = e.target.value.trim().toUpperCase().replace(/USDT$/, "");
      if (!v) return;
      const l = await perps();
      if (l && !l.includes(`${v}USDT`)) { k(root, "updated").textContent = `${v} isn't a Binance USDT perpetual.`; return; }
      choose(v);
    });
  }

  const PERIOD_MS = { "5m": 3e5, "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 };
  const spanText = (n, period) => `over the last ${dur(n * PERIOD_MS[period]).replace(/ 0+m$/, "").replace(/ 0h$/, "")}`;

  // ---------------------------------------------------------------------------
  // Open interest
  // ---------------------------------------------------------------------------
  function reading(oiChg, pxChg) {
    if (Math.abs(oiChg) < 1 || Math.abs(pxChg) < 0.5) return { text: "Flat", note: "No clear move in price and positions", cls: "" };
    if (pxChg > 0) return oiChg > 0 ? { text: "New longs", note: "Price and positions rising together", cls: "up" } : { text: "Short covering", note: "Price up while positions close", cls: "up" };
    return oiChg > 0 ? { text: "New shorts", note: "Price down while positions grow", cls: "down" } : { text: "Longs closing", note: "Price and positions falling together", cls: "down" };
  }

  function lines(series, label) {
    const w = 600, h = 160, pad = 6;
    const path = (vals) => {
      let lo = Math.min(...vals), hi = Math.max(...vals);
      if (hi - lo < 1e-12) { hi += 1; lo -= 1; }
      return vals.map((v, i) => `${(pad + (i / (vals.length - 1)) * (w - 2 * pad)).toFixed(1)},${(pad + (1 - (v - lo) / (hi - lo)) * (h - 2 * pad)).toFixed(1)}`).join(" ");
    };
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">
      ${series.map(([vals, c]) => vals.length > 1 ? `<polyline points="${path(vals)}" class="${c}"/>` : "").join("")}
    </svg>`;
  }

  function oi(root) {
    let sym = "BTC", period = "1h";
    let rows = [], sort = { key: "oi", dir: -1 };

    async function loadCoin() {
      const s = `${sym}USDT`;
      try {
        const [hist, kl, now, mark] = await Promise.all([
          get(`/futures/data/openInterestHist?symbol=${s}&period=${period}&limit=48`),
          get(`/fapi/v1/klines?symbol=${s}&interval=${period}&limit=48`),
          get(`/fapi/v1/openInterest?symbol=${s}`),
          get(`/fapi/v1/premiumIndex?symbol=${s}`),
        ]);
        if (!hist.length) throw Object.assign(new Error("empty"), { status: 400 });
        clearError(root);
        const cur = +now.openInterest * +mark.markPrice;
        const vals = [...hist.map((x) => +x.sumOpenInterestValue), cur];
        const first = vals[0];
        const oiChg = (cur / first - 1) * 100;
        const px = kl.map((x) => +x[4]);
        const pxChg = (+mark.markPrice / +kl[0][1] - 1) * 100;
        const r = reading(oiChg, pxChg);
        const span = spanText(hist.length, period);
        k(root, "oi").textContent = money(cur);
        k(root, "oi-coins").textContent = `${(+now.openInterest).toLocaleString("en-US", { maximumFractionDigits: 0 })} ${sym}`;
        k(root, "oi-chg").textContent = pct(oiChg, 2);
        k(root, "oi-chg").className = `num ${cls(oiChg)}`;
        k(root, "px-chg").textContent = pct(pxChg, 2);
        k(root, "px-chg").className = `num ${cls(pxChg)}`;
        k(root, "span").textContent = span;
        k(root, "span2").textContent = span;
        k(root, "reading").textContent = r.text;
        k(root, "reading").className = r.cls;
        k(root, "reading-note").textContent = r.note;
        k(root, "chart").innerHTML = `${lines([[vals, "oi-line"], [[...px, +mark.markPrice], "px-line"]], `${sym} open interest and price ${span}`)}
          <p class="legend-line muted"><i class="sw oi"></i>${esc(sym)} open interest <i class="sw px"></i>Price</p>`;
        k(root, "updated").textContent = `Updated ${hhmm(new Date())} · refreshes every minute`;
      } catch (e) {
        showError(root, e);
        if (e.status === 400) k(root, "updated").textContent = `Binance has no open interest data for ${sym}.`;
      }
    }

    async function loadTable() {
      try {
        const [list, tick, prem] = await Promise.all([perps(), get("/fapi/v1/ticker/24hr"), get("/fapi/v1/premiumIndex")]);
        const allowed = list ? new Set(list) : null;
        const markOf = new Map(prem.map((x) => [x.symbol, +x.markPrice]));
        const top = tick.filter((x) => (allowed ? allowed.has(x.symbol) : /USDT$/.test(x.symbol))).sort((a, b) => +b.quoteVolume - +a.quoteVolume).slice(0, 25);
        const res = await Promise.all(top.map((x) => Promise.all([
          get(`/futures/data/openInterestHist?symbol=${x.symbol}&period=1h&limit=25`),
          get(`/fapi/v1/openInterest?symbol=${x.symbol}`),
        ]).catch(() => null)));
        rows = top.map((x, i) => {
          if (!res[i] || !res[i][0].length) return null;
          const [h, n] = res[i];
          const cur = +n.openInterest * (markOf.get(x.symbol) || +x.lastPrice);
          const c1 = (cur / +h[h.length - 1].sumOpenInterestValue - 1) * 100;
          const c24 = (cur / +h[0].sumOpenInterestValue - 1) * 100;
          const pxc = +x.priceChangePercent;
          return { sym: base(x.symbol), oi: cur, c1, c24, px: pxc, r: reading(c24, pxc) };
        }).filter(Boolean);
        clearError(root);
        renderTable();
      } catch (e) {
        showError(root, e);
        if (!rows.length) k(root, "rows").innerHTML = `<tr><td colspan="6" class="muted">No data.</td></tr>`;
      }
    }

    function renderTable() {
      const { key, dir } = sort;
      const view = [...rows].sort((a, b) => (key === "sym" ? a.sym.localeCompare(b.sym) * dir : (a[key] - b[key]) * dir));
      k(root, "rows").innerHTML = view.map((r) => `<tr>
          <th scope="row"><a href="#" data-coin="${esc(r.sym)}">${esc(r.sym)}</a></th>
          <td class="r num">${money(r.oi)}</td>
          <td class="r num ${cls(r.c1)}">${pct(r.c1, 1)}</td>
          <td class="r num ${cls(r.c24)}">${pct(r.c24, 1)}</td>
          <td class="r num ${cls(r.px)}">${pct(r.px, 1)}</td>
          <td><span class="tag ${r.r.cls}">${r.r.text}</span></td>
        </tr>`).join("");
      $$("[data-sort]", root).forEach((b) => b.setAttribute("aria-sort", b.dataset.sort === key ? (dir > 0 ? "ascending" : "descending") : "none"));
    }

    root.addEventListener("click", (e) => {
      const s = e.target.closest("[data-sort]");
      if (!s) return;
      const key = s.dataset.sort;
      sort = sort.key === key ? { key, dir: -sort.dir } : { key, dir: key === "sym" ? 1 : -1 };
      renderTable();
    });
    coinPicker(root, "oi-syms", (s) => { sym = s; loadCoin(); });
    k(root, "period").addEventListener("change", (e) => { period = e.target.value; loadCoin(); });
    loadCoin();
    loadTable();
    setInterval(loadCoin, 60000);
    setInterval(loadTable, 300000);
  }

  // ---------------------------------------------------------------------------
  // Fear & Greed
  // ---------------------------------------------------------------------------
  const SPOT = "https://data-api.binance.vision";
  const FNG_CLASS = { "Extreme Fear": "ef", Fear: "f", Neutral: "n", Greed: "g", "Extreme Greed": "eg" };

  async function btcDaily(fromMs) {
    const out = new Map();
    let start = fromMs;
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${SPOT}/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1000&startTime=${start}`);
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
      const kl = await r.json();
      kl.forEach((x) => out.set(x[0], +x[4]));
      if (kl.length < 1000) break;
      start = kl[kl.length - 1][0] + 864e5;
    }
    return out;
  }

  function gauge(v, label) {
    // semicerc 0–100
    const a = Math.PI * (1 - v / 100);
    const x = 100 + 80 * Math.cos(a), y = 100 - 80 * Math.sin(a);
    return `<svg viewBox="0 0 200 118" aria-hidden="true">
      <defs><linearGradient id="fg" x1="0" x2="1"><stop offset="0" stop-color="#ff3b6b"/><stop offset=".5" stop-color="#8a93a0"/><stop offset="1" stop-color="#00ff9c"/></linearGradient></defs>
      <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="url(#fg)" stroke-width="14" stroke-linecap="round" opacity=".85"/>
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="#0d0d0d" stroke="#f2f4f7" stroke-width="3"/>
    </svg>
    <b class="num">${v}</b><span class="${FNG_CLASS[label] || ""}">${esc(label)}</span>`;
  }

  function fng(root) {
    async function load() {
      let data;
      try {
        const r = await fetch("https://api.alternative.me/fng/?limit=0");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        data = (await r.json()).data.map((x) => ({ v: +x.value, c: x.value_classification, t: +x.timestamp * 1000, next: +x.time_until_update || 0 }));
      } catch (e) {
        const el = $("[data-msg]", root);
        el.hidden = false;
        el.textContent = "Couldn't reach alternative.me, which publishes the index. Try again in a few minutes.";
        return;
      }
      const [today] = data;
      k(root, "gauge").innerHTML = gauge(today.v, today.c);
      k(root, "gauge").setAttribute("aria-label", `Today's Fear and Greed Index: ${today.v}, ${today.c}`);
      for (const [key, i] of [["d1", 1], ["d7", 7], ["d30", 30]]) {
        const d = data[i];
        if (!d) continue;
        k(root, key).textContent = d.v;
        k(root, `${key}l`).textContent = d.c;
        k(root, `${key}l`).className = FNG_CLASS[d.c];
      }
      const year = data.slice(0, 365);
      const vs = year.map((d) => d.v);
      k(root, "range").textContent = `${Math.min(...vs)}–${Math.max(...vs)}`;
      k(root, "avg").textContent = `average ${Math.round(vs.reduce((a, b) => a + b, 0) / vs.length)}`;
      k(root, "updated").textContent = `Today's value from ${new Date(today.t).toLocaleDateString([], { dateStyle: "medium" })}${today.next ? `. Next update in ${dur(today.next * 1000)}` : ""}. Source: alternative.me`;

      let prices;
      try { prices = await btcDaily(data[data.length - 1].t - 2 * 864e5); } catch { prices = null; }
      chart(year.slice().reverse(), prices);
      history(data, prices);
    }

    function chart(days, prices) {
      const w = 730, h = 190, n = days.length, bw = w / n;
      const bars = days.map((d, i) => `<rect x="${(i * bw).toFixed(2)}" y="${(h - (d.v / 100) * h).toFixed(1)}" width="${(bw + 0.3).toFixed(2)}" height="${((d.v / 100) * h).toFixed(1)}" class="${FNG_CLASS[d.c]}"><title>${new Date(d.t).toLocaleDateString([], { dateStyle: "medium" })}: ${d.v} ${d.c}</title></rect>`).join("");
      let line = "";
      if (prices) {
        const ps = days.map((d) => prices.get(d.t)).map((p, i, a) => p ?? a[i - 1]);
        const ok = ps.filter(isFinite);
        if (ok.length > 1) {
          const lo = Math.min(...ok), hi = Math.max(...ok);
          line = `<polyline class="btc" points="${ps.map((p, i) => (isFinite(p) ? `${(i * bw + bw / 2).toFixed(1)},${(8 + (1 - (p - lo) / (hi - lo)) * (h - 16)).toFixed(1)}` : "")).filter(Boolean).join(" ")}"/>`;
        }
      }
      const first = new Date(days[0].t), last = new Date(days[n - 1].t);
      const f = (d) => d.toLocaleDateString([], { month: "short", year: "numeric" });
      k(root, "chart").innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Fear and Greed Index for the last ${n} days, with the Bitcoin price">${bars}${line}</svg><div class="axis muted"><span>${f(first)}</span><span>${f(last)}</span></div>`;
    }

    function history(data, prices) {
      if (!prices) {
        k(root, "rows").innerHTML = `<tr><td colspan="5" class="muted">Couldn't load Bitcoin's price history from Binance.</td></tr>`;
        return;
      }
      const groups = ["Extreme Fear", "Fear", "Neutral", "Greed", "Extreme Greed"].map((c) => ({ c, n: 0, r7: 0, r30: 0, up: 0 }));
      const D = 864e5;
      for (const d of data) {
        const entry = prices.get(d.t - D), p7 = prices.get(d.t - D + 7 * D), p30 = prices.get(d.t - D + 30 * D);
        if (!entry || !p7 || !p30) continue;
        const g = groups.find((x) => x.c === d.c);
        if (!g) continue;
        g.n++; g.r7 += p7 / entry - 1; g.r30 += p30 / entry - 1; g.up += p30 > entry ? 1 : 0;
      }
      k(root, "rows").innerHTML = groups.map((g) => g.n ? `<tr>
          <th scope="row"><span class="${FNG_CLASS[g.c]}">${g.c}</span></th>
          <td class="r num">${g.n.toLocaleString("en-US")}</td>
          <td class="r num ${cls(g.r7)}">${pct((g.r7 / g.n) * 100, 1)}</td>
          <td class="r num ${cls(g.r30)}">${pct((g.r30 / g.n) * 100, 1)}</td>
          <td class="r num">${Math.round((g.up / g.n) * 100)}%</td>
        </tr>` : "").join("");
      const since = new Date(data[data.length - 1].t).toLocaleDateString([], { month: "long", year: "numeric" });
      k(root, "hist-note").textContent = `Based on every daily reading since ${since} with 30 days of price data after it. Entry price: Bitcoin's close on Binance the day before the reading was published. Past results, not a forecast.`;
    }

    load();
    setInterval(load, 30 * 60000);
  }

  // ---------------------------------------------------------------------------
  // Altcoin season
  // ---------------------------------------------------------------------------
  const NOT_ALTS = new Set(["BTC", "STETH", "WETH", "RETH", "METH", "CBETH", "FRXETH", "LSETH", "WEETH", "WSTETH", "RSETH", "EZETH", "WBETH", "LBTC", "TBTC", "WBTC", "CBBTC", "SOLVBTC", "BTC.B", "BTCB",
    "JLP", "BNSOL", "JITOSOL", "MSOL", "JUPSOL", "KHYPE", "STKAAVE", "WTRX", "WBNB", "PAXG", "XAUT", "DAI", "GHO", "USDS", "SUSDS"]);
  const notAlt = (c) => NOT_ALTS.has(c.symbol.toUpperCase()) || /USD/i.test(c.symbol) || /\bUSD|dollar|gold|wrapped|staked|restaked|bridged|binance-peg/i.test(c.name);

  async function cached(key, ms, fn) {
    try {
      const hit = JSON.parse(sessionStorage.getItem(key) || "null");
      if (hit && Date.now() - hit.at < ms) return hit.v;
    } catch {}
    const v = await fn();
    try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), v })); } catch {}
    return v;
  }
  const json = async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    return r.json();
  };

  function alt(root) {
    async function load() {
      try {
        const [global, coins, spot] = await Promise.all([
          cached("tw-pap-global", 3e5, () => json("https://api.coinpaprika.com/v1/global")),
          cached("tw-pap-top", 6e5, () => json("https://api.coinpaprika.com/v1/tickers?limit=200").then((l) => l.map((c) => ({ symbol: c.symbol, name: c.name, rank: c.rank })))),
          json(`${SPOT}/api/v3/ticker/price`),
        ]);
        k(root, "dom").textContent = `${(+global.bitcoin_dominance_percentage).toFixed(1)}%`;
        const mcap = +global.market_cap_usd;
        k(root, "mcap").textContent = mcap >= 1e12 ? `$${(mcap / 1e12).toFixed(2)}T` : money(mcap);
        const mc = +global.market_cap_change_24h;
        k(root, "mcap-chg").innerHTML = `<span class="${cls(mc)}">${pct(mc, 2)}</span> in 24 hours`;

        const listed = new Set(spot.map((x) => x.symbol));
        const seen = new Set();
        const cands = coins.sort((a, b) => a.rank - b.rank).filter((c) => {
          const s = `${c.symbol.toUpperCase()}USDT`;
          if (notAlt(c) || !listed.has(s) || seen.has(s)) return false;
          seen.add(s);
          return true;
        }).slice(0, 75);

        const closes = async (sym) => {
          const kl = await json(`${SPOT}/api/v3/klines?symbol=${sym}USDT&interval=1d&limit=91`);
          if (kl.length < 91 || Date.now() - kl[kl.length - 1][0] > 2 * 864e5) return null;
          return (+kl[kl.length - 1][4] / +kl[0][4] - 1) * 100;
        };
        const btc = await closes("BTC");
        const perf = [];
        for (let i = 0; i < cands.length && perf.length < 50; i += 25) {
          const batch = cands.slice(i, i + 25);
          const res = await Promise.all(batch.map((c) => closes(c.symbol.toUpperCase()).catch(() => null)));
          batch.forEach((c, j) => { if (res[j] !== null && perf.length < 50) perf.push({ sym: c.symbol.toUpperCase(), name: c.name, chg: res[j] }); });
        }
        if (btc === null || perf.length < 40) throw new Error("not enough data");
        clearError(root);
        const beat = perf.filter((p) => p.chg > btc).length;
        const index = Math.round((beat / perf.length) * 100);
        k(root, "index").textContent = index;
        const label = index >= 75 ? "It's altcoin season." : index <= 25 ? "It's Bitcoin season." : index >= 50 ? "Not altcoin season yet: altcoins are mixed, leaning stronger." : "Not altcoin season: most altcoins are lagging Bitcoin.";
        k(root, "label").textContent = label;
        k(root, "index").className = `num ${index >= 75 ? "up" : index <= 25 ? "down" : ""}`;
        k(root, "pointer").style.left = `${index}%`;
        k(root, "btc90").textContent = pct(btc, 1);
        k(root, "btc90").className = `num ${cls(btc)}`;
        k(root, "beat").textContent = `${beat} of ${perf.length}`;
        k(root, "updated").textContent = `Calculated ${hhmm(new Date())} from Binance daily closes. Coin ranking and dominance: CoinPaprika`;

        perf.sort((a, b) => b.chg - a.chg);
        const lo = Math.min(0, btc, ...perf.map((p) => p.chg)), hi = Math.max(0, btc, ...perf.map((p) => p.chg));
        const x = (v) => ((v - lo) / (hi - lo)) * 100;
        k(root, "bars").innerHTML = perf.map((p) => `<div class="ab-row" title="${esc(p.name)}">
            <span class="ab-sym">${esc(p.sym)}</span>
            <div class="ab-track"><i class="${p.chg > btc ? "up" : "down"}" style="left:${Math.min(x(0), x(p.chg)).toFixed(2)}%;width:${Math.abs(x(p.chg) - x(0)).toFixed(2)}%"></i><b style="left:${x(btc).toFixed(2)}%"></b></div>
            <span class="num ${cls(p.chg)}">${pct(p.chg, 1)}</span>
          </div>`).join("") + `<p class="muted ab-key"><i class="sw btcl"></i>Bitcoin ${pct(btc, 1)}</p>`;
      } catch (e) {
        const el = $("[data-msg]", root);
        el.hidden = false;
        el.textContent = "Couldn't load the prices needed for the index right now. Try again in a minute.";
      }
    }
    load();
    setInterval(load, 15 * 60000);
  }

  // ---------------------------------------------------------------------------
  // Economic calendar
  // ---------------------------------------------------------------------------
  const CAL_TYPE = { fomc: "Fed", cpi: "CPI", jobs: "Jobs", opex: "Options" };

  function cal(root) {
    const events = JSON.parse(k(root, "events").textContent);
    let type = "all", utc = false;
    const opt = () => (utc ? { timeZone: "UTC" } : {});
    const fDate = (t) => new Date(t).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", ...opt() });
    const fTime = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...opt() }) + (utc ? " UTC" : "");
    const fMonth = (t) => new Date(t).toLocaleDateString([], { month: "long", year: "numeric", ...opt() });
    const LIVE = 2 * 36e5;

    function draw() {
      const now = Date.now();
      const view = events.filter((e) => (type === "all" || e.type === type) && e.t > now - LIVE);
      const next = view.find((e) => e.t > now - LIVE);
      const box = k(root, "next");
      if (next) {
        const live = next.t <= now;
        box.innerHTML = `<span class="muted">${live ? "Happening now" : "Next up"}</span>
          <b>${esc(next.title)}</b>
          <p class="cal-when"><span class="num cd">${live ? "Live" : dur(next.t - now)}</span> <span>${fDate(next.t)}, ${fTime(next.t)}</span></p>
          <p class="muted">${esc(next.note)}</p>`;
      } else box.innerHTML = `<b>No upcoming events in this list.</b><p class="muted">New dates are added when the Fed and BLS publish them.</p>`;

      let month = "";
      k(root, "list").innerHTML = view.slice(0, 40).map((e) => {
        const m = fMonth(e.t);
        const head = m !== month ? `<li class="cal-month">${m}</li>` : "";
        month = m;
        const live = e.t <= now;
        return `${head}<li class="cal-ev ${e.type} imp${e.impact}">
          <span class="cal-d">${fDate(e.t)}<small class="num">${fTime(e.t)}</small></span>
          <span class="cal-t"><b>${esc(e.title)}</b><small>${esc(e.note)}</small></span>
          <span class="cal-in num">${live ? "Live" : `in ${dur(e.t - now)}`}</span>
          <span class="tag t-${e.type}">${CAL_TYPE[e.type]}</span>
        </li>`;
      }).join("") || `<li class="muted">Nothing scheduled.</li>`;
    }

    root.addEventListener("click", (e) => {
      const t = e.target.closest("[data-type]");
      if (t) { type = t.dataset.type; setPressed($$("[data-type]", root), t); draw(); }
      const z = e.target.closest("[data-tz]");
      if (z) { utc = z.dataset.tz === "utc"; setPressed($$("[data-tz]", root), z); draw(); }
    });
    draw();
    setInterval(() => {
      const now = Date.now();
      $$(".cd", root).forEach((el) => {
        const n = events.find((e) => (type === "all" || e.type === type) && e.t > now - LIVE);
        if (n) el.textContent = n.t <= now ? "Live" : dur(n.t - now);
      });
    }, 1000);
    setInterval(draw, 60000);
  }

  const tool = $("[data-tool]");
  if (tool) ({ funding, hours, ls, oi, fng, alt, cal })[tool.dataset.tool]?.(tool);
})();
