/* x402 Bazaar Explorer - client. Loads a daily snapshot and renders a
   virtualised, filterable table over ~15k listings. No dependencies. */
(function () {
  "use strict";

  // Column order must match FIELDS in scripts/transform.mjs.
  var URL_ = 0, HOST = 1, NAME = 2, DESC = 3, PRICE = 4, CAT = 5,
      CALLS = 6, PAYERS = 7, LAST = 8, UPDATED = 9, METHOD = 10,
      CURATED = 11, TAGS = 12, ACCEPTS = 13, EXAMPLE = 14;

  var DAY = 86400000;
  var ROW_H = 74;

  var db = null;          // decoded snapshot
  var haystack = [];      // lowercased search text per row
  var rowNets = [];       // display names per row
  var rowSchemes = [];
  var rowPaths = [];
  var rowAsset = [];
  var view = [];
  var selected = -1;
  var snapshotDay = null;

  var PRICE_BANDS = [
    ["any", "Any", null],
    ["p1", "≤ $0.001", 0.001],
    ["p2", "≤ $0.01", 0.01],
    ["p3", "≤ $0.10", 0.1],
    ["p4", "≤ $1.00", 1]
  ];

  var DEMAND_BANDS = [
    ["any", "Any demand", function () { return true; }],
    ["c10", "10+ calls / 30d", function (r) { return r[CALLS] >= 10; }],
    ["c100", "100+ calls / 30d", function (r) { return r[CALLS] >= 100; }],
    ["c1000", "1,000+ calls / 30d", function (r) { return r[CALLS] >= 1000; }],
    ["p10", "10+ distinct payers", function (r) { return r[PAYERS] >= 10; }],
    ["p50", "50+ distinct payers", function (r) { return r[PAYERS] >= 50; }]
  ];

  var state = {
    q: "", cats: {}, nets: {}, schemes: {},
    price: "any", demand: "any",
    curated: false, example: false, fresh: false,
    sort: "calls"
  };

  var el = {};
  ["q", "qclear", "stats", "stamp", "sort", "reset", "demand", "cats", "nets", "netsmore",
   "schemes", "price", "fcurated", "fexample", "ffresh", "scroller", "spacer", "skeleton",
   "empty", "failed", "failmsg", "footl", "footr", "csv", "drawer", "scrim", "dtitle",
   "dhost", "dbody", "dclose", "theme", "railtoggle", "rail"].forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  /* ------------------------------------------------------------------ utils */

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function num(v) { return v.toLocaleString("en-US"); }
  function money(v) {
    if (v == null) return "—";
    if (v === 0) return "free";
    if (v < 0.01) return "$" + v.toFixed(v < 0.001 ? 5 : 4).replace(/0+$/, "").replace(/\.$/, "");
    if (v < 1) return "$" + v.toFixed(3).replace(/0$/, "");
    return "$" + v.toFixed(2);
  }
  function median(list) {
    if (!list.length) return null;
    var a = list.slice().sort(function (x, y) { return x - y; });
    return a[Math.floor(a.length / 2)];
  }
  function daysSince(iso) {
    if (!iso || !snapshotDay) return null;
    return Math.round((Date.parse(snapshotDay) - Date.parse(iso)) / DAY);
  }
  function ago(iso) {
    var d = daysSince(iso);
    if (d == null) return "never";
    if (d <= 0) return "same day";
    if (d === 1) return "1 day before snapshot";
    if (d < 30) return d + " days before snapshot";
    return Math.round(d / 30) + " months before snapshot";
  }
  function hasAny(map) { for (var k in map) { if (map[k]) return true; } return false; }
  function keysOn(map) { return Object.keys(map).filter(function (k) { return map[k]; }); }

  /* ------------------------------------------------------- URL <-> state sync */

  function readHash() {
    var raw = location.hash.replace(/^#/, "");
    if (!raw) return;
    var p = new URLSearchParams(raw);
    state.q = p.get("q") || "";
    state.price = p.get("price") || "any";
    state.demand = p.get("demand") || "any";
    state.sort = p.get("sort") || "calls";
    var flags = (p.get("flags") || "").split(",");
    state.curated = flags.indexOf("curated") >= 0;
    state.example = flags.indexOf("example") >= 0;
    state.fresh = flags.indexOf("fresh") >= 0;
    ["cat:cats", "net:nets", "scheme:schemes"].forEach(function (pair) {
      var parts = pair.split(":"), value = p.get(parts[0]);
      state[parts[1]] = {};
      if (value) value.split("|").forEach(function (v) { state[parts[1]][v] = true; });
    });
  }

  var suppressHash = false;
  function writeHash() {
    if (suppressHash) return;
    var p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (hasAny(state.cats)) p.set("cat", keysOn(state.cats).join("|"));
    if (hasAny(state.nets)) p.set("net", keysOn(state.nets).join("|"));
    if (hasAny(state.schemes)) p.set("scheme", keysOn(state.schemes).join("|"));
    if (state.price !== "any") p.set("price", state.price);
    if (state.demand !== "any") p.set("demand", state.demand);
    if (state.sort !== "calls") p.set("sort", state.sort);
    var flags = [];
    if (state.curated) flags.push("curated");
    if (state.example) flags.push("example");
    if (state.fresh) flags.push("fresh");
    if (flags.length) p.set("flags", flags.join(","));
    var next = p.toString();
    var target = next ? "#" + next : location.pathname + location.search;
    if (next) {
      if (location.hash.replace(/^#/, "") !== next) history.replaceState(null, "", target);
    } else if (location.hash) {
      history.replaceState(null, "", target);
    }
  }

  /* ----------------------------------------------------------------- indexing */

  function index() {
    var rows = db.rows;
    haystack = new Array(rows.length);
    rowNets = new Array(rows.length);
    rowSchemes = new Array(rows.length);
    rowPaths = new Array(rows.length);
    rowAsset = new Array(rows.length);

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var host = db.hosts[r[HOST]];
      var tagText = "";
      for (var t = 0; t < r[TAGS].length; t++) tagText += " " + db.tags[r[TAGS][t]];
      haystack[i] = (r[NAME] + " " + host + " " + r[URL_] + " " + r[DESC] + tagText).toLowerCase();

      var nets = [], schemes = [], cheapest = null;
      for (var a = 0; a < r[ACCEPTS].length; a++) {
        var acc = r[ACCEPTS][a];
        var netName = db.networks[acc[1]];
        var schemeName = db.schemes[acc[0]];
        if (nets.indexOf(netName) < 0) nets.push(netName);
        if (schemes.indexOf(schemeName) < 0) schemes.push(schemeName);
        if (acc[3] != null && (cheapest == null || acc[3] < cheapest[3])) cheapest = acc;
      }
      rowNets[i] = nets;
      rowSchemes[i] = schemes;
      rowAsset[i] = cheapest ? db.assets[cheapest[2]] : "";

      var url = r[URL_], at = url.indexOf(host);
      rowPaths[i] = at < 0 ? url : (url.slice(at + host.length) || "/");
    }
  }

  function tally(pick) {
    var counts = {};
    for (var i = 0; i < db.rows.length; i++) {
      var keys = pick(i);
      for (var k = 0; k < keys.length; k++) counts[keys[k]] = (counts[keys[k]] || 0) + 1;
    }
    return counts;
  }

  var catCounts, netCounts, schemeCounts, demandCounts;
  function countFacets() {
    catCounts = tally(function (i) { return [db.categories[db.rows[i][CAT]]]; });
    netCounts = tally(function (i) { return rowNets[i]; });
    schemeCounts = tally(function (i) { return rowSchemes[i]; });
    demandCounts = {};
    DEMAND_BANDS.forEach(function (band) {
      var c = 0;
      for (var i = 0; i < db.rows.length; i++) if (band[2](db.rows[i])) c++;
      demandCounts[band[0]] = c;
    });
  }

  /* ---------------------------------------------------------------- filtering */

  function apply() {
    var rows = db.rows;
    var terms = state.q.trim() ? state.q.trim().toLowerCase().split(/\s+/) : null;
    var useCat = hasAny(state.cats), useNet = hasAny(state.nets), useScheme = hasAny(state.schemes);
    var cap = null;
    PRICE_BANDS.forEach(function (b) { if (b[0] === state.price) cap = b[2]; });
    var band = DEMAND_BANDS.filter(function (b) { return b[0] === state.demand; })[0] || DEMAND_BANDS[0];
    var out = [];

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (useCat && !state.cats[db.categories[r[CAT]]]) continue;
      if (cap != null && !(r[PRICE] != null && r[PRICE] <= cap)) continue;
      if (state.curated && !r[CURATED]) continue;
      if (state.example && !r[EXAMPLE]) continue;
      if (state.fresh) { var d = daysSince(r[LAST]); if (d == null || d > 7) continue; }
      if (!band[2](r)) continue;
      if (useNet) {
        var netHit = false, nets = rowNets[i];
        for (var n = 0; n < nets.length; n++) if (state.nets[nets[n]]) { netHit = true; break; }
        if (!netHit) continue;
      }
      if (useScheme) {
        var schemeHit = false, schemes = rowSchemes[i];
        for (var s = 0; s < schemes.length; s++) if (state.schemes[schemes[s]]) { schemeHit = true; break; }
        if (!schemeHit) continue;
      }
      if (terms) {
        var hay = haystack[i], all = true;
        for (var t = 0; t < terms.length; t++) if (hay.indexOf(terms[t]) < 0) { all = false; break; }
        if (!all) continue;
      }
      out.push(i);
    }

    var mode = state.sort;
    out.sort(function (x, y) {
      var a = rows[x], b = rows[y];
      if (mode === "calls") return b[CALLS] - a[CALLS] || b[PAYERS] - a[PAYERS];
      if (mode === "payers") return b[PAYERS] - a[PAYERS] || b[CALLS] - a[CALLS];
      if (mode === "priceasc") return (a[PRICE] == null ? 1e9 : a[PRICE]) - (b[PRICE] == null ? 1e9 : b[PRICE]) || b[CALLS] - a[CALLS];
      if (mode === "pricedesc") return (b[PRICE] == null ? -1 : b[PRICE]) - (a[PRICE] == null ? -1 : a[PRICE]) || b[CALLS] - a[CALLS];
      if (mode === "recent") return (b[LAST] || "").localeCompare(a[LAST] || "") || b[CALLS] - a[CALLS];
      return db.hosts[a[HOST]].localeCompare(db.hosts[b[HOST]]) || b[CALLS] - a[CALLS];
    });

    view = out;
    renderStats();
    renderList(true);
    writeHash();
  }

  /* ------------------------------------------------------------------- header */

  function renderStats() {
    var calls = 0, payers = 0, prices = [], hosts = {};
    for (var i = 0; i < view.length; i++) {
      var r = db.rows[view[i]];
      calls += r[CALLS]; payers += r[PAYERS]; hosts[r[HOST]] = 1;
      if (r[PRICE] != null) prices.push(r[PRICE]);
    }
    var total = db.rows.length;
    var cells = [
      ["Listings", num(view.length) + (view.length === total ? "" : " <small>/ " + num(total) + "</small>")],
      ["Providers", num(Object.keys(hosts).length)],
      ["Median price", money(median(prices))],
      ["30d calls", num(calls)],
      ["30d payers", num(payers)]
    ];
    el.stats.innerHTML = cells.map(function (c) {
      return '<div class="stat"><div class="k">' + c[0] + '</div><div class="v">' + c[1] + "</div></div>";
    }).join("");
    el.footl.textContent = view.length === total
      ? "Showing all " + num(total) + " listings"
      : "Showing " + num(view.length) + " of " + num(total) + " listings";
  }

  /* --------------------------------------------------------- virtualised list */

  var pool = [];

  function renderList(resetScroll) {
    el.spacer.style.height = (view.length * ROW_H) + "px";
    el.empty.hidden = view.length > 0;
    if (resetScroll) el.scroller.scrollTop = 0;
    paint();
  }

  function rowHTML(i) {
    var r = db.rows[i];
    var host = db.hosts[r[HOST]];
    var level = r[CALLS] >= 500 ? "hi" : (r[CALLS] >= 25 ? "md" : "lo");
    var title = r[NAME] || host;
    var sub = r[NAME] ? host + rowPaths[i] : rowPaths[i];

    var chips = '<span class="tag cat">' + esc(db.categories[r[CAT]]) + "</span>";
    if (r[CURATED]) chips += '<span class="tag cur">curated</span>';
    chips += rowNets[i].slice(0, 3).map(function (n) { return '<span class="tag">' + esc(n) + "</span>"; }).join("");
    if (rowNets[i].length > 3) chips += '<span class="tag">+' + (rowNets[i].length - 3) + "</span>";
    chips += rowSchemes[i].filter(function (s) { return s !== "exact"; })
      .map(function (s) { return '<span class="tag">' + esc(s) + "</span>"; }).join("");

    return '<div class="cell">' +
        '<div class="line1"><span class="nm">' + esc(title) + '</span>' +
        '<span class="path mono">' + esc(sub) + "</span></div>" +
        '<div class="line2">' + esc(r[DESC] || "No description provided.") + "</div>" +
        '<div class="line3">' + chips + "</div>" +
      "</div>" +
      '<div class="price">' + money(r[PRICE]) + '<span class="asset">' + esc(rowAsset[i]) + "</span></div>" +
      '<div class="num"><span class="pulse"><span class="dot ' + level + '"></span>' + num(r[CALLS]) + "</span></div>" +
      '<div class="num dim c-payers">' + num(r[PAYERS]) + "</div>";
  }

  function paint() {
    if (!db) return;
    var top = el.scroller.scrollTop, height = el.scroller.clientHeight;
    var first = Math.max(0, Math.floor(top / ROW_H) - 4);
    var last = Math.min(view.length, Math.ceil((top + height) / ROW_H) + 4);
    var need = last - first;

    while (pool.length < need) {
      var node = document.createElement("div");
      node.className = "row";
      node.style.height = ROW_H + "px";
      node.setAttribute("role", "button");
      node.tabIndex = 0;
      node.addEventListener("click", function () { openDetail(parseInt(this.dataset.idx, 10)); });
      node.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(parseInt(this.dataset.idx, 10)); }
      });
      el.spacer.appendChild(node);
      pool.push(node);
    }

    for (var p = 0; p < pool.length; p++) {
      var node2 = pool[p];
      if (p < need) {
        var vi = first + p, i = view[vi];
        node2.style.display = "";
        node2.style.transform = "translateY(" + (vi * ROW_H) + "px)";
        if (node2.dataset.idx !== String(i)) { node2.dataset.idx = i; node2.innerHTML = rowHTML(i); }
        node2.classList.toggle("on", i === selected);
      } else {
        node2.style.display = "none";
      }
    }
  }

  /* ------------------------------------------------------------------- drawer */

  function openDetail(i) {
    selected = i;
    var r = db.rows[i], host = db.hosts[r[HOST]];
    el.dtitle.textContent = r[NAME] || host;
    el.dhost.textContent = r[URL_];

    var quality = [
      ["30d calls", num(r[CALLS])],
      ["Unique payers", num(r[PAYERS])],
      ["Last called", ago(r[LAST])],
      ["Listing updated", ago(r[UPDATED])]
    ];

    var rails = r[ACCEPTS].map(function (a) {
      var payTo = db.payTos[a[4]];
      var scheme = db.schemes[a[0]];
      return "<tr>" +
        '<td><span class="pill' + (scheme === "exact" ? " ex" : "") + '">' + esc(scheme) + "</span></td>" +
        "<td>" + esc(db.networks[a[1]]) + "</td>" +
        '<td class="m">' + money(a[3]) + "</td>" +
        "<td>" + esc(db.assets[a[2]]) + "</td>" +
        '<td class="m">' + (a[5] != null ? a[5] + "s" : "—") + "</td>" +
        '<td class="m" title="' + esc(payTo) + '">' + esc(payTo ? payTo.slice(0, 6) + "…" + payTo.slice(-4) : "—") + "</td>" +
        "</tr>";
    }).join("");

    var tagChips = r[TAGS].map(function (t) { return '<span class="tag">' + esc(db.tags[t]) + "</span>"; }).join("");

    var snippet =
      "# 1. probe - the server replies 402 with its payment terms\n" +
      "curl -i -X " + (r[METHOD] || "GET") + " " + r[URL_] + "\n\n" +
      "# 2. pay and retry through an x402 client\n" +
      "npx x402-fetch " + r[URL_];

    el.dbody.innerHTML =
      '<div class="sec"><h4>What it does</h4>' +
        '<div class="desc">' + esc(r[DESC] || "No description provided by the seller.") + "</div>" +
        '<div class="line3" style="margin-top:10px">' +
          '<span class="tag cat">' + esc(db.categories[r[CAT]]) + "</span>" +
          (r[CURATED] ? '<span class="tag cur">curated</span>' : "") +
          (r[EXAMPLE] ? '<span class="tag">response example</span>' : "") +
          (r[METHOD] ? '<span class="tag">' + esc(r[METHOD]) + "</span>" : "") +
        "</div></div>" +
      '<div class="sec"><h4>Demand, 30 days to snapshot</h4><div class="kv">' +
        quality.map(function (q) {
          return '<div><div class="k">' + q[0] + '</div><div class="v">' + q[1] + "</div></div>";
        }).join("") +
      "</div></div>" +
      '<div class="sec"><h4>Payment rails accepted (' + r[ACCEPTS].length + ")</h4>" +
        '<div class="tblwrap"><table><thead><tr>' +
        "<th>Scheme</th><th>Network</th><th>Price</th><th>Asset</th><th>Timeout</th><th>Pay to</th>" +
        "</tr></thead><tbody>" + rails + "</tbody></table></div></div>" +
      (tagChips ? '<div class="sec"><h4>Seller tags</h4><div class="taglist">' + tagChips + "</div></div>" : "") +
      '<div class="sec"><div class="rowbtw"><h4 style="margin:0">Try it</h4>' +
        '<button class="copy" id="copysnippet" type="button">Copy</button></div>' +
        '<pre class="pre">' + esc(snippet) + "</pre></div>";

    document.getElementById("copysnippet").addEventListener("click", function () {
      var button = this;
      navigator.clipboard.writeText(snippet).then(function () {
        button.textContent = "Copied";
        setTimeout(function () { button.textContent = "Copy"; }, 1400);
      }, function () {
        button.textContent = "Copy failed";
      });
    });

    el.drawer.classList.add("on");
    el.drawer.setAttribute("aria-hidden", "false");
    el.scrim.classList.add("on");
    paint();
  }

  function closeDetail() {
    selected = -1;
    el.drawer.classList.remove("on");
    el.drawer.setAttribute("aria-hidden", "true");
    el.scrim.classList.remove("on");
    paint();
  }

  /* ------------------------------------------------------------------ controls */

  function chip(label, count, pressed, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.setAttribute("aria-pressed", pressed ? "true" : "false");
    b.innerHTML = esc(label) + (count != null ? ' <span class="n">' + num(count) + "</span>" : "");
    b.addEventListener("click", onClick);
    return b;
  }
  function fill(node, children) {
    node.innerHTML = "";
    children.forEach(function (c) { node.appendChild(c); });
  }

  function buildCats() {
    var ordered = db.categories.map(function (name) { return [name, catCounts[name] || 0]; })
      .sort(function (a, b) {
        if (a[0] === "Other") return 1;
        if (b[0] === "Other") return -1;
        return b[1] - a[1];
      });
    fill(el.cats, ordered.map(function (c) {
      return chip(c[0], c[1], !!state.cats[c[0]], function () {
        state.cats[c[0]] = !state.cats[c[0]];
        buildCats(); apply();
      });
    }));
  }

  var netsExpanded = false;
  function buildNets() {
    var ordered = Object.keys(netCounts).map(function (k) { return [k, netCounts[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; });
    var shown = netsExpanded ? ordered : ordered.slice(0, 10);
    fill(el.nets, shown.map(function (n) {
      return chip(n[0], n[1], !!state.nets[n[0]], function () {
        state.nets[n[0]] = !state.nets[n[0]];
        buildNets(); apply();
      });
    }));
    el.netsmore.hidden = ordered.length <= 10;
    el.netsmore.textContent = netsExpanded ? "Show fewer" : "Show all " + ordered.length + " networks";
  }

  function buildSchemes() {
    var ordered = Object.keys(schemeCounts).map(function (k) { return [k, schemeCounts[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; });
    fill(el.schemes, ordered.map(function (s) {
      return chip(s[0], s[1], !!state.schemes[s[0]], function () {
        state.schemes[s[0]] = !state.schemes[s[0]];
        buildSchemes(); apply();
      });
    }));
  }

  function buildPrice() {
    fill(el.price, PRICE_BANDS.map(function (b) {
      return chip(b[1], null, state.price === b[0], function () {
        state.price = b[0]; buildPrice(); apply();
      });
    }));
  }

  function buildDemand() {
    el.demand.innerHTML = "";
    var max = demandCounts.any || 1;
    DEMAND_BANDS.forEach(function (band) {
      var count = demandCounts[band[0]];
      var node = document.createElement("button");
      node.type = "button";
      node.className = "segrow";
      node.setAttribute("aria-pressed", state.demand === band[0] ? "true" : "false");
      node.innerHTML = '<span class="lab">' + esc(band[1]) +
        '<span class="bar" style="width:' + Math.max(4, Math.round(52 * count / max)) + 'px"></span></span>' +
        '<span class="n">' + num(count) + "</span>";
      node.addEventListener("click", function () { state.demand = band[0]; buildDemand(); apply(); });
      el.demand.appendChild(node);
    });
  }

  function syncControls() {
    el.q.value = state.q;
    el.qclear.hidden = !state.q;
    el.sort.value = state.sort;
    el.fcurated.checked = state.curated;
    el.fexample.checked = state.example;
    el.ffresh.checked = state.fresh;
  }

  function buildAll() {
    buildCats(); buildNets(); buildSchemes(); buildPrice(); buildDemand(); syncControls();
  }

  /* ---------------------------------------------------------------- CSV export */

  function exportCSV() {
    var head = ["url", "service", "host", "category", "min_price_usd", "asset",
                "networks", "schemes", "calls_30d", "unique_payers_30d",
                "last_called", "curated", "description"];
    var lines = [head.join(",")];
    var q = function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; };
    for (var i = 0; i < view.length; i++) {
      var r = db.rows[view[i]];
      lines.push([
        q(r[URL_]), q(r[NAME]), q(db.hosts[r[HOST]]), q(db.categories[r[CAT]]),
        r[PRICE] == null ? "" : r[PRICE], q(rowAsset[view[i]]),
        q(rowNets[view[i]].join(" ")), q(rowSchemes[view[i]].join(" ")),
        r[CALLS], r[PAYERS], q(r[LAST]), r[CURATED] ? "true" : "false", q(r[DESC])
      ].join(","));
    }
    var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "x402-bazaar-" + (snapshotDay || "snapshot") + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  /* ---------------------------------------------------------------- trend strip */

  function renderTrend(history) {
    if (!history || history.length < 2) return;
    var points = history.slice(-30);
    var values = points.map(function (p) { return p.listings; });
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    var span = max - min || 1;
    var w = 72, h = 18;
    var d = values.map(function (v, i) {
      var x = (i / (values.length - 1)) * w;
      var y = h - ((v - min) / span) * h;
      return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    }).join(" ");
    var change = values[values.length - 1] - values[0];
    var cls = change >= 0 ? "up" : "down";
    var sign = change >= 0 ? "+" : "";
    el.footr.innerHTML =
      '<span class="trend" title="Listings over the last ' + points.length + ' snapshots">' +
        '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" aria-hidden="true">' +
          '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".55"/>' +
          '<circle cx="' + w + '" cy="' + (h - ((values[values.length - 1] - min) / span) * h).toFixed(1) +
            '" r="2" fill="currentColor"/>' +
        "</svg>" +
        '<span class="delta ' + cls + '">' + sign + num(change) + " listings / " + points.length + "d</span>" +
      "</span>";
  }

  /* ------------------------------------------------------------------ wiring */

  var searchTimer;
  el.q.addEventListener("input", function () {
    clearTimeout(searchTimer);
    el.qclear.hidden = !el.q.value;
    searchTimer = setTimeout(function () { state.q = el.q.value; apply(); }, 130);
  });
  el.qclear.addEventListener("click", function () {
    el.q.value = ""; el.qclear.hidden = true; state.q = ""; apply(); el.q.focus();
  });
  el.sort.addEventListener("change", function () { state.sort = el.sort.value; apply(); });
  el.fcurated.addEventListener("change", function () { state.curated = el.fcurated.checked; apply(); });
  el.fexample.addEventListener("change", function () { state.example = el.fexample.checked; apply(); });
  el.ffresh.addEventListener("change", function () { state.fresh = el.ffresh.checked; apply(); });
  el.netsmore.addEventListener("click", function () { netsExpanded = !netsExpanded; buildNets(); });
  el.csv.addEventListener("click", exportCSV);
  el.reset.addEventListener("click", function () {
    state = { q: "", cats: {}, nets: {}, schemes: {}, price: "any", demand: "any",
              curated: false, example: false, fresh: false, sort: "calls" };
    buildAll(); apply();
  });
  el.dclose.addEventListener("click", closeDetail);
  el.scrim.addEventListener("click", closeDetail);
  el.scroller.addEventListener("scroll", function () { requestAnimationFrame(paint); }, { passive: true });
  window.addEventListener("resize", paint);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeDetail();
    if (e.key === "/" && document.activeElement !== el.q) { e.preventDefault(); el.q.focus(); el.q.select(); }
  });

  try {
    var storedTheme = localStorage.getItem("bazaar.theme");
    if (storedTheme) document.documentElement.setAttribute("data-theme", storedTheme);
  } catch (e) { /* private mode */ }
  el.theme.addEventListener("click", function () {
    var current = document.documentElement.getAttribute("data-theme");
    var isDark = current ? current === "dark" : window.matchMedia("(prefers-color-scheme:dark)").matches;
    var next = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("bazaar.theme", next); } catch (e2) { /* private mode */ }
  });

  function syncRailButton() { el.railtoggle.style.display = window.innerWidth <= 820 ? "flex" : "none"; }
  el.railtoggle.addEventListener("click", function () { el.rail.classList.toggle("on"); });
  window.addEventListener("resize", syncRailButton);
  syncRailButton();

  /* -------------------------------------------------------------------- boot */

  function version() {
    var src = document.currentScript && document.currentScript.src;
    var m = src && src.match(/[?&]v=([^&]+)/);
    return m ? m[1] : String(Date.now());
  }
  var buildId = version();

  function get(path) {
    return fetch(path, { cache: "default" }).then(function (res) {
      if (!res.ok) throw new Error(path + " -> HTTP " + res.status);
      return res.json();
    });
  }

  function boot() {
    get("data/meta.json?v=" + buildId).then(function (meta) {
      snapshotDay = meta.day;
      el.stamp.textContent = "Snapshot " + meta.day + " · CDP discovery";
      return Promise.all([
        get("data/registry.json?v=" + buildId),
        get("data/history.json?v=" + buildId).catch(function () { return []; })
      ]);
    }).then(function (loaded) {
      db = loaded[0];
      if (!snapshotDay) snapshotDay = (db.fetchedAt || "").slice(0, 10);
      index();
      countFacets();
      readHash();
      el.skeleton.remove();
      el.q.disabled = false;
      el.csv.disabled = false;
      buildAll();
      apply();
      renderTrend(loaded[1]);
    }).catch(function (err) {
      el.skeleton.remove();
      el.failed.hidden = false;
      el.failmsg.textContent = err.message;
      el.footl.textContent = "Snapshot unavailable";
    });
  }

  boot();
})();
