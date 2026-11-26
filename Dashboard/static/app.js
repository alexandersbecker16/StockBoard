// StockBoard front end — vanilla JS, no build step.
(() => {
  const $ = (id) => document.getElementById(id);
  const SVGNS = "http://www.w3.org/2000/svg";

  const state = {
    watchlist: [],
    quotes: {},          // symbol -> latest quote
    selected: null,
    range: "1d",
    timer: null,
    sort: localStorage.getItem("sb.sort") || "custom",
    interval: localStorage.getItem("sb.interval") || "15",
  };

  // ---------- formatting ----------
  const fmtPrice = (v, cur) => v == null ? "—" :
    v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 }) +
    (cur && cur !== "USD" ? " " + cur : "");
  const fmtSigned = (v, d = 2) => v == null ? "—" : (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(d);
  const fmtVol = (v) => {
    if (v == null) return "—";
    for (const [n, s] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]]) if (v >= n) return (v / n).toFixed(2) + s;
    return String(v);
  };
  const dir = (v) => v == null ? "" : v >= 0 ? "up" : "down";
  const arrow = (v) => v == null ? "" : v >= 0 ? "▲" : "▼";
  const changeText = (q) => `${arrow(q.change)} ${fmtSigned(q.change)} (${fmtSigned(q.changePct)}%)`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- API ----------
  const api = async (path, opts) => {
    const r = await fetch(path, opts);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  };
  const saveWatchlist = () => api("/api/watchlist", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state.watchlist),
  });

  // ---------- refresh loop ----------
  async function refresh() {
    if (!state.watchlist.length) { render(); return; }
    try {
      const list = await api("/api/quotes?symbols=" + encodeURIComponent(state.watchlist.join(",")));
      const prev = state.quotes;
      state.quotes = {};
      for (const q of list) {
        q._flash = prev[q.symbol] && q.price != null && prev[q.symbol].price != null && q.price !== prev[q.symbol].price
          ? (q.price > prev[q.symbol].price ? "flash-up" : "flash-down") : "";
        state.quotes[q.symbol] = q;
      }
      $("updated").textContent = "Updated " + new Date().toLocaleTimeString();
      render();
      if (state.selected) loadChart(true);
    } catch (e) {
      $("updated").textContent = "Update failed: " + e.message;
    }
  }

  function schedule() {
    clearInterval(state.timer);
    const s = Number(state.interval);
    if (s > 0) state.timer = setInterval(refresh, s * 1000);
  }

  // ---------- rendering ----------
  function sortedSymbols() {
    const syms = [...state.watchlist];
    const pct = (s) => state.quotes[s]?.changePct ?? -Infinity;
    if (state.sort === "gain") syms.sort((a, b) => pct(b) - pct(a));
    if (state.sort === "loss") syms.sort((a, b) => (state.quotes[a]?.changePct ?? Infinity) - (state.quotes[b]?.changePct ?? Infinity));
    if (state.sort === "alpha") syms.sort();
    return syms;
  }

  function render() {
    const grid = $("grid");
    grid.innerHTML = "";
    $("empty").hidden = state.watchlist.length > 0;

    for (const sym of sortedSymbols()) {
      const q = state.quotes[sym];
      const card = document.createElement("article");
      card.className = "card" + (sym === state.selected ? " selected" : "");
      card.tabIndex = 0;
      card.onclick = () => select(sym);
      card.onkeydown = (e) => { if (e.key === "Enter") select(sym); };

      if (!q) {
        card.innerHTML = `<div class="c-top"><span class="c-sym">${esc(sym)}</span></div><div class="muted c-name">Loading…</div>`;
      } else if (q.error) {
        card.innerHTML = `<div class="c-top"><span class="c-sym">${esc(sym)}</span></div><div class="c-err">Couldn't load: ${esc(q.error)}</div>`;
      } else {
        card.innerHTML = `
          <div class="c-top"><span class="c-sym">${esc(q.symbol)}</span><span class="c-chg num ${dir(q.change)}">${arrow(q.change)} ${fmtSigned(q.changePct)}%</span></div>
          <div class="c-name" title="${esc(q.name)}">${esc(q.name)}</div>
          <div class="c-price num ${q._flash}">${fmtPrice(q.price, q.currency)}</div>
          <div class="c-chg num ${dir(q.change)}">${fmtSigned(q.change)} today</div>`;
        card.appendChild(sparkline(q.spark, q.prevClose, q.change));
      }

      const rm = document.createElement("button");
      rm.className = "remove";
      rm.title = `Remove ${sym}`;
      rm.setAttribute("aria-label", `Remove ${sym}`);
      rm.textContent = "×";
      rm.onclick = (e) => { e.stopPropagation(); removeSymbol(sym); };
      card.appendChild(rm);
      grid.appendChild(card);
    }

    renderSummary();
    renderMarket();
    if (state.selected) renderDetailHead();
  }

  function renderSummary() {
    const qs = Object.values(state.quotes).filter((q) => !q.error && q.changePct != null);
    const box = $("summary");
    if (!qs.length) { box.innerHTML = ""; return; }
    const up = qs.filter((q) => q.changePct >= 0).length;
    const avg = qs.reduce((s, q) => s + q.changePct, 0) / qs.length;
    const best = qs.reduce((a, b) => (b.changePct > a.changePct ? b : a));
    const worst = qs.reduce((a, b) => (b.changePct < a.changePct ? b : a));
    const tile = (label, value, cls = "") => `<div class="tile"><div class="t-label">${label}</div><div class="t-value num ${cls}">${value}</div></div>`;
    box.innerHTML =
      tile("Tracking", `${qs.length} stocks`) +
      tile("Advancing / declining", `${up} ▲ &nbsp;${qs.length - up} ▼`) +
      tile("Average move", `${arrow(avg)} ${fmtSigned(avg)}%`, dir(avg)) +
      tile("Best today", `${esc(best.symbol)} ${fmtSigned(best.changePct)}%`, dir(best.changePct)) +
      tile("Worst today", `${esc(worst.symbol)} ${fmtSigned(worst.changePct)}%`, dir(worst.changePct));
  }

  function renderMarket() {
    const qs = Object.values(state.quotes).filter((q) => !q.error);
    const open = qs.some((q) => q.marketState === "open");
    const pill = $("market");
    pill.className = "pill " + (qs.length ? (open ? "open" : "closed") : "");
    pill.textContent = qs.length ? (open ? "Market open" : "Market closed") : "—";
  }

  function sparkline(points, prevClose, change) {
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", "0 0 200 48");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    if (!points || points.length < 2) return svg;
    const ys = points.map((p) => p[1]);
    if (prevClose) ys.push(prevClose);
    const min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1;
    const t0 = points[0][0], t1 = points[points.length - 1][0];
    const x = (t) => ((t - t0) / (t1 - t0 || 1)) * 200;
    const y = (v) => 44 - ((v - min) / span) * 40;
    if (prevClose) {
      const base = document.createElementNS(SVGNS, "line");
      Object.entries({ x1: 0, x2: 200, y1: y(prevClose), y2: y(prevClose), stroke: "var(--muted)", "stroke-width": 1, "stroke-dasharray": "2 3", "vector-effect": "non-scaling-stroke", opacity: 0.6 })
        .forEach(([k, v]) => base.setAttribute(k, v));
      svg.appendChild(base);
    }
    const path = document.createElementNS(SVGNS, "path");
    path.setAttribute("d", points.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(""));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", change >= 0 ? "var(--up)" : "var(--down)");
    path.setAttribute("stroke-width", 2);
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(path);
    return svg;
  }

  // ---------- detail panel ----------
  function select(sym) {
    if (state.selected === sym) { state.selected = null; $("detail").hidden = true; render(); return; }
    state.selected = sym;
    $("detail").hidden = false;
    render();
    loadChart();
    $("detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderDetailHead() {
    const q = state.quotes[state.selected];
    $("d-symbol").textContent = state.selected;
    if (!q || q.error) { $("d-name").textContent = q?.error || ""; return; }
    $("d-name").textContent = `${q.name} · ${q.exchange || ""}`;
    $("d-price").textContent = fmtPrice(q.price, q.currency);
    $("d-price").className = "d-price num";
    $("d-change").className = "num " + dir(q.change);
    $("d-change").textContent = changeText(q) + " today";
    const stat = (k, v) => `<div><dt>${k}</dt><dd class="num">${v}</dd></div>`;
    $("d-stats").innerHTML =
      stat("Previous close", fmtPrice(q.prevClose)) +
      stat("Day range", `${fmtPrice(q.dayLow)} – ${fmtPrice(q.dayHigh)}`) +
      stat("52-week range", `${fmtPrice(q.low52)} – ${fmtPrice(q.high52)}`) +
      stat("Volume", fmtVol(q.volume)) +
      stat("Last trade", q.marketTime ? new Date(q.marketTime * 1000).toLocaleString() : "—");
  }

  let chartReq = 0;
  async function loadChart(quiet = false) {
    const sym = state.selected, range = state.range, id = ++chartReq;
    if (!quiet) $("chart").innerHTML = "";
    try {
      const data = await api(`/api/chart?symbol=${encodeURIComponent(sym)}&range=${range}`);
      if (id !== chartReq) return;   // a newer request superseded this one
      drawChart(data);
    } catch (e) {
      if (id === chartReq) $("chart").innerHTML = `<text x="16" y="30">Couldn't load chart: ${esc(e.message)}</text>`;
    }
  }

  function drawChart({ points, prevClose, range }) {
    const svg = $("chart");
    const W = svg.clientWidth || 800, H = svg.clientHeight || 320;
    const m = { l: 8, r: 64, t: 12, b: 26 };
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = "";
    if (!points.length) { svg.innerHTML = `<text x="16" y="30">No data for this range.</text>`; return; }

    // For the 1-day view compare to previous close; otherwise to the first point.
    const base = range === "1d" && prevClose ? prevClose : points[0][1];
    const last = points[points.length - 1][1];
    const color = last >= base ? "var(--up)" : "var(--down)";
    const ys = points.map((p) => p[1]).concat(range === "1d" && prevClose ? [prevClose] : []);
    let min = Math.min(...ys), max = Math.max(...ys);
    const pad = (max - min) * 0.08 || 1; min -= pad; max += pad;

    const n = points.length;
    // Use index-based x so overnight/weekend gaps don't leave empty stretches.
    const x = (i) => m.l + (i / (n - 1 || 1)) * (W - m.l - m.r);
    const y = (v) => m.t + (1 - (v - min) / (max - min)) * (H - m.t - m.b);
    const el = (tag, attrs, text) => {
      const e = document.createElementNS(SVGNS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      if (text != null) e.textContent = text;
      svg.appendChild(e);
      return e;
    };

    // grid + y labels
    const ticks = niceTicks(min, max, 5);
    for (const t of ticks) {
      el("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), stroke: "var(--grid)", "stroke-width": 1 });
      el("text", { x: W - m.r + 8, y: y(t) + 4 }, t.toLocaleString(undefined, { maximumFractionDigits: 2 }));
    }
    // x labels
    const fmtX = (t) => {
      const d = new Date(t * 1000);
      if (range === "1d") return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      if (range === "5d") return d.toLocaleDateString([], { weekday: "short" });
      if (range === "5y") return d.toLocaleDateString([], { year: "numeric" });
      return d.toLocaleDateString([], { month: "short", day: "numeric" });
    };
    const xCount = Math.max(2, Math.min(6, Math.floor((W - m.l - m.r) / 110)));
    for (let k = 0; k < xCount; k++) {
      const i = Math.round((k / (xCount - 1)) * (n - 1));
      el("text", { x: x(i), y: H - 6, "text-anchor": k === 0 ? "start" : k === xCount - 1 ? "end" : "middle" }, fmtX(points[i][0]));
    }
    // baseline
    if (range === "1d" && prevClose) {
      el("line", { x1: m.l, x2: W - m.r, y1: y(prevClose), y2: y(prevClose), stroke: "var(--muted)", "stroke-dasharray": "3 4", "stroke-width": 1 });
      el("text", { x: m.l + 4, y: y(prevClose) - 5 }, "Prev close " + fmtPrice(prevClose));
    }
    // area + line
    const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
    el("path", { d: `${d}L${x(n - 1)},${H - m.b}L${x(0)},${H - m.b}Z`, fill: color, opacity: 0.08 });
    el("path", { d, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round" });

    // hover crosshair + tooltip
    const cross = el("line", { y1: m.t, y2: H - m.b, stroke: "var(--muted)", "stroke-width": 1, visibility: "hidden" });
    const dot = el("circle", { r: 4.5, fill: color, stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden" });
    const hit = el("rect", { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: "transparent" });
    const tip = $("tip");
    const fmtTip = (t) => {
      const dt = new Date(t * 1000);
      return range === "1d" || range === "5d"
        ? dt.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })
        : dt.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
    };
    hit.onmousemove = (e) => {
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / (W - m.l - m.r)) * (n - 1))));
      const [t, v] = points[i];
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i));
      dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(v));
      cross.setAttribute("visibility", "visible"); dot.setAttribute("visibility", "visible");
      const chg = v - base, pct = (chg / base) * 100;
      tip.innerHTML = `<b class="num">${fmtPrice(v)}</b><span class="num ${dir(chg)}">${arrow(chg)} ${fmtSigned(chg)} (${fmtSigned(pct)}%)</span><br><span class="muted">${fmtTip(t)}</span>`;
      tip.hidden = false;
      const sx = (x(i) / W) * rect.width, sy = (y(v) / H) * rect.height;
      const tw = tip.offsetWidth;
      tip.style.left = (sx + 12 + tw > rect.width ? sx - tw - 12 : sx + 12) + "px";
      tip.style.top = Math.max(0, sy - 50) + "px";
    };
    hit.onmouseleave = () => {
      cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tip.hidden = true;
    };
  }

  function niceTicks(min, max, count) {
    const span = max - min, raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) || raw;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(+v.toFixed(10));
    return out;
  }

  // ---------- watchlist edits ----------
  async function addSymbol(sym) {
    sym = sym.trim().toUpperCase();
    if (!sym) return;
    if (!state.watchlist.includes(sym)) {
      state.watchlist.push(sym);
      render();
      await saveWatchlist();
      await refresh();
    }
    select(sym);
  }

  async function removeSymbol(sym) {
    state.watchlist = state.watchlist.filter((s) => s !== sym);
    delete state.quotes[sym];
    if (state.selected === sym) { state.selected = null; $("detail").hidden = true; }
    render();
    await saveWatchlist();
  }

  // ---------- search box ----------
  let searchTimer, results = [], active = -1;
  const input = $("search"), list = $("results");
  function showResults() {
    list.innerHTML = results.map((r, i) =>
      `<li data-i="${i}" class="${i === active ? "active" : ""}"><span class="r-sym">${esc(r.symbol)}</span><span class="r-name">${esc(r.name)}</span><span class="r-ex">${esc(r.exchange)} ${esc(r.type)}</span></li>`
    ).join("");
    list.hidden = !results.length;
  }
  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (!q) { results = []; showResults(); return; }
    searchTimer = setTimeout(async () => {
      try { results = await api("/api/search?q=" + encodeURIComponent(q)); } catch { results = []; }
      active = results.length ? 0 : -1;
      showResults();
    }, 200);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { active = Math.min(results.length - 1, active + 1); showResults(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); showResults(); e.preventDefault(); }
    else if (e.key === "Escape") { results = []; showResults(); }
    else if (e.key === "Enter") {
      const pick = results[active]?.symbol || input.value;
      input.value = ""; results = []; showResults();
      addSymbol(pick);
    }
  });
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    e.preventDefault();
    const pick = results[+li.dataset.i].symbol;
    input.value = ""; results = []; showResults();
    addSymbol(pick);
  });
  input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; }, 100));
  input.addEventListener("focus", () => { if (results.length) list.hidden = false; });

  // ---------- controls ----------
  $("sort").value = state.sort;
  $("sort").onchange = (e) => { state.sort = e.target.value; localStorage.setItem("sb.sort", state.sort); render(); };
  $("interval").value = state.interval;
  $("interval").onchange = (e) => { state.interval = e.target.value; localStorage.setItem("sb.interval", state.interval); schedule(); };
  $("ranges").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.range = b.dataset.range;
    [...$("ranges").children].forEach((x) => x.classList.toggle("on", x === b));
    loadChart();
  };
  let resizeT;
  window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => state.selected && loadChart(true), 150); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });

  // ---------- boot ----------
  (async () => {
    try { state.watchlist = await api("/api/watchlist"); } catch { state.watchlist = []; }
    render();
    await refresh();
    schedule();
  })();
})();
