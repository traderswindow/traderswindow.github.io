// Rezumatul zilnic al pieței, scris direct în paginile site-ului ca text normal,
// ca să-l vadă Google și asistenții AI (care de multe ori nu rulează JavaScript).
// Rulează zilnic din GitHub Actions (.github/workflows/snapshot.yml) și la fiecare publicare.
// Folosire: node .github/snapshot.mjs <dosarul site-ului>
//
// Fiecare parte are data ei. Dacă o sursă nu răspunde (Binance blochează serverele din SUA,
// unde rulează GitHub), rămâne valoarea de ieri; după 3 zile fără date proaspete partea dispare.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.argv[2] || ".";
const NOW = Date.now();
const MAX_AGE = 3 * 864e5;
const SPOT = "https://data-api.binance.vision";
const FAPI = "https://fapi.binance.com";

const get = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
};
const safe = async (name, fn) => {
  try { return await fn(); } catch (e) { console.warn(`snapshot ${name}: ${e.message}`); return null; }
};

const day = (t) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dayShort = (t) => new Date(t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const hm = (t) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const sign = (x, d) => { const a = Math.abs(x).toFixed(d); return `${+a === 0 ? "" : x > 0 ? "+" : "−"}${a}`; };
const big = (v) => (v >= 1e12 ? `$${(v / 1e12).toFixed(2)} trillion` : `$${(v / 1e9).toFixed(2)} billion`);
const usd = (v) => `$${v.toLocaleString("en-US", { maximumFractionDigits: v >= 100 ? 0 : 2 })}`;

// ---------------------------------------------------------------------------
// Date
// ---------------------------------------------------------------------------

async function fng() {
  const d = (await get("https://api.alternative.me/fng/?limit=31")).data;
  const v = (i) => d[i] && { value: +d[i].value, label: d[i].value_classification };
  return { at: +d[0].timestamp * 1000, today: v(0), yesterday: v(1), week: v(7), month: v(30) };
}

async function market() {
  const [g, t] = await Promise.all([
    get("https://api.coinpaprika.com/v1/global"),
    get(`${SPOT}/api/v3/ticker/24hr?symbols=${encodeURIComponent('["BTCUSDT","ETHUSDT"]')}`),
  ]);
  const px = Object.fromEntries(t.map((x) => [x.symbol, { price: +x.lastPrice, chg: +x.priceChangePercent }]));
  return { at: NOW, mcap: +g.market_cap_usd, mcapChg: +g.market_cap_change_24h, dom: +g.bitcoin_dominance_percentage, btc: px.BTCUSDT, eth: px.ETHUSDT };
}

// Aceeași regulă ca în site/static/js/tools.js (alt)
const NOT_ALTS = new Set(["BTC", "STETH", "WETH", "RETH", "METH", "CBETH", "FRXETH", "LSETH", "WEETH", "WSTETH", "RSETH", "EZETH", "WBETH", "LBTC", "TBTC", "WBTC", "CBBTC", "SOLVBTC", "BTC.B", "BTCB",
  "JLP", "BNSOL", "JITOSOL", "MSOL", "JUPSOL", "KHYPE", "STKAAVE", "WTRX", "WBNB", "PAXG", "XAUT", "DAI", "GHO", "USDS", "SUSDS"]);
const notAlt = (c) => NOT_ALTS.has(c.symbol.toUpperCase()) || /USD/i.test(c.symbol) || /\bUSD|dollar|gold|wrapped|staked|restaked|bridged|binance-peg/i.test(c.name);

async function altseason() {
  const [coins, spot] = await Promise.all([get("https://api.coinpaprika.com/v1/tickers?limit=200"), get(`${SPOT}/api/v3/ticker/price`)]);
  const listed = new Set(spot.map((x) => x.symbol));
  const seen = new Set();
  const cands = coins.sort((a, b) => a.rank - b.rank).filter((c) => {
    const s = `${c.symbol.toUpperCase()}USDT`;
    if (notAlt(c) || !listed.has(s) || seen.has(s)) return false;
    seen.add(s);
    return true;
  }).slice(0, 75);
  const closes = async (sym) => {
    const kl = await get(`${SPOT}/api/v3/klines?symbol=${sym}USDT&interval=1d&limit=91`);
    if (kl.length < 91 || NOW - kl[kl.length - 1][0] > 2 * 864e5) return null;
    return (+kl[kl.length - 1][4] / +kl[0][4] - 1) * 100;
  };
  const btc = await closes("BTC");
  const perf = [];
  for (let i = 0; i < cands.length && perf.length < 50; i += 25) {
    const batch = cands.slice(i, i + 25);
    const res = await Promise.all(batch.map((c) => closes(c.symbol.toUpperCase()).catch(() => null)));
    batch.forEach((c, j) => { if (res[j] !== null && perf.length < 50) perf.push({ sym: c.symbol.toUpperCase(), chg: res[j] }); });
  }
  if (btc === null || perf.length < 40) throw new Error("prea puține date");
  const beat = perf.filter((p) => p.chg > btc).length;
  perf.sort((a, b) => b.chg - a.chg);
  return { at: NOW, index: Math.round((beat / perf.length) * 100), beat, of: perf.length, btc90: btc, best: perf.slice(0, 3) };
}

async function futures() {
  const [b, e, oi, ls] = await Promise.all([
    get(`${FAPI}/fapi/v1/premiumIndex?symbol=BTCUSDT`),
    get(`${FAPI}/fapi/v1/premiumIndex?symbol=ETHUSDT`),
    get(`${FAPI}/futures/data/openInterestHist?symbol=BTCUSDT&period=1h&limit=25`),
    get(`${FAPI}/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1`),
  ]);
  const o1 = +oi[oi.length - 1].sumOpenInterestValue, o0 = +oi[0].sumOpenInterestValue;
  return {
    at: NOW,
    btcFunding: +b.lastFundingRate * 100, ethFunding: +e.lastFundingRate * 100,
    btcOI: o1, btcOIchg: (o1 / o0 - 1) * 100,
    longPct: +ls[0].longAccount * 100, lsRatio: +ls[0].longShortRatio,
  };
}

// Analiza tehnică: aceeași logică ca pagina (js/ta-core.js), pentru cele 20 de monede ale ei
const TA = await import(`data:text/javascript;base64,${Buffer.from(readFileSync(join(ROOT, "js", "ta-core.js"))).toString("base64")}`).catch(() => null);
async function dailyCloses(sym) {
  const out = [];
  let start = Date.UTC(2017, 0, 1);
  for (let i = 0; i < 8; i++) {
    const kl = await get(`${SPOT}/api/v3/klines?symbol=${sym}USDT&interval=1d&limit=1000&startTime=${start}`);
    kl.forEach((x) => { if (x[6] < NOW) out.push({ t: x[0], c: +x[4] }); });
    if (kl.length < 1000) break;
    start = kl[kl.length - 1][0] + 864e5;
  }
  return out;
}
async function technical() {
  const coins = {}, closes = {};
  for (let i = 0; i < TA.COINS.length; i += 5) {
    const batch = TA.COINS.slice(i, i + 5);
    const res = await Promise.all(batch.map((s) => dailyCloses(s).catch(() => null)));
    batch.forEach((s, j) => {
      if (!res[j] || !res[j].length) return;
      closes[s] = res[j];
      coins[s] = {};
      for (const h of TA.HORIZONS) {
        const a = TA.analyze(res[j], h);
        if (a.ok) coins[s][h] = { v: a.verdict, p: a.p, base: a.base, cases: a.cases, indep: a.indep, lo: a.lo, hi: a.hi, price: a.price, trend: a.trend, at: a.at, dist200: a.dist200, mom30: a.mom30 };
      }
    });
  }
  if (!coins.BTC) throw new Error("fără BTC");
  return { at: NOW, coins, closes };
}

// Jurnalul public al citirilor: [zi, monedă, orizont, verdict, preț, interval jos, interval sus, prețul după orizont]
const sig = (x) => +x.toPrecision(6);
function taLog(T) {
  const p = join(ROOT, "data", "ta-log.json");
  let log;
  try { log = JSON.parse(readFileSync(p, "utf8")); } catch { log = { start: iso(NOW), e: [] }; }
  const have = new Set(log.e.map((x) => `${x[0]} ${x[1]} ${x[2]}`));
  for (const [s, hs] of Object.entries(T.coins)) for (const [h, a] of Object.entries(hs)) {
    const row = [iso(a.at), s, +h, a.v, sig(a.price), sig(a.lo), sig(a.hi), null];
    if (!have.has(`${row[0]} ${s} ${row[2]}`)) log.e.push(row);
  }
  for (const x of log.e) {
    if (x[7] != null || !T.closes[x[1]]) continue;
    const target = Date.parse(x[0]) + x[2] * 864e5;
    const c = T.closes[x[1]].find((k) => k.t === target);
    if (c) x[7] = sig(c.c);
  }
  writeFileSync(p, JSON.stringify(log));
  return log;
}

// Evenimentele vin din calendarul .ics generat de site (același dosar)
function events() {
  const p = join(ROOT, "calendar", "crypto-events.ics");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("BEGIN:VEVENT").slice(1).map((b) => {
    const s = (b.match(/DTSTART:(\d{8}T\d{6})Z/) || [])[1];
    const t = s && Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13));
    return { t, title: ((b.match(/SUMMARY:(.*)/) || [])[1] || "").trim().replace(/\\(.)/g, "$1") };
  }).filter((e) => e.t > NOW && !/^Monthly/.test(e.title)).sort((a, b) => a.t - b.t).slice(0, 4);
}

// ---------------------------------------------------------------------------
// Texte (engleză, propoziții întregi, ușor de citat)
// ---------------------------------------------------------------------------

const fngLine = (f) => {
  const was = [["yesterday", f.yesterday], ["a week ago", f.week], ["a month ago", f.month]].filter(([, x]) => x).map(([w, x]) => `${x.value} ${w}`);
  return `The Crypto Fear &amp; Greed Index is <b>${f.today.value} (${f.today.label})</b>${was.length ? `, compared with ${was.join(", ")}` : ""}.`;
};
const altVerdict = (i) => (i >= 75 ? "it's altcoin season" : i <= 25 ? "it's Bitcoin season" : "it's not altcoin season yet (that takes 75)");
const altLine = (a) => `The altcoin season index is <b>${a.index}</b>: ${a.beat} of the top ${a.of} altcoins did better than Bitcoin over the last 90 days, so ${altVerdict(a.index)}.`;
const mktLine = (m) => `Bitcoin dominance is <b>${m.dom.toFixed(1)}%</b> and the total crypto market is worth ${big(m.mcap)} (${sign(m.mcapChg, 1)}% in 24 hours).`;
const pxLine = (m) => `Bitcoin is at <b>${usd(m.btc.price)}</b> (${sign(m.btc.chg, 1)}% in 24 hours) and Ethereum at ${usd(m.eth.price)} (${sign(m.eth.chg, 1)}%).`;
const fundLine = (f) => `BTC funding on Binance is <b>${sign(f.btcFunding, 4)}% every 8 hours</b> (${sign(f.btcFunding * 3 * 365, 1)}% a year)${f.btcFunding > 0 ? ", so longs pay shorts" : f.btcFunding < 0 ? ", so shorts pay longs" : ""}. ETH funding is ${sign(f.ethFunding, 4)}%.`;
const oiLine = (f) => `BTC open interest on Binance is <b>${big(f.btcOI)}</b>, ${sign(f.btcOIchg, 1)}% in 24 hours.`;
const lsLine = (f) => `<b>${f.longPct.toFixed(1)}% of Binance accounts</b> holding a BTC futures position are long (long/short ratio ${f.lsRatio.toFixed(2)}).`;
const calLine = (ev) => {
  if (!ev.length) return "";
  const [n, ...rest] = ev;
  const days = Math.round((n.t - NOW) / 864e5);
  const when = days < 1 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  return `Next: <b>${n.title}, ${dayShort(n.t)} at ${hm(n.t)} UTC</b> (${when}).${rest.length ? ` After that: ${rest.map((e) => `${e.title} on ${dayShort(e.t)}`).join("; ")}.` : ""}`;
};

const TA_LABEL = { up: "Leaning up", down: "Leaning down", side: "Sideways", none: "No clear direction", few: "Not enough history" };
const pc = (x) => `${Math.round(x * 100)}%`;
const rng = (a) => `${sign((a.lo / a.price - 1) * 100, 1)}% to ${sign((a.hi / a.price - 1) * 100, 1)}%`;
const taUrl = (s) => `/tools/crypto-technical-analysis/${TA.coinSlug(s)}/`;
const taLink = (s) => `<a href="${taUrl(s)}">${TA.NAMES[s] || s}</a>`;
const px = (v) => `$${v.toLocaleString("en-US", { maximumFractionDigits: v >= 1000 ? 0 : v >= 1 ? 2 : v >= 0.01 ? 4 : 8 })}`;
const scored = (a) => a.v !== "few";
const taOne = (s, a) => scored(a)
  ? `${taLink(s)} <b>${TA_LABEL[a.v]}</b> (higher 7 days later in ${pc(a.p)} of ${a.cases.toLocaleString("en-US")} similar days, ${pc(a.base)} on an ordinary day; likely range ${rng(a)})`
  : `${taLink(s)} <b>${TA_LABEL[a.v]}</b>`;
const taLine = (T) => {
  const w = (s) => T.coins[s] && T.coins[s][7];
  const main = ["BTC", "ETH"].filter(w).map((s) => taOne(s, w(s)));
  const rest = Object.keys(T.coins).filter((s) => s !== "BTC" && s !== "ETH" && w(s)).map((s) => `${taLink(s)} ${TA_LABEL[w(s).v].toLowerCase()}`);
  const at = w("BTC") ? w("BTC").at : T.at;
  return `Technical readings for the next 7 days, from the daily close of ${day(at)}: ${main.join("; ")}.${rest.length ? ` Other coins: ${rest.join(", ")}.` : ""}`;
};
// textul zilei pe pagina fiecărei monede
const TREND_TXT = { up: "an uptrend", down: "a downtrend", mixed: "a mixed trend" };
const taHorizon = (a, h) => scored(a)
  ? `<b>${TA_LABEL[a.v]}</b> (higher ${h} days later in ${pc(a.p)} of ${a.cases.toLocaleString("en-US")} similar days, ${pc(a.base)} on an ordinary day; likely range ${rng(a)}, ${px(a.lo)} to ${px(a.hi)})`
  : `<b>${TA_LABEL[a.v]}</b> (only ${a.indep} separate past cases like today)`;
const taCoinLines = (s, c) => {
  const n = TA.NAMES[s], a = c[7] || c[30];
  if (!a) return [];
  return [
    `From the daily close of ${day(a.at)}, when ${n} closed at <b>${px(a.price)}</b>: the reading for the next 7 days is ${c[7] ? taHorizon(c[7], 7) : "not available"}; for the next 30 days it's ${c[30] ? taHorizon(c[30], 30) : "not available"}.`,
    `${n} is in ${TREND_TXT[a.trend]}: the price is ${sign(Math.abs(a.dist200) * 100, 1).replace("+", "")}% ${a.dist200 >= 0 ? "above" : "below"} its 200-day average and ${sign(a.mom30 * 100, 1)}% over the last 30 days.`,
  ];
};
const taTable = (T) => {
  const rows = TA.COINS.filter((s) => T.coins[s] && T.coins[s][7]).map((s) => {
    const a = T.coins[s][7], b = T.coins[s][30];
    const cl = (x) => (x && x.v === "up" ? "up" : x && x.v === "down" ? "down" : "");
    return `<tr><td>${taLink(s)}</td><td class="${cl(a)}">${TA_LABEL[a.v]}</td><td class="r num">${scored(a) ? pc(a.p) : "—"}</td><td class="r num">${rng(a)}</td><td class="${cl(b)}">${b ? TA_LABEL[b.v] : "—"}</td><td class="${a.trend === "mixed" ? "" : a.trend}">${a.trend === "up" ? "Uptrend" : a.trend === "down" ? "Downtrend" : "Mixed"}</td></tr>`;
  }).join("");
  return `<div class="tbl-wrap"><table class="data ta-table"><thead><tr><th scope="col">Coin</th><th scope="col">Next 7 days</th><th scope="col" class="r">Higher after 7 days</th><th scope="col" class="r">Likely 7-day range</th><th scope="col">Next 30 days</th><th scope="col">Trend</th></tr></thead><tbody>${rows}</tbody></table></div>`;
};

// ---------------------------------------------------------------------------
// Scriere în pagini
// ---------------------------------------------------------------------------

const prevPath = join(ROOT, "data", "today.json");
let prev = {};
try { prev = JSON.parse(readFileSync(prevPath, "utf8")); } catch {}
const keep = (name, fresh) => (fresh ? fresh : prev[name] && NOW - prev[name].at < MAX_AGE ? prev[name] : null);

const [F, M, A, X, T] = await Promise.all([safe("fng", fng), safe("market", market), safe("alt", altseason), safe("futures", futures), TA ? safe("ta", technical) : null]);
mkdirSync(join(ROOT, "data"), { recursive: true });
if (T) taLog(T);
const taKeep = T ? { at: T.at, coins: T.coins } : null;
const D = { updated: NOW, fng: keep("fng", F), market: keep("market", M), alt: keep("alt", A), futures: keep("futures", X), ta: keep("ta", taKeep), events: events() };
writeFileSync(prevPath, JSON.stringify(D));

const lines = {
  fng: D.fng && fngLine(D.fng),
  alt: D.alt && altLine(D.alt),
  mkt: D.market && mktLine(D.market),
  px: D.market && pxLine(D.market),
  fund: D.futures && fundLine(D.futures),
  oi: D.futures && oiLine(D.futures),
  ls: D.futures && lsLine(D.futures),
  cal: calLine(D.events),
  ta: D.ta && taLine(D.ta),
  tatable: D.ta && taTable(D.ta),
};
const taCoinKeys = {};
if (D.ta) for (const [s, c] of Object.entries(D.ta.coins)) taCoinLines(s, c).forEach((l, i) => { lines[`ta_${s}_${i}`] = l; (taCoinKeys[`ta_${s}`] ||= []).push(`ta_${s}_${i}`); });
// ce apare pe fiecare pagină
const BLOCKS = {
  today: ["px", "fng", "mkt", "alt", "fund", "oi", "ls", "cal", "ta"],
  fng: ["fng", "px"],
  alt: ["alt", "mkt"],
  funding: ["fund", "px"],
  oi: ["oi", "px"],
  ls: ["ls", "fund"],
  cal: ["cal"],
  ta: ["ta", "px"],
  tatable: ["tatable"],
  ...taCoinKeys,
};
const stamp = `<p class="snap-h">Snapshot of <time datetime="${new Date(NOW).toISOString()}">${day(NOW)}, ${hm(NOW)} UTC</time>. Written every morning; the live numbers on this page refresh on their own.</p>`;
const block = (key) => {
  const ps = BLOCKS[key].map((k) => lines[k]).filter(Boolean);
  return ps.length ? `<div class="snap">${stamp}${ps.map((p) => (p.startsWith("<div") ? p : `<p>${p}</p>`)).join("")}</div>` : "";
};

// Răspunsurile din FAQ primesc cifra zilei în față (și în JSON-LD), ex. „As of 15 Oct 2026, ... . The live value ...”
const plain = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "and");
const FAQ = [
  ["The live value is at the top of this page.", D.fng && `As of ${day(NOW)}, the index is ${D.fng.today.value} (${D.fng.today.label}).`],
  ["The live index is at the top of this page.", D.alt && `As of ${day(NOW)}, the index is ${D.alt.index}, so ${altVerdict(D.alt.index)}.`],
  ["It's shown live on this page:", D.market && `As of ${day(NOW)}, it's ${D.market.dom.toFixed(1)}%.`],
  ["The next date and a live countdown are at the top of this page.", (() => { const f = D.events.find((e) => /FOMC/.test(e.title)); return f && `As of ${day(NOW)}, the next FOMC decision is on ${dayShort(f.t)} at ${hm(f.t)} UTC.`; })()],
  ["Nobody knows, and any site that says it does is guessing.", D.ta && D.ta.coins.BTC && D.ta.coins.BTC[7] && `As of ${day(NOW)}, the 7-day reading for Bitcoin is ${TA_LABEL[D.ta.coins.BTC[7].v]}: in similar setups it was higher 7 days later ${pc(D.ta.coins.BTC[7].p)} of the time, against ${pc(D.ta.coins.BTC[7].base)} on an ordinary day.`],
  ...(D.ta ? Object.entries(D.ta.coins).flatMap(([s, c]) => {
    const n = TA.NAMES[s], a = c[7];
    if (!a) return [];
    return [
      [`Nobody can know where ${n} goes next.`, scored(a) && `As of ${day(NOW)}, the 7-day reading for ${n} is ${TA_LABEL[a.v]}: in similar setups it was higher 7 days later ${pc(a.p)} of the time, against ${pc(a.base)} on an ordinary day.`],
      [`The likely range for ${n} is on this page and changes once a day.`, `As of ${day(NOW)}, it's ${px(a.lo)} to ${px(a.hi)} for the next 7 days (${rng(a)}).`],
      [`The Trend card on this page shows it for ${n}.`, `As of ${day(NOW)}, ${n} is in ${TREND_TXT[a.trend]}.`],
    ];
  }) : []),
  ["The live overview is at the top of this page.", D.market && D.fng && `As of ${day(NOW)}, ${plain(pxLine(D.market))} The Fear and Greed Index is ${D.fng.today.value} (${D.fng.today.label}).`],
];
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const touched = new Set();
function walk(dir) {
  for (const n of readdirSync(dir)) {
    if (n.startsWith(".")) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n.endsWith(".html")) patch(p);
  }
}
function patch(p) {
  let s = readFileSync(p, "utf8");
  const before = s;
  s = s.replace(/<!--snap:(\w+)-->[\s\S]*?<!--\/snap-->/g, (_, key) => `<!--snap:${key}-->${BLOCKS[key] ? block(key) : ""}<!--/snap-->`);
  for (const [base, pre] of FAQ) {
    const re = new RegExp(`(?:As of \\d{1,2} [A-Z][a-z]{2} \\d{4}, [^<"]*?\\. )?${reEsc(base)}`, "g");
    s = s.replace(re, () => (pre ? `${pre} ${base}` : base));
  }
  if (s !== before) {
    s = s.replace(/"dateModified":"[^"]*"/g, `"dateModified":"${iso(NOW)}"`);
    writeFileSync(p, s);
    touched.add(p);
  }
}
walk(ROOT);

// Harta site-ului: data de azi pentru paginile schimbate
const sm = join(ROOT, "sitemap.xml");
if (existsSync(sm)) {
  const paths = [...touched].map((p) => "/" + p.slice(ROOT.length).replace(/^\/+/, "").replace(/index\.html$/, ""));
  let x = readFileSync(sm, "utf8");
  for (const path of paths) x = x.replace(new RegExp(`(<loc>[^<]*${reEsc(path)}</loc><lastmod>)[^<]*`), `$1${iso(NOW)}`);
  writeFileSync(sm, x);
}

// llms.txt: secțiunea „Today”
const llms = join(ROOT, "llms.txt");
if (existsSync(llms)) {
  const today = BLOCKS.today.map((k) => lines[k]).filter(Boolean).map((l) => `- ${plain(l)}`).join("\n");
  const t = readFileSync(llms, "utf8").replace(/<!--snap-->[\s\S]*?<!--\/snap-->/, () => `<!--snap-->\n## Crypto market on ${day(NOW)} (${hm(NOW)} UTC)\n\n${today}\n<!--/snap-->`);
  writeFileSync(llms, t);
}

console.log(`snapshot: ${touched.size} pagini; fng ${D.fng ? "ok" : "—"}, piață ${D.market ? "ok" : "—"}, altseason ${D.alt ? "ok" : "—"}, futures ${D.futures ? (X ? "ok" : "de ieri") : "—"}, analiză tehnică ${T ? "ok" : "—"}`);
