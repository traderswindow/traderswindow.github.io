// Analiza tehnică „cinstită”: aceeași logică în browser (js/ta.js) și în robotul zilnic (.github/snapshot.mjs).
// Nu ghicește prețul. Spune ce s-a întâmplat în trecut în condiții asemănătoare, cât de des, din câte cazuri,
// și cât de mult s-a mișcat de obicei prețul. Cercetarea: research/reports/Unealtă analiză tehnică pe site.md
//
// Intrare: lumânări zilnice ÎNCHISE, în ordine, [{ t: ms, c: preț de închidere }].
// Ieșire: starea de azi + statistica istorică pentru orizontul h (zile).

export const COINS = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA", "TRX", "AVAX", "LINK", "SUI", "TON", "DOT", "LTC", "BCH", "NEAR", "APT", "UNI", "AAVE", "PEPE"];
export const NAMES = { BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", XRP: "XRP", BNB: "BNB", DOGE: "Dogecoin", ADA: "Cardano", TRX: "TRON", AVAX: "Avalanche", LINK: "Chainlink", SUI: "Sui", TON: "Toncoin", DOT: "Polkadot", LTC: "Litecoin", BCH: "Bitcoin Cash", NEAR: "NEAR", APT: "Aptos", UNI: "Uniswap", AAVE: "Aave", PEPE: "Pepe" };
// adresa paginii fiecărei monede: /tools/crypto-technical-analysis/<slug>/
export const coinSlug = (sym) => NAMES[sym].toLowerCase().replace(/ /g, "-");
export const HORIZONS = [7, 30];
export const WARMUP = 200; // zile necesare pentru media de 200 de zile
export const MIN_CASES = 20; // sub atâtea cazuri independente nu dăm verdict

const D = 864e5;

function sma(c, n) {
  const out = new Array(c.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < c.length; i++) {
    s += c[i];
    if (i >= n) s -= c[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

// volatilitatea zilnică: deviația standard a randamentelor logaritmice pe 20 de zile
function vol(c, n = 20) {
  const r = c.map((x, i) => (i ? Math.log(x / c[i - 1]) : 0));
  const out = new Array(c.length).fill(NaN);
  for (let i = n; i < c.length; i++) {
    let m = 0, v = 0;
    for (let j = i - n + 1; j <= i; j++) m += r[j];
    m /= n;
    for (let j = i - n + 1; j <= i; j++) v += (r[j] - m) ** 2;
    out[i] = Math.sqrt(v / (n - 1));
  }
  return out;
}

// RSI 14 (Wilder): doar context, nu votează
function rsi(c, n = 14) {
  const out = new Array(c.length).fill(NaN);
  let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    if (i <= n) {
      g += Math.max(d, 0); l += Math.max(-d, 0);
      if (i === n) { g /= n; l /= n; out[i] = l ? 100 - 100 / (1 + g / l) : 100; }
    } else {
      g = (g * (n - 1) + Math.max(d, 0)) / n;
      l = (l * (n - 1) + Math.max(-d, 0)) / n;
      out[i] = l ? 100 - 100 / (1 + g / l) : 100;
    }
  }
  return out;
}

const quantile = (sorted, q) => {
  if (!sorted.length) return NaN;
  const p = (sorted.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo);
};

// Starea unei zile: deasupra/sub media de 200 de zile × crescut/scăzut în ultimele 30 de zile
const setupOf = (above, mom) => `${above ? "A" : "B"}${mom ? "+" : "-"}`;

export function analyze(candles, h) {
  const c = candles.map((x) => x.c), t = candles.map((x) => x.t);
  const n = c.length, last = n - 1;
  if (n < WARMUP + 60) return { ok: false, reason: "short", days: n };

  const s200 = sma(c, 200), s50 = sma(c, 50), v20 = vol(c), r14 = rsi(c);
  const setup = new Array(n).fill(null);
  for (let i = WARMUP; i < n; i++) setup[i] = setupOf(c[i] > s200[i], c[i] > c[i - 30]);

  // istoric: zilele care au deja rezultatul după h zile
  let all = 0, allUp = 0;
  const same = [], z = [];
  for (let i = WARMUP; i + h <= last; i++) {
    const f = c[i + h] / c[i] - 1;
    all++; if (f > 0) allUp++;
    if (v20[i] > 0) z.push(Math.log(c[i + h] / c[i]) / (v20[i] * Math.sqrt(h)));
    if (setup[i] === setup[last]) same.push({ i, f });
  }
  // cazuri independente: zile asemănătoare la cel puțin h zile una de alta (ferestrele nu se suprapun)
  let indep = 0, indepUp = 0, lastTaken = -Infinity;
  for (const s of same) if (s.i - lastTaken >= h) { indep++; if (s.f > 0) indepUp++; lastTaken = s.i; }

  const up = same.filter((s) => s.f > 0).length;
  const p = same.length ? up / same.length : NaN;
  const base = all ? allUp / all : NaN;
  const fs = same.map((s) => s.f).sort((a, b) => a - b);

  // intervalul probabil: 80% din mișcările din trecut, scalate la volatilitatea de acum
  z.sort((a, b) => a - b);
  const sd = v20[last] * Math.sqrt(h);
  const lo = c[last] * Math.exp(quantile(z, 0.1) * sd), hi = c[last] * Math.exp(quantile(z, 0.9) * sd);

  // cât de liniștită e piața față de ultimul an (0 = cea mai liniștită zi, 100 = cea mai agitată)
  const yr = v20.slice(Math.max(WARMUP, last - 364), last + 1).filter(isFinite);
  const volPct = Math.round((yr.filter((v) => v < v20[last]).length / yr.length) * 100);

  // verdictul: înclinație doar dacă e clară statistic (față de 50/50, pe cazuri independente)
  const pI = indep ? indepUp / indep : NaN;
  const zScore = indep ? (pI - 0.5) / Math.sqrt(0.25 / indep) : 0;
  let verdict;
  if (indep < MIN_CASES) verdict = "few";
  else if (p >= 0.55 && pI >= 0.55 && zScore >= 1.65) verdict = "up";
  else if (p <= 0.45 && pI <= 0.45 && zScore <= -1.65) verdict = "down";
  else verdict = volPct <= 35 ? "side" : "none";

  const above = c[last] > s200[last], mom = c[last] / c[last - 30] - 1, gold = s50[last] > s200[last];
  const trend = above && mom > 0 && gold ? "up" : !above && mom < 0 && !gold ? "down" : "mixed";

  return {
    ok: true, h, at: t[last], price: c[last], days: n, since: t[WARMUP],
    verdict, trend, setup: setup[last],
    p, base, cases: same.length, indep, pIndep: pI,
    median: quantile(fs, 0.5), lo, hi, volPct,
    dist200: c[last] / s200[last] - 1, mom30: mom, gold, rsi: r14[last],
    sma200: s200, sma50: s50, closes: c, times: t,
  };
}

// Jurnalul public: verdict de ieri → s-a adeverit?
export function score(entry, closeAfter) {
  if (entry.v === "up") return closeAfter > entry.p;
  if (entry.v === "down") return closeAfter < entry.p;
  if (entry.v === "side") return closeAfter >= entry.lo && closeAfter <= entry.hi;
  return null;
}

export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (ms, k) => ms + k * D;
