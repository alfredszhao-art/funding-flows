/* Funding Flows — client. Vanilla JS, no build step, runs from file://.
   All text from data is inserted with textContent (never innerHTML). */
(function () {
  "use strict";

  const D = window.DATA || { grants: [], pipeline: [], sources: [], movement: [], generated: "" };
  const RM = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /* ---------- tiny DOM builders ---------- */
  function add(e, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(x => add(e, x));
    else e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function build(e, attrs, kids) {
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") e.setAttribute("class", v);
      else if (k === "style") e.style.cssText = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (let i = 0; i < kids.length; i++) add(e, kids[i]);
    return e;
  }
  const h = (tag, attrs, ...kids) => build(document.createElement(tag), attrs, kids);
  // Clear an element and add children; arrays are flattened (replaceChildren would stringify them).
  function fill(el, ...kids) { el.replaceChildren(); kids.forEach(k => add(el, k)); }
  const sv = (tag, attrs, ...kids) => build(document.createElementNS("http://www.w3.org/2000/svg", tag), attrs, kids);

  /* ---------- formatting ---------- */
  const t1 = x => (Math.round(x * 10) / 10).toString();
  function fmtUSD(n) {
    const a = Math.abs(n || 0);
    if (a >= 1e9) return "$" + t1(n / 1e9) + "B";
    if (a >= 1e6) return "$" + t1(n / 1e6) + "M";
    if (a >= 1e3) return "$" + Math.round(n / 1e3) + "k";
    return "$" + Math.round(n || 0);
  }
  const clip = (s, n) => (s || "").length > n ? s.slice(0, n - 1) + "…" : (s || "");
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(g) {
    const d = g && g.date; if (!d) return (g && g.year) || "—";
    const y = d.slice(0, 4), m = +d.slice(5, 7), p = g.prec;
    if (p === "quarter") return "Q" + Math.ceil(m / 3) + " " + y;
    if (p === "half") return (m <= 6 ? "H1 " : "H2 ") + y;
    if (p === "year") return y;
    return MON[m - 1] + " " + y;
  }
  const fmtDay = iso => MON[+iso.slice(5, 7) - 1] + " " + (+iso.slice(8, 10));

  /* ---------- time ---------- */
  const dayN = d => Date.parse(d + "T00:00:00Z") / 864e5;
  const yearOf = n => new Date(n * 864e5).getUTCFullYear();
  const SNAP = D.generated || new Date().toISOString().slice(0, 10);
  const NOW = Math.max(Math.floor(Date.now() / 864e5), dayN(SNAP));
  // "Last 12 months" = the 12 calendar months ending with the snapshot month.
  const CUT = (function () {
    let y = +SNAP.slice(0, 4), m = +SNAP.slice(5, 7) + 1;
    if (m > 12) { m = 1; y += 1; }
    return (y - 1) + "-" + String(m).padStart(2, "0") + "-01";
  })();
  const PRIOR = (+CUT.slice(0, 4) - 1) + CUT.slice(4);
  const periodLabel = () => MON[+CUT.slice(5, 7) - 1] + " " + CUT.slice(0, 4) + " – " + MON[+SNAP.slice(5, 7) - 1] + " " + SNAP.slice(0, 4);

  /* ---------- series (cause areas) ---------- */
  const SERIES = [
    { id: "animal_welfare", label: "Animal welfare", cls: "c-animal_welfare" },
    { id: "ai_safety", label: "AI safety", cls: "c-ai_safety" },
    { id: "misc", label: "Digital minds & other", cls: "c-x" }
  ];
  const SBY = {}; SERIES.forEach(s => { SBY[s.id] = s; });
  const SID = { animal_welfare: "animal_welfare", ai_safety: "ai_safety", digital_minds: "misc", other: "misc" };
  D.grants.forEach(g => {
    g.s = SID[g.cause] || "misc";
    g.t = dayN(g.date || (g.year + "-01-01"));
    if (!isFinite(g.t)) g.t = dayN("2000-01-01");
  });
  const FOCUS = g => g.s === "animal_welfare";
  const SPECIES_TAGS = new Set(["chickens", "fish", "shrimp", "crustaceans", "pigs", "cattle", "insects", "wild", "aquatic"]);

  /* ---------- state ---------- */
  const S = { period: "12m", on: { animal_welfare: true, ai_safety: false, misc: false }, fsort: "vol", domain: "animal_welfare" };
  // The homepage switch: it presets the Causes filter and drives the headline figures.
  const DOMAINS = {
    animal_welfare: { label: "Animal welfare", noun: "animal welfare",
      caveat: "Public records only: some large funders publish no grant list, so these figures are a floor, not the whole movement. " },
    ai_safety: { label: "AI safety", noun: "AI safety",
      caveat: "Public records only, and “AI safety” is broad here: it includes the existential-risk and governance work of funders such as SFF and the Long-Term Future Fund. Some programmes publish totals but no per-grant amounts, so these figures are a floor. " }
  };
  const sel = g => S.on[g.s];
  const inP = g => S.period === "all" || g.date >= CUT;
  let VIEW = "overview", tableMode = false;

  /* ---------- tooltip ---------- */
  const tip = $("#tip");
  function showTip(e, node) { tip.replaceChildren(node); tip.style.opacity = 1; moveTip(e); }
  function moveTip(e) {
    const pad = 14, w = tip.offsetWidth, hh = tip.offsetHeight;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + w > innerWidth - 8) x = e.clientX - w - pad;
    if (y + hh > innerHeight - 8) y = e.clientY - hh - pad;
    tip.style.transform = "translate(" + Math.max(4, x) + "px," + Math.max(4, y) + "px)";
  }
  const hideTip = () => { tip.style.opacity = 0; };

  /* ---------- motion helpers ---------- */
  function countUp(el, to, fmt, ms) {
    if (RM) { el.textContent = fmt(to); return; }
    const t0 = performance.now(); ms = ms || 1500;
    (function f(now) {
      const p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 4);
      el.textContent = fmt(to * e);
      if (p < 1) requestAnimationFrame(f);
    })(t0);
  }
  function playOnVisible(el, fn) {
    const r = el.getBoundingClientRect();
    if ((r.top < innerHeight * 0.85 && r.bottom > 0) || !("IntersectionObserver" in window)) { requestAnimationFrame(fn); return; }
    const o = new IntersectionObserver(es => { if (es[0].isIntersecting) { o.disconnect(); fn(); } }, { threshold: 0.12 });
    o.observe(el);
  }
  const io = "IntersectionObserver" in window
    ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.06 })
    : null;
  $$(".rv").forEach(el => { if (io) io.observe(el); else el.classList.add("in"); });
  const niceMax = m => { const p = Math.pow(10, Math.floor(Math.log10(m))), r = m / p; return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p; };

  /* ---------- open calls (shared by overview, funders, pipeline) ---------- */
  // Pipeline rows follow the Causes filter; rows whose cause is not stated (large pledges) always show.
  const pipeVisible = p => p.cause === "unspecified" || !!S.on[SID[p.cause] || "misc"];
  function causeTag(p) {
    const multi = SERIES.filter(x => S.on[x.id]).length > 1;
    if (p.cause === "unspecified") return "Cause not stated";
    return multi ? SBY[SID[p.cause] || "misc"].label : "";
  }
  function openCalls(keep) {
    return D.pipeline.filter(p => p.tier === "open_call" && (keep || pipeVisible)(p)).map(p => {
      const dl = p.deadline ? dayN(p.deadline) : null;
      return Object.assign({}, p, { dl: dl, days: dl != null ? Math.round(dl - NOW) : null });
    }).filter(p => p.days == null || p.days >= 0)
      .sort((a, b) => ord(a) - ord(b));
  }
  const ord = p => p.days != null ? p.days : (p.status === "open" ? 5000 : 9000);
  function amtText(p) {
    if (!p.high) return "Amount not stated";
    return p.low && p.low !== p.high ? fmtUSD(p.low) + "–" + fmtUSD(p.high) : fmtUSD(p.high);
  }

  /* ================= FILTER STRIP (one row, above everything it scopes) ================= */
  function buildFilters() {
    const note = S.period === "12m" ? periodLabel() : "All years on record";
    $$("[data-filters]").forEach(host => {
      const causesOnly = host.getAttribute("data-filters") === "causes";
      host.replaceChildren(h("div", { class: "filters" },
        causesOnly ? null : h("div", { class: "fgrp" }, h("span", { class: "lab" }, "Period"),
          h("button", { class: "t" + (S.period === "12m" ? " on" : ""), type: "button", onclick: () => setPeriod("12m") }, "Last 12 months"),
          h("button", { class: "t" + (S.period === "all" ? " on" : ""), type: "button", onclick: () => setPeriod("all") }, "All time")),
        h("div", { class: "fgrp" }, h("span", { class: "lab" }, "Causes"),
          SERIES.map(s => h("button", {
            class: "cz " + s.cls + (S.on[s.id] ? " on" : ""), type: "button", "aria-pressed": S.on[s.id] ? "true" : "false",
            onclick: () => toggleSeries(s.id)
          }, h("i"), s.label))),
        causesOnly ? null : h("span", { class: "fnote" }, note)));
    });
  }
  function setPeriod(p) { S.period = p; buildFilters(); rerender("period"); }
  function toggleSeries(id) {
    const on = SERIES.filter(s => S.on[s.id]).length;
    if (S.on[id] && on === 1) return;           // never show an empty selection
    S.on[id] = !S.on[id];
    if (!S.on[S.domain]) {                       // the headline's cause was switched off: follow what is still selected
      const d = S.on.animal_welfare ? "animal_welfare" : S.on.ai_safety ? "ai_safety" : null;
      if (d) { S.domain = d; syncDomainUI(); renderHero(true); }
    }
    buildFilters(); rerender("causes");
  }
  function rerender(kind) {
    if (VIEW === "overview") {
      if (kind === "period") { swarmPeriod(); renderDomainBlock(); }
      else { renderSwarm(); renderAnnual(); renderDomainBlock(); renderTeaser(); }
    } else if (VIEW === "funders") { renderFSort(); renderLedger(); }
    else if (VIEW === "pipeline") renderPipeline();
    else if (VIEW === "grants") { G.page = 1; renderGrants(); }
  }

  /* ================= OVERVIEW: HERO ================= */
  function renderHero(restart) {
    const dom = S.domain, DM = DOMAINS[dom];
    const foc = D.grants.filter(g => !g.regrant && g.s === dom);
    const cur = foc.filter(g => g.date >= CUT), prev = foc.filter(g => g.date >= PRIOR && g.date < CUT);
    const sum = a => a.reduce((s, g) => s + g.amount, 0);
    const tot = sum(cur), ptot = sum(prev);
    const by = {}; cur.forEach(g => { by[g.funder] = (by[g.funder] || 0) + g.amount; });
    const ranked = Object.keys(by).sort((a, b) => by[b] - by[a]);
    const share = ranked.length ? Math.round(by[ranked[0]] / tot * 100) : 0;
    if (restart) ["#heroNum", "#heroSub", "#heroText"].forEach(id => { const el = $(id); el.classList.remove("rise"); void el.offsetWidth; el.classList.add("rise"); });
    countUp($("#heroNum"), tot, fmtUSD, 1700);
    $("#heroSub").textContent = "disclosed over the last twelve months for " + DM.noun + ".";

    const num = (v, fmt) => { const s = h("b", null, fmt ? fmt(0) : "0"); countUp(s, v, fmt || (x => Math.round(x).toLocaleString()), 1400); return s; };
    const oc = openCalls(p => p.cause === dom).filter(p => p.status === "open");
    const next = oc.find(p => p.days != null);
    const parts = [];
    if (ranked.length) parts.push(h("p", null, h("b", null, ranked[0]), " accounts for ", num(share, x => Math.round(x) + "%"),
      " of it. ", num(ranked.length), ranked.length === 1 ? " funder made " : " funders made ", num(cur.length), " grants in all", ptot ? "; " + fmtUSD(ptot) + " was disclosed in the twelve months before." : "."));
    if (oc.length) parts.push(h("p", null, num(oc.length), oc.length === 1 ? " call is open for applications right now" : " calls are open for applications right now",
      next ? [" — the nearest, ", h("b", null, next.name), ", closes in " + next.days + (next.days === 1 ? " day" : " days") + "."]
           : (oc.every(p => p.days == null) ? " — all rolling, with no deadline." : "."),
      " ", h("a", { href: "#pipeline", "data-goto": "pipeline" }, "See what is open →")));
    parts.push(h("p", { class: "fine", style: "font-family:var(--serif);font-size:14px" }, DM.caveat,
      h("a", { href: "#method", "data-goto": "method" }, "What is and is not covered")));
    fill($("#heroText"), ...parts);
  }

  /* ---------- the homepage domain switch ---------- */
  function syncDomainUI() {
    $$("#domainSwitch .dom").forEach(b => {
      const on = b.getAttribute("data-domain") === S.domain;
      b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.title = "Funding Flows — who funds " + DOMAINS[S.domain].noun + ", and what is open now";
    const animal = S.domain === "animal_welfare";
    // Species and the whole-movement estimates only exist for animals; the AI view shows the biggest recipients instead.
    $("#speciesBlk").hidden = !animal; $("#ctxBlk").hidden = !animal; $("#recipientsBlk").hidden = animal;
  }
  function setDomain(d) {
    if (!DOMAINS[d] || d === S.domain) return;
    S.domain = d; S.on = { animal_welfare: d === "animal_welfare", ai_safety: d === "ai_safety", misc: false };
    syncDomainUI(); buildFilters(); renderHero(true);
    if (VIEW === "overview") renderOverview();
  }
  const renderDomainBlock = () => { if (S.domain === "animal_welfare") renderSpecies(); else renderRecipients(); };
  function renderRecipients() {
    const host = $("#recipients"); host.replaceChildren(); host.classList.remove("go");
    const m = {};
    D.grants.forEach(g => { if (g.regrant || !sel(g) || !inP(g) || /^various\b/i.test(g.grantee)) return; const o = m[g.grantee] || (m[g.grantee] = { t: 0, n: 0 }); o.t += g.amount; o.n++; });
    const rows = Object.keys(m).sort((a, b) => m[b].t - m[a].t).slice(0, 8);
    if (!rows.length) { host.append(h("p", { class: "fine", style: "grid-column:1/-1" }, "No grants in this selection.")); return; }
    const max = m[rows[0]].t;
    rows.forEach((k, i) => {
      host.append(h("div", { class: "n", title: k + " · " + m[k].n + (m[k].n === 1 ? " grant" : " grants") }, k),
        h("div", { class: "tr" }, h("div", { class: "bar", style: "--w:" + (m[k].t / max).toFixed(4) + ";--i:" + i }), h("span", { class: "v" }, fmtUSD(m[k].t))));
    });
    if (RM) host.classList.add("go"); else playOnVisible(host, () => host.classList.add("go"));
  }

  /* ================= OVERVIEW: EVERY GRANT AS A DOT ================= */
  const SW = { all: [], rows: [] };
  function beeswarm(pts, pad) {
    const placed = []; let lo = 0;
    pts.forEach(p => {
      while (lo < placed.length && placed[lo].x < p.x - (8 + p.r + pad)) lo++;
      const near = placed.slice(lo);
      const free = y => near.every(q => { const dx = p.x - q.x, dy = y - q.y, d = p.r + q.r + pad; return dx * dx + dy * dy >= d * d - 0.01; });
      if (free(0)) p.y = 0;
      else {
        let best = null;
        near.forEach(q => {
          const dx = p.x - q.x, d = p.r + q.r + pad;
          if (Math.abs(dx) < d) {
            const dy = Math.sqrt(d * d - dx * dx);
            [q.y + dy, q.y - dy].forEach(y => { if ((best === null || Math.abs(y) < Math.abs(best)) && free(y)) best = y; });
          }
        });
        p.y = best === null ? 0 : best;
      }
      placed.push(p);
    });
  }
  function dotTip(g) {
    return h("div", null,
      h("strong", null, fmtUSD(g.amount)),
      h("span", { class: "t2" }, g.grantee),
      g.title && g.title !== g.grantee ? h("span", { class: "t3" }, clip(g.title, 150)) : null,
      h("span", { class: "t3" }, [g.funder, fmtDate(g) + (g.prec === "created" ? " (project created)" : ""), SBY[g.s].label].join(" · ")),
      g.regrant ? h("span", { class: "t3" }, "Regrant — passed to another grantmaker, so not counted in any total") : null);
  }
  function swarmMeta(f) {
    const per = f.list.filter(g => !g.regrant && g.date >= CUT).reduce((s, g) => s + g.amount, 0);
    const all = f.n.toLocaleString() + " grants · " + fmtUSD(f.total) + " in total";
    return S.period === "12m" ? fmtUSD(per) + " in the last 12 months · " + all : all;
  }
  function renderSwarm(instant) {
    const host = $("#swarm"); host.replaceChildren(); hideTip();
    fill($("#swarmKey"), 
      SERIES.filter(s => S.on[s.id]).map(s => h("span", { class: "key " + s.cls }, h("i"), s.label)),
      h("span", { class: "key hollow" }, h("i"), "Regrant (not counted)"));
    SW.all = []; SW.rows = [];
    const W = Math.floor(host.clientWidth) || 800, narrow = W < 560;
    const padL = 2, padR = 4, innerW = W - padL - padR;
    const grants = D.grants.filter(sel);
    const by = new Map();
    grants.forEach(g => {
      let f = by.get(g.funder); if (!f) { f = { name: g.funder, list: [], total: 0, n: 0 }; by.set(g.funder, f); }
      f.list.push(g); if (!g.regrant) { f.total += g.amount; f.n++; }
    });
    const rows = Array.from(by.values()).filter(f => f.n > 0).sort((a, b) => b.total - a.total);
    if (!rows.length) { host.append(h("p", { class: "fine" }, "Nothing to show for this selection.")); return; }

    let tMin = Infinity; grants.forEach(g => { if (g.t < tMin) tMin = g.t; });
    const y0 = yearOf(tMin), yEnd = yearOf(NOW);
    const tA = dayN(y0 + "-01-01"), tB = dayN(yEnd + "-12-31");
    const X = t => padL + (t - tA) / (tB - tA) * innerW;
    const R = a => 1.8 + 5.2 * Math.sqrt(Math.min(a, 5e6) / 5e6);
    const hH = narrow ? 40 : 26;

    let cursor = 30; const laid = [];
    rows.forEach(f => {
      const pts = f.list.map(g => ({ g: g, x: X(g.t), r: R(g.amount) })).sort((a, b) => a.x - b.x || b.g.amount - a.g.amount);
      beeswarm(pts, 1.2);
      let mn = 0, mx = 0; pts.forEach(p => { mn = Math.min(mn, p.y - p.r); mx = Math.max(mx, p.y + p.r); });
      // Funders that publish a whole round on one date make very tall columns: squeeze those rows (dots may overlap a little).
      if (mx - mn > 124) {
        const k = 124 / (mx - mn); mn = 0; mx = 0;
        pts.forEach(p => { p.y *= k; mn = Math.min(mn, p.y - p.r); mx = Math.max(mx, p.y + p.r); });
      }
      const inner = Math.max(40, mx - mn + 14);
      laid.push({ f: f, pts: pts, top: cursor, yC: cursor + hH + 7 - mn });
      cursor += hH + inner + 20;
    });
    const axisY = cursor, H = axisY + 26;
    const svg = sv("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Every disclosed grant as a dot, one row per funder, over time" });
    const clipRect = sv("rect", { x: 0, y: 0, width: 0, height: H });
    svg.append(sv("defs", null, sv("clipPath", { id: "sweep" }, clipRect)));

    // period band + year gridlines
    const band = sv("rect", { class: "band", x: X(dayN(CUT)), y: 16, width: Math.max(0, X(NOW) - X(dayN(CUT))), height: axisY - 16 });
    const bandL = sv("text", { class: "band-l", x: X(NOW), y: 10, "text-anchor": "end" }, "Last 12 months");
    svg.append(band, bandL);
    const step = W < 420 ? 3 : W < 700 ? 2 : 1;
    for (let y = y0; y <= yEnd; y++) {
      const x = X(dayN(y + "-01-01"));
      svg.append(sv("line", { class: "gl", x1: x, x2: x, y1: 16, y2: axisY }));
      if ((y - y0) % step === 0 || y === yEnd) svg.append(sv("text", { class: "ax", x: x + 3, y: axisY + 16 }, String(y)));
    }
    // row headers and baselines
    laid.forEach(rl => {
      svg.append(sv("line", { class: "gl", x1: 0, x2: W, y1: rl.yC, y2: rl.yC, style: "opacity:.55" }));
      svg.append(sv("text", { class: "rh-name", x: padL, y: rl.top + 16 }, rl.f.name));
      rl.metaEl = sv("text", narrow ? { class: "rh-meta", x: padL, y: rl.top + 33 } : { class: "rh-meta", x: W - padR, y: rl.top + 16, "text-anchor": "end" }, swarmMeta(rl.f));
      svg.append(rl.metaEl);
    });
    // dots, big first so small ones stay visible on top
    const dotsG = sv("g", { "clip-path": "url(#sweep)" });
    laid.forEach(rl => {
      rl.pts.forEach(p => { p.cx = p.x; p.cy = rl.yC + p.y; });
      rl.pts.slice().sort((a, b) => b.r - a.r).forEach(p => {
        p.el = sv("circle", { cx: p.cx.toFixed(1), cy: p.cy.toFixed(1), r: p.r.toFixed(2), class: "dot " + SBY[p.g.s].cls + (p.g.regrant ? " ring" : "") });
        dotsG.append(p.el); SW.all.push(p);
      });
    });
    const ring = sv("circle", { class: "hov", r: 0, cx: -20, cy: -20 });
    svg.append(dotsG, ring);
    host.append(svg);
    Object.assign(SW, { svg: svg, band: band, bandL: bandL, laid: laid, clip: clipRect, W: W, ring: ring });
    swarmPeriod();

    function nearest(px, py) {
      let best = null, bd = 1e9;
      for (let i = 0; i < SW.all.length; i++) { const p = SW.all[i], dx = p.cx - px, dy = p.cy - py, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = p; } }
      return best && bd <= Math.pow(Math.max(best.r + 7, 14), 2) ? best : null;
    }
    svg.addEventListener("pointermove", e => {
      const r = svg.getBoundingClientRect(), p = nearest(e.clientX - r.left, e.clientY - r.top);
      if (!p) { ring.setAttribute("r", 0); hideTip(); svg.style.cursor = "default"; return; }
      ring.setAttribute("cx", p.cx); ring.setAttribute("cy", p.cy); ring.setAttribute("r", p.r + 3);
      svg.style.cursor = "pointer"; showTip(e, dotTip(p.g));
    });
    svg.addEventListener("pointerleave", () => { ring.setAttribute("r", 0); hideTip(); });
    svg.addEventListener("click", e => {
      const r = svg.getBoundingClientRect(), p = nearest(e.clientX - r.left, e.clientY - r.top);
      if (p && p.g.url) window.open(p.g.url, "_blank", "noopener");
    });

    function sweep(ms) {
      if (RM || instant) { clipRect.setAttribute("width", W); return; }
      const t0 = performance.now();
      (function f(now) {
        const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
        clipRect.setAttribute("width", (W * e).toFixed(1));
        if (k < 1) requestAnimationFrame(f);
      })(t0);
    }
    if (instant) sweep(0); else playOnVisible(host, () => sweep(1800));
  }
  // The layout only depends on the causes chosen; the period just fades older dots.
  function swarmPeriod() {
    if (!SW.laid) return;
    const twelve = S.period === "12m";
    SW.band.style.opacity = twelve ? 1 : 0; SW.bandL.style.opacity = twelve ? 1 : 0;
    SW.all.forEach(p => p.el.classList.toggle("dim", twelve && p.g.date < CUT));
    SW.laid.forEach(rl => { rl.metaEl.textContent = swarmMeta(rl.f); });
  }

  /* ================= OVERVIEW: YEAR BY YEAR ================= */
  function segPath(x, y, w, hh, r) {
    if (r && hh > r * 2) return "M" + x + "," + (y + hh) + "L" + x + "," + (y + r) + "Q" + x + "," + y + " " + (x + r) + "," + y + "L" + (x + w - r) + "," + y + "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + r) + "L" + (x + w) + "," + (y + hh) + "Z";
    return "M" + x + "," + y + "h" + w + "v" + hh + "h" + (-w) + "Z";
  }
  function renderAnnual(instant) {
    const host = $("#annual"); host.replaceChildren(); host.classList.remove("go", "hv", "still"); hideTip();
    const ser = SERIES.filter(s => S.on[s.id]);
    fill($("#annualKey"), (tableMode || ser.length < 2) ? null : ser.map(s => h("span", { class: "key " + s.cls }, h("i"), s.label)));
    $("#tblBtn").textContent = tableMode ? "Chart view" : "Table view";
    const by = {};
    D.grants.forEach(g => { if (g.regrant || !S.on[g.s] || !g.year) return; const y = by[g.year] || (by[g.year] = {}); y[g.s] = (y[g.s] || 0) + g.amount; });
    const ys = Object.keys(by).map(Number).sort((a, b) => a - b);
    if (!ys.length) { host.append(h("p", { class: "fine" }, "Nothing to show for this selection.")); return; }
    const years = []; for (let y = ys[0]; y <= ys[ys.length - 1]; y++) years.push(y);
    const tot = y => Object.keys(by[y] || {}).reduce((a, k) => a + by[y][k], 0);
    const last = years[years.length - 1];
    $("#annualNote").textContent = last + "* is the year to date. Grants dated only to a quarter or year sit at the start of it, and a few funders’ early years are incomplete — see Method.";

    if (tableMode) {
      host.append(h("table", { class: "plain" },
        h("thead", null, h("tr", null, h("th", null, "Year"), ser.map(s => h("th", null, s.label)), h("th", null, "Total"))),
        h("tbody", null, years.slice().reverse().map(y => h("tr", null, h("td", null, y + (y === last ? "*" : "")),
          ser.map(s => h("td", null, by[y] && by[y][s.id] ? fmtUSD(by[y][s.id]) : "—")), h("td", null, fmtUSD(tot(y))))))));
      return;
    }
    const W = Math.floor(host.clientWidth) || 800, plotH = 270, padT = 30, padB = 28, padL = 50, padR = 6, H = padT + plotH + padB;
    const max = niceMax(Math.max.apply(null, years.map(tot).concat([1])));
    const slot = (W - padL - padR) / years.length, bw = Math.min(24, slot * 0.58);
    const svg = sv("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Disclosed grants per year, stacked by cause" });
    for (let i = 0; i <= 4; i++) {
      const y = padT + plotH - plotH * i / 4;
      svg.append(sv("line", { class: "gl", x1: padL, x2: W - padR, y1: y, y2: y }), sv("text", { class: "ax", x: padL - 8, y: y + 4, "text-anchor": "end" }, fmtUSD(max * i / 4)));
    }
    const peak = years.reduce((a, y) => tot(y) > tot(a) ? y : a, years[0]);
    const labelStep = slot < 34 ? 2 : 1, cols = [];
    years.forEach((y, i) => {
      const cx = padL + slot * i + slot / 2, x = cx - bw / 2;
      const g = sv("g", { class: "col", style: "--i:" + i });
      const present = ser.filter(s => (by[y] || {})[s.id] > 0);
      let acc = 0;
      present.forEach((s, k) => {
        const v = by[y][s.id], top = padT + plotH - plotH * (acc + v) / max, bot = padT + plotH - plotH * acc / max - (k > 0 ? 2 : 0);
        acc += v;
        g.append(sv("path", { class: "seg " + s.cls, d: segPath(x, top, bw, Math.max(1.5, bot - top), k === present.length - 1 ? 4 : 0) }));
      });
      svg.append(g); cols.push(g);
      if (y === peak || y === last) svg.append(sv("text", { class: "tot", x: cx, y: padT + plotH - plotH * tot(y) / max - 8, "text-anchor": "middle" }, fmtUSD(tot(y))));
      if (i % labelStep === 0 || y === last) svg.append(sv("text", { class: "ax", x: cx, y: H - 8, "text-anchor": "middle" }, (slot < 30 ? "’" + String(y).slice(2) : y) + (y === last ? "*" : "")));
    });
    years.forEach((y, i) => {
      const hit = sv("rect", { x: padL + slot * i, y: 0, width: slot, height: plotH + padT, fill: "transparent", tabindex: "0", "aria-label": y + ": " + fmtUSD(tot(y)) });
      const show = (e) => {
        host.classList.add("hv"); cols.forEach((c, j) => c.classList.toggle("hot", j === i));
        showTip(e, h("div", null, h("strong", null, fmtUSD(tot(y))), h("span", { class: "t2" }, y + (y === last ? " (year to date)" : "")),
          ser.filter(s => (by[y] || {})[s.id] > 0).reverse().map(s => h("div", { class: "kl " + s.cls }, h("i"), s.label, h("b", null, fmtUSD(by[y][s.id]))))));
      };
      const off = () => { host.classList.remove("hv"); cols.forEach(c => c.classList.remove("hot")); hideTip(); };
      hit.addEventListener("pointermove", show); hit.addEventListener("pointerleave", off);
      hit.addEventListener("focus", () => { const r = hit.getBoundingClientRect(); show({ clientX: r.left + r.width / 2, clientY: r.top + 40 }); });
      hit.addEventListener("blur", off);
      svg.append(hit);
    });
    host.append(svg);
    if (instant || RM) { host.classList.add("still", "go"); } else playOnVisible(host, () => host.classList.add("go"));
  }

  /* ================= OVERVIEW: SPECIES ================= */
  function renderSpecies() {
    const host = $("#species"); host.replaceChildren(); host.classList.remove("go");
    const m = {}, others = ["fish", "shrimp", "crustaceans"];
    D.grants.forEach(g => {
      if (g.regrant || !sel(g) || !inP(g) || !FOCUS(g)) return;
      const tg = g.tags || [];
      tg.forEach(t => { if (SPECIES_TAGS.has(t) && t !== "aquatic") m[t] = (m[t] || 0) + g.amount; });
      if (tg.indexOf("aquatic") >= 0 && !tg.some(t => others.indexOf(t) >= 0)) m.aquatic = (m.aquatic || 0) + g.amount;
    });
    const NAMES = { chickens: "Chickens", fish: "Fish", shrimp: "Shrimp", crustaceans: "Crustaceans", pigs: "Pigs", cattle: "Cattle", insects: "Insects", wild: "Wild animals", aquatic: "Aquatic (general)" };
    const rows = Object.keys(m).sort((a, b) => m[b] - m[a]).slice(0, 8);
    if (!rows.length) { host.append(h("p", { class: "fine", style: "grid-column:1/-1" }, "No grants in this selection name a species.")); return; }
    const max = m[rows[0]];
    rows.forEach((k, i) => {
      host.append(h("div", { class: "n" }, NAMES[k]),
        h("div", { class: "tr" }, h("div", { class: "bar", style: "--w:" + (m[k] / max).toFixed(4) + ";--i:" + i }), h("span", { class: "v" }, fmtUSD(m[k]))));
    });
    if (RM) host.classList.add("go"); else playOnVisible(host, () => host.classList.add("go"));
  }

  /* ================= OVERVIEW: OPEN NOW + CONTEXT ================= */
  function cdEl(p) {
    let big, small;
    if (p.days != null) { big = p.days === 0 ? "Today" : String(p.days); small = p.days === 0 ? "closes" : (p.days === 1 ? "day left" : "days left"); }
    else if (p.status === "open") { big = "Rolling"; small = "no deadline"; }
    else { big = String(p.period); small = "opens"; }
    const b = h("span", null, big);
    if (p.days > 0) countUp(b, p.days, x => String(Math.round(x)), 1200);
    return h("div", { class: "cd" }, b, h("small", null, small));
  }
  const whenText = p => p.days != null ? "closes " + fmtDay(p.deadline) : (p.status === "open" ? "rolling applications" : "opens " + p.period);
  function renderTeaser() {
    const items = openCalls().slice(0, 4);
    if (!items.length) { fill($("#openTeaser"), h("p", { class: "fine" }, "No open calls for the causes selected above."), h("a", { class: "more", href: "#pipeline", "data-goto": "pipeline" }, "Everything coming next →")); return; }
    fill($("#openTeaser"), 
      h("div", { class: "orows" }, items.map(p => h("div", { class: "orow" }, cdEl(p),
        h("div", null, h("h3", null, h("a", { href: p.url, target: "_blank", rel: "noopener" }, p.name)), h("div", { class: "sub" }, (causeTag(p) ? causeTag(p) + " · " : "") + p.vehicle + " · " + whenText(p))),
        h("div", { class: p.high ? "amt" : "amt none" }, amtText(p))))),
      h("a", { class: "more", href: "#pipeline", "data-goto": "pipeline" }, "Everything coming next →"));
  }
  function renderContext() {
    const host = $("#context"); host.replaceChildren(); host.classList.remove("go");
    const rows = D.movement.filter(m => m.estimate >= 1e6).sort((a, b) => a.year - b.year);
    if (!rows.length) return;
    rows.forEach(m => {
      const disc = D.grants.filter(g => !g.regrant && FOCUS(g) && +g.year === +m.year).reduce((s, g) => s + g.amount, 0);
      const mx = Math.max(disc, m.estimate);
      const ln = (label, v, mute) => h("div", { class: "ln" }, h("span", null, label),
        h("div", { class: "tr" }, h("div", { class: "b" + (mute ? " mute" : ""), style: "--w:" + (v / mx).toFixed(4) }), h("span", { class: "v" }, fmtUSD(v))));
      host.append(h("div", { class: "ctx" }, h("div", { class: "y" }, m.year),
        h("div", null, ln("Disclosed here", disc, false), ln("Whole movement", m.estimate, true),
          h("div", { class: "nt" }, m.scope + " — " + m.source + ". " + m.notes + " Different scope from the grants counted here, so read it as a sense of scale, not a share."))));
    });
    if (RM) host.classList.add("go"); else playOnVisible(host, () => host.classList.add("go"));
  }

  function renderOverview() {
    renderSwarm(); renderAnnual(); renderDomainBlock(); renderTeaser(); renderContext();
  }

  /* ================= FUNDERS ================= */
  const ALIAS = {
    "Coefficient Giving": ["coefficient giving"], "EA Funds": ["ea funds", "animal welfare fund"], "SFF": ["survival and flourishing"],
    "Manifund": ["manifund"], "Future of Life Institute": ["future of life institute"], "ACE Movement Grants": ["animal charity evaluators"], "Open Wing Alliance": ["open wing"]
  };
  const COVER = {
    "Coefficient Giving": "The Farm Animal Welfare, Navigating Transformative AI and Global Catastrophic Risks funds, each read by hand from its grants page, so refreshing is manual. Its other funds (biosecurity, global health and so on) are not included. The Global Catastrophic Risks fund mixes AI safety with EA community building, so only grants about AI count as AI safety.",
    "EA Funds": "All four EA Funds. 2019–2020 are incomplete, and the 2025 Animal Welfare Fund total is below the fund’s own report.",
    "SFF": "Every round since 2019, plus the Initiative Committee’s 2024 gifts made outside the rounds. Mostly AI safety and existential-risk work; the animal welfare theme round has not published results.",
    "Manifund": "Funded projects in the animal-welfare and AI-safety causes (and animal projects filed elsewhere). Manifund shows amounts but no grant date, so the project’s creation date is used.",
    "National Science Foundation": "Only awards under the Safe Learning-Enabled Systems programme (34 awards, 2023–2025), which Coefficient Giving co-funds. The transfer from CG is left out as a regrant, so the money is counted once.",
    "Future of Life Institute": "Eleven grant programmes with published recipients, 2015–2026. Some programme pages carry no year, so those are dated from FLI’s announcements. Nuclear-war and AI-for-SDGs calls are left out.",
    "ACE Movement Grants": "Every round published.",
    "ACE Recommended Charity Fund": "Six twice-yearly rounds since January 2024, dated by the month the money was paid out. Earlier rounds are not yet included.",
    "Open Wing Alliance": "The 2026 round only (28 grantees)."
  };
  function median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function funderData() {
    const m = new Map();
    D.grants.forEach(g => {
      if (g.regrant || !sel(g)) return;
      let f = m.get(g.funder);
      if (!f) { f = { name: g.funder, all: { n: 0, t: 0 }, per: { n: 0, t: 0 }, amts: [], allS: {}, perS: {}, years: {}, sp: {}, rg: {}, list: [], max: 0 }; m.set(g.funder, f); }
      f.all.n++; f.all.t += g.amount; f.amts.push(g.amount); f.allS[g.s] = (f.allS[g.s] || 0) + g.amount;
      if (g.date >= CUT) { f.per.n++; f.per.t += g.amount; f.perS[g.s] = (f.perS[g.s] || 0) + g.amount; }
      f.years[g.year] = (f.years[g.year] || 0) + g.amount;
      (g.tags || []).forEach(t => { const o = SPECIES_TAGS.has(t) ? f.sp : f.rg; o[t] = (o[t] || 0) + g.amount; });
      f.list.push(g); if (g.amount > f.max) f.max = g.amount;
    });
    const calls = openCalls(), used = {};
    const list = Array.from(m.values());
    list.forEach(f => {
      f.list.sort((a, b) => b.t - a.t || b.amount - a.amount);
      f.lastG = f.list[0]; f.since = Math.min.apply(null, f.list.map(g => +g.year)); f.median = median(f.amts);
      const al = ALIAS[f.name] || [f.name.toLowerCase()];
      f.open = calls.filter(p => { const v = (p.vehicle + " " + p.name).toLowerCase(); return al.some(a => v.indexOf(a) >= 0); });
      f.open.forEach(p => { used[p.name] = 1; });
    });
    return { list: list, extra: calls.filter(p => !used[p.name]) };
  }
  function spark(years) {
    const cur = yearOf(NOW), ys = []; for (let y = cur - 7; y <= cur; y++) ys.push(y);
    const vals = ys.map(y => years[y] || 0), mx = Math.max.apply(null, vals.concat([1]));
    return sv("svg", { class: "spark", width: 96, height: 26, viewBox: "0 0 96 26", role: "img", "aria-label": "Disclosed grants by year, last eight years" },
      vals.map((v, i) => { const bh = v ? Math.max(2, 24 * v / mx) : 0; return sv("rect", { class: i === vals.length - 1 ? "cur" : "", x: i * 12, y: 26 - bh, width: 9, height: bh }, sv("title", null, ys[i] + ": " + fmtUSD(v))); }));
  }
  function mixBar(mix, total) {
    return h("div", { class: "mixbar" }, SERIES.filter(s => mix[s.id] > 0).map(s => h("span", { class: s.cls, style: "--f:" + (mix[s.id] / total) })));
  }
  function topList(o, n, money) {
    const NAMES = { chickens: "Chickens", fish: "Fish", shrimp: "Shrimp", crustaceans: "Crustaceans", pigs: "Pigs", cattle: "Cattle", insects: "Insects", wild: "Wild animals", aquatic: "Aquatic" };
    const k = Object.keys(o).sort((a, b) => o[b] - o[a]).slice(0, n);
    return k.length ? k.map(x => (NAMES[x] || x) + " " + fmtUSD(o[x])).join(" · ") : "Not stated in grant text";
  }
  function lrow(f, i, maxPer, per) {
    const t = per ? f.per.t : f.all.t, n = per ? f.per.n : f.all.n, mix = per ? f.perS : f.allS;
    const lf = h("div", { class: "lf" + (per && !f.per.n ? " off" : "") });
    const row = h("div", { class: "lrow", role: "button", tabindex: "0", "aria-expanded": "false" },
      h("div", null, h("div", { class: "lname" }, f.name, f.open.length ? h("span", { class: "opentag" }, "open") : null),
        h("div", { class: "lsub" }, "since " + f.since + " · last grant " + fmtDate(f.lastG))),
      h("div", { class: "lbw" },
        h("div", { class: "lbar-box" }, t > 0 ? h("div", { class: "lbar", style: "--w:" + (t / maxPer).toFixed(4) + ";--i:" + i },
          SERIES.filter(s => mix[s.id] > 0).map(s => h("span", { class: s.cls, style: "--f:" + (mix[s.id] / t) }))) : null),
        h("div", { class: "lamt" }, t > 0 ? fmtUSD(t) : "—")),
      h("div", { class: "lnum" }, n.toLocaleString()), h("div", { class: "lnum" }, fmtUSD(f.median)), spark(f.years), h("div", { class: "chev" }));
    const recent = f.list.slice(0, 6);
    const det = h("div", { class: "ldet" }, h("div", null, h("div", { class: "ldet-in" },
      h("div", null, h("h4", null, "Most recent grants"), h("ul", { class: "rg" }, recent.map(g => h("li", null, h("span", { class: "d" }, fmtDate(g)),
        h("div", null, h("span", { class: "g" }, g.grantee), h("span", { class: "p" }, clip(g.title, 110))),
        h("span", { class: "a" }, h("a", { href: g.url, target: "_blank", rel: "noopener" }, fmtUSD(g.amount))))))),
      h("dl", { class: "prof" },
        h("dt", null, "Focus"), h("dd", null, mixBar(f.allS, f.all.t), SERIES.filter(s => f.allS[s.id] > 0).map(s => s.label + " " + (f.allS[s.id] / f.all.t < 0.01 ? "<1" : Math.round(f.allS[s.id] / f.all.t * 100)) + "%").join(" · ")),
        h("dt", null, "Typical grant"), h("dd", null, "Median " + fmtUSD(f.median) + " · largest " + fmtUSD(f.max)),
        h("dt", null, "Animals"), h("dd", null, topList(f.sp, 3)),
        h("dt", null, "Regions"), h("dd", null, topList(f.rg, 3)),
        f.open.length ? [h("dt", null, "Open now"), h("dd", null, f.open.map(p => h("div", null, h("a", { href: p.url, target: "_blank", rel: "noopener" }, p.name), " — " + whenText(p))))] : null,
        h("dt", null, "What is covered"), h("dd", null, COVER[f.name] || "As disclosed on the funder’s own pages.")))));
    const toggle = () => { const o = lf.classList.toggle("open"); row.setAttribute("aria-expanded", o ? "true" : "false"); };
    row.addEventListener("click", toggle);
    row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    lf.append(row, det);
    return lf;
  }
  function renderFSort() {
    const per = S.period === "12m";
    const opts = (per ? [["vol", "Last 12 months"]] : []).concat([["all", "All-time total"], ["last", "Most recent grant"], ["name", "A–Z"]]);
    if (!opts.some(o => o[0] === S.fsort)) S.fsort = opts[0][0];
    fill($("#fsort"), h("span", { class: "lab" }, "Sort by"),
      opts.map(o => h("button", { class: "t" + (S.fsort === o[0] ? " on" : ""), type: "button", onclick: () => { S.fsort = o[0]; renderFSort(); renderLedger(); } }, o[1])));
  }
  function renderLedger() {
    const host = $("#ledger"); host.replaceChildren(); host.classList.remove("go");
    const per = S.period === "12m", data = funderData(), list = data.list;
    const sorters = {
      vol: (a, b) => (b.per.t - a.per.t) || (b.all.t - a.all.t), all: (a, b) => b.all.t - a.all.t,
      last: (a, b) => b.lastG.t - a.lastG.t, name: (a, b) => a.name.localeCompare(b.name)
    };
    list.sort(sorters[S.fsort] || sorters.all);
    const maxPer = Math.max.apply(null, list.map(f => per ? f.per.t : f.all.t).concat([1]));
    const wrap = h("div", { class: "ledger" },
      h("div", { class: "lhead" }, h("div", null, "Funder"), h("div", null, per ? "Last 12 months" : "All time"), h("div", { class: "r" }, "Grants"),
        h("div", { class: "r" }, "Median"), h("div", null, "By year"), h("div")),
      list.map((f, i) => lrow(f, i, maxPer, per)));
    host.append(wrap);
    if (data.extra.length) {
      host.append(h("div", { class: "tier" }, h("div", { class: "tier-h" }, h("h2", null, "Also taking applications"), h("span", null, "No grant history tracked yet")),
        h("div", { class: "orows", style: "border-top:0" }, data.extra.map(p => h("div", { class: "orow" }, cdEl(p),
          h("div", null, h("h3", null, h("a", { href: p.url, target: "_blank", rel: "noopener" }, p.name)), h("div", { class: "sub" }, p.vehicle + " · " + whenText(p))),
          h("div", { class: p.high ? "amt" : "amt none" }, amtText(p)))))));
    }
    if (RM) host.classList.add("go"); else playOnVisible(host, () => host.classList.add("go"));
  }

  /* ================= PIPELINE ================= */
  const TIERS = [
    { id: "open_call", h: "Open for applications", d: "Calls you can answer now, nearest deadline first" },
    { id: "committed", h: "Committed or decided", d: "Announced or decided; money is moving or about to" },
    { id: "capacity", h: "Capacity and pledges", d: "Large pools whose direction is not yet set" },
    { id: "projection", h: "Projections", d: "Speculative — a range of possibilities, not a forecast" }
  ];
  function runway(items) {
    const horizon = 430, pct = d => Math.min(100, Math.max(0, (d - NOW) / horizon * 100));
    const narrow = innerWidth < 720, ticks = [];
    let y = yearOf(NOW), m = new Date(NOW * 864e5).getUTCMonth() + 1;
    for (let k = 0; k < 15; k++, m++) {
      if (m > 11) { m = 0; y++; }
      const d = Date.UTC(y, m, 1) / 864e5; if (d - NOW > horizon) break;
      const x = pct(d);
      if (x < 7 || x > 95 || (narrow && m % 3 !== 0)) continue;
      ticks.push(h("span", { class: m === 0 ? "yr" : null, style: "left:" + x.toFixed(2) + "%" }, m === 0 ? String(y) : MON[m]));
    }
    const axis = h("div", { class: "rw-axis" }, h("div"), h("div", { class: "rw-ticks" }, h("span", { style: "left:0" }, "Today"), ticks));
    const rows = items.map((p, i) => {
      let track;
      if (p.days != null) {
        const x = pct(p.dl), right = x > 62;
        track = h("div", { class: "rw-track", style: "--i:" + i },
          h("div", { class: "rw-line", style: "width:" + x + "%" }), h("div", { class: "rw-pt", style: "left:" + x + "%" }),
          h("div", { class: "rw-l", style: right ? "right:calc(" + (100 - x) + "% + 14px)" : "left:calc(" + x + "% + 14px)" },
            h("b", null, fmtDay(p.deadline)), " · " + (p.days === 0 ? "today" : p.days + (p.days === 1 ? " day" : " days"))));
      } else if (p.status === "open") {
        track = h("div", { class: "rw-track", style: "--i:" + i }, h("div", { class: "rw-line roll", style: "width:100%" }),
          h("div", { class: "rw-l", style: "left:0" }, h("b", null, "Rolling"), " · apply any time"));
      } else {
        const x = pct(dayN(p.period + "-06-30"));
        track = h("div", { class: "rw-track", style: "--i:" + i }, h("div", { class: "rw-pt hollow", style: "left:" + x + "%" }),
          h("div", { class: "rw-l", style: "left:calc(" + x + "% + 14px)" }, h("b", null, "Opens " + p.period), " · mid-year"));
      }
      return h("div", { class: "rw-row" },
        h("div", null, h("h3", null, h("a", { href: p.url, target: "_blank", rel: "noopener" }, p.name)), h("div", { class: "sub" }, (causeTag(p) ? causeTag(p) + " · " : "") + p.vehicle + " · " + amtText(p))),
        h("div", null, track, h("div", { class: "rw-note" }, p.notes)));
    });
    return h("div", { class: "rw" }, axis, rows);
  }
  function rangeList(items) {
    const LO = Math.log10(1e5), HI = Math.log10(1e9);
    const lp = v => Math.min(100, Math.max(0, (Math.log10(Math.max(v, 1e5)) - LO) / (HI - LO) * 100));
    const marks = [[1e5, "$100k"], [1e6, "$1M"], [1e7, "$10M"], [1e8, "$100M"], [1e9, "$1B"]];
    const axis = h("div", { class: "rg-axis" }, h("div"), h("div", { class: "ticks" }, marks.map(k => h("span", { style: "left:" + lp(k[0]) + "%" }, k[1]))), h("div"));
    const rows = items.map((p, i) => {
      const cc = p.cause === "animal_welfare" ? "c-animal_welfare" : p.cause === "ai_safety" ? "c-ai_safety" : "c-x";
      let bar;
      if (!p.high) bar = h("div", { class: "rg-bar unk go-on", style: "left:0;--i:" + i });
      else if (p.low === p.high || !p.low) bar = h("div", { class: "rg-bar pt " + cc, style: "left:" + lp(p.high) + "%;--i:" + i });
      else bar = h("div", { class: "rg-bar " + cc, style: "left:" + lp(p.low) + "%;width:" + Math.max(1.2, lp(p.high) - lp(p.low)) + "%;--i:" + i });
      return h("div", { class: "rg-row" },
        h("div", null, h("h3", null, h("a", { href: p.url, target: "_blank", rel: "noopener" }, p.name)), h("div", { class: "sub" }, (causeTag(p) ? causeTag(p) + " · " : "") + p.vehicle)),
        h("div", { class: "rg-track" }, marks.map(k => h("div", { class: "tk", style: "left:" + lp(k[0]) + "%" })), bar),
        h("div", { class: "rg-meta" }, h("b", null, amtText(p)), h("span", { class: "conf" }, p.confidence + " confidence"), h("div", null, p.status + " · " + p.period)),
        h("div", { class: "note" }, p.notes + " ", h("a", { href: p.url, target: "_blank", rel: "noopener" }, "Source"), " (as of " + p.as_of + ")."));
    });
    return h("div", { class: "rg" }, axis, rows);
  }
  function renderPipeline() {
    const host = $("#pipeBody"); host.replaceChildren();
    const calls = openCalls(), rest = D.pipeline.filter(p => p.tier !== "open_call" && pipeVisible(p));
    TIERS.forEach(t => {
      const items = t.id === "open_call" ? calls : rest.filter(p => (p.tier || "committed") === t.id).sort((a, b) => (b.high || 0) - (a.high || 0));
      if (!items.length) return;
      const box = h("div", { class: "tier" }, h("div", { class: "tier-h" }, h("h2", null, t.h), h("span", null, t.d)),
        t.id === "open_call" ? runway(items) : rangeList(items));
      host.append(box);
      if (RM) box.classList.add("go"); else playOnVisible(box, () => box.classList.add("go"));
    });
  }

  /* ================= GRANTS TABLE ================= */
  const G = { q: "", funder: "", regrant: false, sort: "date", dir: -1, page: 1, per: 50, ready: false };
  const COLS = [["date", "Date"], ["funder", "Funder"], ["grantee", "Grantee"], ["title", "Purpose"], ["cause", "Cause"], ["amount", "Amount"]];
  function initGrants() {
    if (G.ready) return; G.ready = true;
    const fs = Array.from(new Set(D.grants.map(g => g.funder))).sort();
    $("#gfunder").append(fs.map(f => h("option", { value: f }, f)));
    $("#gq").addEventListener("input", e => { G.q = e.target.value.toLowerCase(); G.page = 1; renderGrants(); });
    $("#gfunder").addEventListener("change", e => { G.funder = e.target.value; G.page = 1; renderGrants(); });
    $("#gregrant").addEventListener("change", e => { G.regrant = e.target.checked; G.page = 1; renderGrants(); });
    $$("#gtable thead th").forEach(th => th.addEventListener("click", () => {
      const k = th.getAttribute("data-sort");
      if (G.sort === k) G.dir *= -1; else { G.sort = k; G.dir = (k === "date" || k === "amount") ? -1 : 1; }
      renderGrants();
    }));
  }
  function renderGrants() {
    initGrants();
    const rows = D.grants.filter(g => sel(g) && inP(g) && (!G.funder || g.funder === G.funder) && (!G.regrant || !g.regrant) &&
      (!G.q || (g.grantee + " " + g.title + " " + g.fund).toLowerCase().indexOf(G.q) >= 0));
    const key = { date: g => g.t, amount: g => g.amount, cause: g => SBY[g.s].label, funder: g => g.funder, grantee: g => g.grantee.toLowerCase(), title: g => (g.title || "").toLowerCase() }[G.sort];
    rows.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * G.dir; });
    const total = rows.filter(g => !g.regrant).reduce((s, g) => s + g.amount, 0);
    $("#gcount").textContent = rows.length.toLocaleString() + " grants · " + fmtUSD(total) + " (regrants excluded)";
    $$("#gtable thead th").forEach(th => {
      const k = th.getAttribute("data-sort"), c = COLS.filter(x => x[0] === k)[0];
      th.textContent = c[1] + (G.sort === k ? (G.dir < 0 ? " ↓" : " ↑") : ""); th.classList.toggle("sorted", G.sort === k);
    });
    const pages = Math.max(1, Math.ceil(rows.length / G.per)); if (G.page > pages) G.page = pages;
    const page = rows.slice((G.page - 1) * G.per, G.page * G.per);
    fill($("#gbody"), page.length ? page.map(g => h("tr", null,
      h("td", { class: "dt" }, fmtDate(g)), h("td", null, g.funder),
      h("td", { class: "gn" }, g.grantee, g.regrant ? h("span", { class: "rgt", title: "Passed on to another grantmaker; not counted in totals" }, "regrant") : null),
      h("td", { class: "pu" }, clip(g.title, 120)),
      h("td", null, h("span", { class: "cs " + SBY[g.s].cls }, h("i"), SBY[g.s].label)),
      h("td", { class: "am r" }, h("a", { href: g.url, target: "_blank", rel: "noopener" }, fmtUSD(g.amount)))))
      : h("tr", null, h("td", { colspan: 6, style: "padding:40px 0;color:var(--muted)" }, "No grants match.")));
    fill($("#pager"), pages > 1 ? [
      h("button", { type: "button", disabled: G.page <= 1, onclick: () => { G.page--; renderGrants(); scrollTo(0, 0); } }, "← Newer"),
      h("span", null, "Page " + G.page + " of " + pages),
      h("button", { type: "button", disabled: G.page >= pages, onclick: () => { G.page++; renderGrants(); scrollTo(0, 0); } }, "Older →")] : null);
  }

  /* ================= SOURCES / METHOD / FOOTER ================= */
  let staticDone = false;
  function renderStatic() {
    if (staticDone) return; staticDone = true;
    fill($("#srows"), D.sources.map(s => h("div", { class: "srow" },
      h("div", null, h("h3", null, h("a", { href: s.url, target: "_blank", rel: "noopener" }, s.name)), h("div", { class: "f" }, s.format + " · " + s.granularity)),
      h("div", null, h("span", { class: "st " + s.status }, h("i"), s.status.replace(/_/g, " "))),
      h("div", { class: "nt" }, s.notes))));
    const nG = D.grants.length, nF = new Set(D.grants.map(g => g.funder)).size;
    $("#methodBody").innerHTML = [
      "<p>This tracker gathers <b>only grants that funders have published themselves</b>, plus forward-looking figures that come with a source. Fetching and parsing are kept apart: raw snapshots are stored untouched, and every number is rebuilt from them, so any figure can be traced back to a public page.</p>",
      "<h2>What is counted</h2>",
      "<p>" + nG.toLocaleString() + " grants from " + nF + " funders: Coefficient Giving’s Farm Animal Welfare, Navigating Transformative AI and Global Catastrophic Risks funds, the four EA Funds, every Survival and Flourishing Fund round since 2019, Manifund’s relevant cause areas, ACE Movement Grants and its Recommended Charity Fund, the Future of Life Institute’s grant programmes, the SFF Initiative Committee’s gifts, NSF’s Safe Learning-Enabled Systems awards, and the Open Wing Alliance 2026 round. Each row keeps its source link and the date the snapshot was taken.</p>",
      "<h2>“Last 12 months” and dates</h2>",
      "<p>The recent view is the twelve calendar months ending with the snapshot month (" + periodLabel() + "). Funders do not all publish exact dates: Coefficient Giving gives a month, EA Funds a quarter, SFF a round, and Manifund only when a project was created. A grant known only to a quarter or round is placed at the start of it, so a few fall inside or outside the window by convention. Tooltips show the precision each date really has.</p>",
      "<h2>Regrants and double counting</h2>",
      "<p>When one funder gives money to another that passes it on — for example Coefficient Giving to the Navigation Fund or Founders Pledge — the first gift is flagged as a <b>regrant</b> and left out of every total, so the money is counted once, where it is finally granted. Regrants still appear as hollow rings and in the table so nothing is hidden. Exact duplicates are checked on every build; the few that remain are duplicate records in a funder’s own data and are kept visible.</p>",
      "<p>The same organisation receiving money from two funders is <b>not</b> a duplicate: those are separate grants.</p>",
      "<h2>Cause areas</h2>",
      "<p>Causes are assigned by keyword, which is approximate. The Survival and Flourishing Fund and the Long-Term Future Fund are mostly AI and existential-risk funders, so their non-animal grants are filed under AI safety. That bucket is off by default: the tracker’s focus is animal welfare, and AI safety is there so it can grow. It holds the largest block of money here, Coefficient Giving’s AI fund, so switching it on changes the scale of every chart. Grants about both AI and animals are simply animal welfare here.</p>",
      "<h2>What is missing</h2>",
      "<p><b>These totals are a floor.</b> The Navigation Fund publishes no grant list, Good Food Institute lists research projects without amounts, and for AI safety the UK AI Security Institute, Schmidt Sciences and the AI Safety Fund publish programme totals or project titles but no amounts, and Founders Pledge, Longview, Senterra and FarmKind are not yet at grant level. Some early years from EA Funds are incomplete. Coefficient Giving blocks automated access, so its list was read by hand in a browser and has to be refreshed the same way. A secondary aggregator, trace.manifund.org, shows much larger flows from funders that publish no grant list here — Longview Philanthropy (about $420M, nearly all to unnamed recipients), Macroscopic Ventures (about $130M) and Schmidt Sciences (about $88M) — and higher Coefficient Giving AI totals than this tracker’s collection. It cannot be used as rows, because every row here needs a primary source, but it is a reason to read the AI-safety figures as a lower bound. The context figures under the Overview show how large the gap can be.</p>",
      "<h2>Looking forward</h2>",
      "<p>The Pipeline collects what funders have <b>said</b> they will do — open calls, requests for proposals, fund targets, pledges — each with a source, a confidence level and an as-of date. It does not predict. Items are ordered by how actionable they are, from calls open today down to long-range projections.</p>",
      "<h2>Privacy</h2>",
      "<p>In some countries, disclosed foreign funding can put grantees at risk. Only what funders have chosen to publish is included, and this project never tries to reconstruct anonymised or withheld grants.</p>",
      "<h2>Keeping it current</h2>",
      "<p>The data is refreshed monthly or quarterly. Most sources are fetched by script with an honest user agent; Coefficient Giving is collected by hand. The site is static and needs no server.</p>"
    ].join("");
    $("#foot").textContent = "Snapshot " + SNAP + " · " + nG.toLocaleString() + " grants from " + nF + " funders · built only from public records. Totals are a floor, not the whole movement.";
  }

  /* ================= ROUTER / THEME / BOOT ================= */
  const VIEWS = ["overview", "funders", "pipeline", "grants", "sources", "method"];
  function show(view) {
    if (VIEWS.indexOf(view) < 0) view = "overview";
    VIEW = view; hideTip();
    $$(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + view));
    $$("#nav a").forEach(a => a.classList.toggle("on", a.getAttribute("data-view") === view));
    buildFilters();
    if (view === "overview") renderOverview();
    else if (view === "funders") { renderFSort(); renderLedger(); }
    else if (view === "pipeline") renderPipeline();
    else if (view === "grants") renderGrants();
    else renderStatic();
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function go(view) { try { location.hash = view; } catch (e) { /* file:// quirks */ } if (VIEW !== view) show(view); }
  $("#nav").addEventListener("click", e => { const a = e.target.closest("a[data-view]"); if (a) { e.preventDefault(); go(a.getAttribute("data-view")); } });
  document.addEventListener("click", e => { const a = e.target.closest("[data-goto]"); if (a) { e.preventDefault(); go(a.getAttribute("data-goto")); } });
  addEventListener("hashchange", () => { const v = location.hash.slice(1); if (v !== VIEW) show(v); });

  function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("ff-theme", t); } catch (e) { /* ignore */ }
    $("#theme").textContent = t === "dark" ? "Light" : "Dark";
  }
  $("#theme").addEventListener("click", () => setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"));
  setTheme(document.documentElement.getAttribute("data-theme") || "light");

  $("#tblBtn").addEventListener("click", () => { tableMode = !tableMode; renderAnnual(true); });
  let rt; addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (VIEW === "overview") { renderSwarm(true); renderAnnual(true); } else if (VIEW === "pipeline") renderPipeline(); }, 180);
  });

  // Shareable views: ?domain=ai_safety&causes=animal_welfare,ai_safety&period=all
  (function readQuery() {
    try {
      const q = new URLSearchParams(location.search), c = q.get("causes"), p = q.get("period");
      const dm = q.get("domain");
      if (dm && DOMAINS[dm]) { S.domain = dm; S.on = { animal_welfare: dm === "animal_welfare", ai_safety: dm === "ai_safety", misc: false }; }
      if (c) { const want = c.split(",").map(x => x.trim()); SERIES.forEach(x => { S.on[x.id] = want.indexOf(x.id) >= 0 || (x.id === "misc" && want.indexOf("other") >= 0); }); }
      if (!SERIES.some(x => S.on[x.id])) S.on.animal_welfare = true;
      if (!S.on[S.domain]) S.domain = S.on.animal_welfare ? "animal_welfare" : S.on.ai_safety ? "ai_safety" : S.domain;
      if (p === "all" || p === "12m") S.period = p;
    } catch (e) { /* ignore a malformed query */ }
  })();
  $("#domainSwitch").addEventListener("click", e => { const b = e.target.closest("button[data-domain]"); if (b) setDomain(b.getAttribute("data-domain")); });
  syncDomainUI();
  renderStatic();
  renderHero();
  const first = location.hash.slice(1);
  show(VIEWS.indexOf(first) >= 0 ? first : "overview");
  $("#foot").classList.add("rv"); if (io) io.observe($("#foot")); else $("#foot").classList.add("in");
})();
