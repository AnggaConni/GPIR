(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const CATALOG_URL = "./data/opportunity_catalog.json";
  const TRADE_URL = "./data/data.json";
  const INVENTORY_KEY = "gpir.localEnterprise.inventory.v1";
  const MARKET_LABELS = { local: "Lokal / regional", both: "Lokal + internasional", international: "Internasional" };
  let catalog = [];
  let tradeFeed = null;
  let tradeItems = [];
  let lastRecommendations = [];
  let inventory = readInventory();
  let poiMap = null;
  let poiMarkers = null;

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
  const number = (v) => (v == null || v === "" || !Number.isFinite(Number(v))) ? null : Number(v);
  const money = (v) => v == null ? "—" : new Intl.NumberFormat("id-ID", {
    style: "currency", currency: "IDR", maximumFractionDigits: 0
  }).format(v);
  const compactUSD = (v) => v == null ? "—" : new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1
  }).format(v);
  const pct = (v) => v == null ? "—" : (Number(v) > 0 ? "+" : "") + Number(v).toFixed(1) + "%";
  const clean = (v) => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const tokenize = (s) => String(s || "").split(/[,;\n]/).map(x => x.trim()).filter(Boolean);
  function readInventory() {
    try {
      const data = JSON.parse(localStorage.getItem(INVENTORY_KEY) || "[]");
      return Array.isArray(data) ? data : [];
    } catch (_) { return []; }
  }
  function saveInventory() {
    try {
      localStorage.setItem(INVENTORY_KEY, JSON.stringify(inventory));
      renderInventory();
      return true;
    } catch (_) {
      alert("Browser tidak dapat menyimpan inventaris. Coba ekspor JSON dan simpan cadangan.");
      return false;
    }
  }
  function collectProfile() {
    const localItems = inventory.map(item => item.name);
    const resources = [...tokenize($("resources").value), ...localItems];
    return {
      district: $("district").value.trim(),
      province: $("province").value.trim(),
      capital: $("capital").value,
      market: $("targetMarket").value,
      resourceText: resources.join(", "),
      resources: [...new Set(resources.map(clean).filter(Boolean))],
      skills: [...new Set(tokenize($("skills").value).map(clean).filter(Boolean))]
    };
  }
  function hasKeyword(texts, keywords) {
    const joined = texts.map(clean).join(" · ");
    return keywords.some(k => {
      const key = clean(k);
      return key && (joined.includes(key) || texts.some(t => clean(t).includes(key)));
    });
  }
  function getResourceMatches(opp, profile) {
    return opp.resource_keywords.filter(k => hasKeyword(profile.resources, [k]));
  }
  function getSkillMatches(opp, profile) {
    return opp.skill_keywords.filter(k => hasKeyword(profile.skills, [k]));
  }
  function rankOpportunity(opp, profile) {
    const resourceMatches = getResourceMatches(opp, profile);
    const skillMatches = getSkillMatches(opp, profile);
    const resourceScore = profile.resources.length ? Math.min(60, resourceMatches.length * 25) : 0;
    const skillScore = profile.skills.length ? Math.min(15, skillMatches.length * 7.5) : 0;
    const marketScore = opp.market_fit.includes(profile.market) ||
      (profile.market === "both" && opp.market_fit.includes("local") && opp.market_fit.includes("international")) ? 15 : 5;
    const capitalScore = profile.capital === "micro" && opp.capital_level === "micro" ? 10 :
      profile.capital === "small" ? 7 : profile.capital === "growth" ? 5 : 5;
    const evidence = matchingTradeRows(opp, profile, 3);
    const hasResourceFit = resourceMatches.length > 0;
    const fitScore = Math.round(resourceScore + skillScore + marketScore + capitalScore);
    return { ...opp, resourceMatches, skillMatches, evidenceCount: evidence.length, fitScore, hasResourceFit };
  }
  function matchingTradeRows(opp, profile, limit = 50) {
    if (!tradeItems.length) return [];
    const terms = opp ? [...opp.demand_keywords, ...opp.products, ...opp.resource_keywords] : catalog.flatMap(item => [...item.demand_keywords, ...item.products, ...item.resource_keywords]);
    const profileTerms = profile ? profile.resources : [];
    const allTerms = [...new Set([...terms, ...profileTerms])].map(clean).filter(t => t.length >= 4);
    const unique = new Map();
    tradeItems.forEach(item => {
      const title = clean(item.product_name || "");
      const productCode = String(item.product_code || "");
      if (!title) return;
      const matched = allTerms.some(term => title.includes(term) || term.includes(title));
      if (!matched) return;
      const key = [item.product_code, item.market_iso3, item.latest_year].join("|");
      if (!unique.has(key)) unique.set(key, item);
    });
    return [...unique.values()].sort((a, b) => {
      const growthA = number(a.yoy_growth_pct) || -999;
      const growthB = number(b.yoy_growth_pct) || -999;
      return (number(b.latest_year) || 0) - (number(a.latest_year) || 0) ||
        (number(b.latest_import_usd) || 0) - (number(a.latest_import_usd) || 0) ||
        growthB - growthA;
    }).slice(0, limit);
  }
  function capitalRange(opp) { return money(opp.capital_min_idr) + "–" + money(opp.capital_max_idr); }
  function getMarketText(opp, profile) {
    if (profile.market === "local") return "Uji pembeli lokal dahulu";
    if (profile.market === "international") return "Butuh validasi buyer, standar, dan logistik ekspor";
    return "Mulai lokal; ekspor sebagai hipotesis tahap berikutnya";
  }
  function renderRecommendations(profile) {
    lastRecommendations = catalog.map(opp => rankOpportunity(opp, profile)).sort((a, b) =>
      Number(b.hasResourceFit) - Number(a.hasResourceFit) ||
      b.fitScore - a.fitScore ||
      b.evidenceCount - a.evidenceCount
    );
    const matches = lastRecommendations.filter(x => x.hasResourceFit);
    $("recCount").textContent = Math.min(6, lastRecommendations.length);
    $("resourceMatches").textContent = matches.length;
    $("recommendationStatus").textContent = profile.resources.length ? (matches.length + " IDE COCOK DENGAN INPUT") : "TAMBAHKAN SUMBER DAYA";
    $("recommendationStatus").className = "pill " + (matches.length ? "green" : "gold");
    const display = (profile.resources.length && matches.length) ? matches.slice(0, 6) : lastRecommendations.slice(0, 4);
    if (!display.length) {
      $("recommendations").innerHTML = '<div class="panel empty">Katalog ide usaha belum tersedia.</div>';
      return;
    }
    $("recommendations").innerHTML = display.map((opp, i) => {
      const fitText = opp.hasResourceFit ? (opp.fitScore + "/100 fit") : "Belum cocok terdeteksi";
      const fitClass = opp.hasResourceFit ? "fit" : "tiny";
      const matchText = opp.resourceMatches.length ? "Cocok: " + opp.resourceMatches.join(", ") :
        (profile.resources.length ? "Tidak ada tag bahan baku yang cocok; anggap sebagai ide umum." : "Isi bahan baku agar kecocokan bisa dihitung.");
      const matchedEvidence = matchingTradeRows(opp, profile, 3);
      const evidenceText = matchedEvidence.length ?
        matchedEvidence.length + " baris perdagangan yang cocok di feed GPIR (bukan data penjualan)" :
        "Belum ada baris perdagangan yang cocok di feed GPIR";
      const risks = opp.risks.slice(0, 2).map(r => "<li>" + esc(r) + "</li>").join("");
      return '<article class="rec"><div class="top"><span class="pill">' + (i + 1) + ' · HIPOTESIS USAHA</span><span class="' + fitClass + '">' + esc(fitText) + '</span></div>' +
        '<h3>' + esc(opp.title) + '</h3><div class="subtitle">' + esc(opp.products.join(" · ")) + '</div>' +
        '<p>' + esc(opp.rationale) + '</p><p><b>' + esc(matchText) + '</b></p>' +
        '<div><span class="tiny">Kisaran modal awal ilustratif</span><br><b>' + esc(capitalRange(opp)) + '</b></div>' +
        '<div><span class="tiny">Arah pasar</span><br><b>' + esc(getMarketText(opp, profile)) + '</b></div>' +
        '<div><span class="tiny">Trade evidence</span><br><b>' + esc(evidenceText) + '</b></div>' +
        '<div><span class="tiny">Risiko yang perlu diperiksa</span><ul>' + risks + '</ul></div>' +
        '<div class="actions"><button data-test="' + esc(opp.id) + '">Lihat uji awal</button><button data-evidence="' + esc(opp.id) + '">Lihat bukti pasar</button></div>' +
        '<div class="tiny" id="test-' + esc(opp.id) + '" hidden><b>Langkah uji:</b> ' + esc(opp.first_test) + '</div></article>';
    }).join("");
    $("recommendations").querySelectorAll("[data-test]").forEach(btn => {
      btn.addEventListener("click", () => {
        const el = $("test-" + btn.dataset.test);
        el.hidden = !el.hidden;
        btn.textContent = el.hidden ? "Lihat uji awal" : "Sembunyikan uji";
      });
    });
    $("recommendations").querySelectorAll("[data-evidence]").forEach(btn => {
      btn.addEventListener("click", () => {
        const opp = catalog.find(o => o.id === btn.dataset.evidence);
        renderTradeTable(matchingTradeRows(opp, profile, 20), profile);
        $("tradeBody").closest(".panel").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    renderTradeTable(matchingTradeRows(null, profile, 30), profile);
  }
  function renderTradeTable(rows, profile) {
    const body = $("tradeBody");
    $("tradeMatches").textContent = rows.length;
    const mode = tradeFeed && tradeFeed.meta ? (tradeFeed.meta.mode || tradeFeed.meta.status || "unknown") : "no feed";
    $("tradeStatus").textContent = String(mode).toUpperCase().replaceAll("_", " ");
    $("tradeStatus").className = "pill " + (mode === "live" ? "green" : "gold");
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty">Tidak ada rekaman perdagangan yang cocok pada feed saat ini. Itu tidak membuktikan bahwa permintaan pasar tidak ada.</td></tr>';
      $("tradeNote").textContent = "Feed saat ini berstatus " + mode + ". Cocokkan kata kunci dengan klasifikasi HS; statistik barang yang dilaporkan tidak selalu memakai nama dagang. Data impor bukan penjualan retail.";
      return;
    }
    body.innerHTML = rows.map(item =>
      '<tr><td><b>' + esc(item.product_name || ("HS " + item.product_code)) + '</b><span class="tiny" style="display:block">HS ' + esc(item.product_code || "—") + '</span></td>' +
      '<td>' + esc(item.market_name || item.market_iso3 || "—") + '</td><td>' + esc(item.latest_year || "—") + '</td>' +
      '<td>' + compactUSD(number(item.latest_import_usd)) + '</td><td>' + pct(number(item.yoy_growth_pct)) + '</td>' +
      '<td>' + esc(item.data_mode || mode) + '</td></tr>'
    ).join("");
    $("tradeNote").textContent = "Data mode: " + mode + ". Dataset mencakup " +
      ((tradeFeed.meta && tradeFeed.meta.markets_with_data) || "jumlah pasar yang belum diketahui") +
      " pasar dengan data pada proses terakhir. Produk dipadankan melalui kata kunci nama/HS, bukan klasifikasi bisnis yang telah divalidasi.";
  }
  async function loadFeeds() {
    try {
      const responses = await Promise.allSettled([
        fetch(CATALOG_URL, { cache: "no-store" }),
        fetch(TRADE_URL + "?t=" + Date.now(), { cache: "no-store" })
      ]);
      if (responses[0].status === "fulfilled" && responses[0].value.ok) {
        const json = await responses[0].value.json();
        catalog = Array.isArray(json.opportunities) ? json.opportunities : [];
      } else {
        $("recommendations").innerHTML = '<div class="panel empty">Katalog ide gagal dimuat. Coba muat ulang halaman.</div>';
      }
      if (responses[1].status === "fulfilled" && responses[1].value.ok) {
        tradeFeed = await responses[1].value.json();
        tradeItems = Array.isArray(tradeFeed.items) ? tradeFeed.items : [];
      } else {
        tradeFeed = null; tradeItems = [];
      }
      if (!tradeFeed || !tradeFeed.meta) {
        $("tradeStatus").textContent = "FEED TIDAK TERSEDIA";
      } else if (tradeFeed.meta.mode === "preview") {
        $("tradeStatus").textContent = "PREVIEW TERBATAS";
      } else if (!tradeItems.length) {
        $("tradeStatus").textContent = "BELUM ADA DATA";
      } else {
        $("tradeStatus").textContent = String(tradeFeed.meta.mode || "DATA").toUpperCase();
      }
      const profile = collectProfile();
      renderRecommendations(profile);
    } catch (error) {
      console.error("GPIR feeds could not be loaded", error);
      $("tradeStatus").textContent = "FEED TIDAK TERSEDIA";
      $("tradeBody").innerHTML = '<tr><td colspan="6" class="empty">Feed GPIR tidak dapat diakses saat ini.</td></tr>';
    }
  }
  function renderInventory() {
    const target = $("inventoryList");
    if (!inventory.length) {
      target.innerHTML = '<div class="empty">Belum ada resource yang dicatat.</div>';
      return;
    }
    target.innerHTML = inventory.map((item, index) =>
      '<div class="inventory-item"><div><b>' + esc(item.name) + '</b><small>' +
      esc(item.quantity == null ? "volume belum diisi" : new Intl.NumberFormat("id-ID").format(item.quantity) + " " + item.unit) +
      ' · ' + esc(item.seasonLabel) + (item.area ? " · " + esc(item.area) : "") +
      (item.price == null ? "" : " · " + esc(money(item.price)) + "/" + esc(item.unit)) +
      (item.quality ? " · " + esc(item.quality) : "") +
      '</small></div><button data-delete="' + index + '">Hapus</button></div>'
    ).join("");
    target.querySelectorAll("[data-delete]").forEach(btn => btn.addEventListener("click", () => {
      inventory.splice(Number(btn.dataset.delete), 1);
      saveInventory();
      renderRecommendations(collectProfile());
    }));
  }
  function addInventory() {
    const name = $("invName").value.trim();
    if (!name) { alert("Isi nama sumber daya terlebih dahulu."); $("invName").focus(); return; }
    const season = $("invSeason").value;
    const seasonLabel = {
      "year-round": "Sepanjang tahun", seasonal: "Musiman",
      surplus: "Surplus tertentu", unknown: "Belum diketahui"
    }[season] || season;
    inventory.push({
      id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + "-" + Math.random()),
      name, quantity: number($("invQty").value), unit: $("invUnit").value,
      price: number($("invPrice").value), season, seasonLabel,
      area: $("invArea").value.trim(), quality: $("invQuality").value.trim(),
      created_at: new Date().toISOString(), provenance: "user-entered-local-browser"
    });
    if (!saveInventory()) return;
    ["invName", "invQty", "invPrice", "invArea", "invQuality"].forEach(id => $(id).value = "");
    renderRecommendations(collectProfile());
  }
  function exportInventory() {
    const payload = { schema_version: "1.0", exported_at: new Date().toISOString(), visibility: "local user-entered inventory", resources: inventory };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "gpir-local-resource-inventory.json"; a.click();
    URL.revokeObjectURL(url);
  }
  async function importInventory(file) {
    try {
      const raw = JSON.parse(await file.text());
      const rows = Array.isArray(raw) ? raw : raw.resources;
      if (!Array.isArray(rows)) throw new Error("Format harus berupa array atau objek dengan properti resources.");
      const valid = rows.filter(r => r && typeof r.name === "string" && r.name.trim()).map(r => ({
        id: r.id || Date.now() + "-" + Math.random(), name: r.name.trim(),
        quantity: number(r.quantity), unit: String(r.unit || "kg"),
        price: number(r.price), season: String(r.season || "unknown"),
        seasonLabel: String(r.seasonLabel || r.season || "Belum diketahui"),
        area: String(r.area || ""), quality: String(r.quality || ""),
        created_at: r.created_at || new Date().toISOString(),
        provenance: "imported-user-inventory"
      }));
      inventory = valid;
      if (saveInventory()) renderRecommendations(collectProfile());
    } catch (e) { alert("Gagal impor: " + e.message); }
    $("importInventory").value = "";
  }
  function clearProfile() {
    ["district", "province", "resources", "skills"].forEach(id => $(id).value = "");
    $("capital").value = "micro"; $("targetMarket").value = "both";
    renderRecommendations(collectProfile());
  }
  function initMap() {
    if (!window.L) {
      $("poiMap").innerHTML = '<div class="empty">Pustaka peta tidak tersedia. Daftar hasil tetap bisa dilihat setelah pencarian.</div>';
      return;
    }
    poiMap = L.map("poiMap", { scrollWheelZoom: false }).setView([-2.5, 118], 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(poiMap);
    poiMarkers = L.layerGroup().addTo(poiMap);
  }
  function distanceKm(aLat, aLon, bLat, bLon) {
    const rad = x => x * Math.PI / 180, R = 6371;
    const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function safeHttpUrl(value) {\n    try { const url = new URL(String(value || ""), window.location.href); return (url.protocol === "http:" || url.protocol === "https:") ? url.href : ""; } catch (_) { return ""; }\n  }\n  function renderPOIs(elements, lat, lon) {
    $("poiCount").textContent = elements.length + " lokasi";
    $("poiSummary").textContent = elements.length ? ("Ditemukan " + elements.length + " titik terpetakan; belum diverifikasi di lapangan.") : "Tidak ada titik yang cocok pada hasil ini.";
    const html = elements.map(el => {
      const tags = el.tags || {};
      const name = tags.name || tags.brand || tags.operator || "Lokasi tanpa nama";
      const type = tags.shop ? "Toko: " + tags.shop :
        tags.amenity ? "Fasilitas: " + tags.amenity :
        tags.craft ? "Kerajinan: " + tags.craft :
        tags.office ? "Kantor: " + tags.office : "Tempat terpetakan";
      const lat2 = number(el.lat != null ? el.lat : el.center && el.center.lat);
      const lon2 = number(el.lon != null ? el.lon : el.center && el.center.lon);
      const distance = lat2 == null || lon2 == null ? null : distanceKm(lat, lon, lat2, lon2);
      return { el, name, type, lat2, lon2, distance };
    }).sort((a,b) => (a.distance ?? 9999) - (b.distance ?? 9999));
    $("poiResults").innerHTML = html.length ? html.slice(0, 60).map(p =>
      '<div class="poi-item"><b>' + esc(p.name) + '</b><span>' + esc(p.type) + (p.distance == null ? "" : " · " + (p.distance < 1 ? (p.distance * 1000).toFixed(0) + " m" : p.distance.toFixed(1) + " km")) + '</span>' +
      (p.el.tags && safeHttpUrl(p.el.tags.website) ? '<a href="' + esc(safeHttpUrl(p.el.tags.website)) + '" target="_blank" rel="noopener noreferrer">Website ↗</a>' : "") + '</div>'
    ).join("") : '<div class="empty">Tidak ada hasil. Coba radius lebih luas atau koordinat lain.</div>';
    if (poiMarkers) {
      poiMarkers.clearLayers();
      html.slice(0, 100).forEach(p => {
        if (p.lat2 == null || p.lon2 == null) return;
        const marker = L.circleMarker([p.lat2, p.lon2], { radius: 5, color: "#fff", weight: 1, fillColor: "#2168cf", fillOpacity: .85 });
        marker.bindPopup("<b>" + esc(p.name) + "</b><br>" + esc(p.type));
        marker.addTo(poiMarkers);
      });
      if (html.some(p => p.lat2 != null && p.lon2 != null)) {
        const bounds = poiMarkers.getBounds();
        if (bounds.isValid()) poiMap.fitBounds(bounds.pad(.15), { maxZoom: 14 });
      } else poiMap.setView([lat, lon], 12);
    }
  }
  async function searchNearby() {
    const lat = number($("lat").value), lon = number($("lon").value), radius = Number($("radius").value);
    if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      alert("Masukkan koordinat latitude/longitude yang valid, atau gunakan lokasi perangkat."); return;
    }
    $("poiSummary").textContent = "Mencari pada OpenStreetMap / Overpass…";
    $("poiResults").innerHTML = '<div class="empty">Permintaan sedang diproses. Endpoint publik bisa sibuk.</div>';
    const query = '[out:json][timeout:25];(' +
      'nwr(around:' + radius + ',' + lat + ',' + lon + ')["shop"];' +
      'nwr(around:' + radius + ',' + lat + ',' + lon + ')["amenity"~"marketplace|restaurant|cafe|fast_food|food_court|community_centre"];' +
      'nwr(around:' + radius + ',' + lat + ',' + lon + ')["craft"];' +
      'nwr(around:' + radius + ',' + lat + ',' + lon + ')["office"~"company|commercial"];' +
      ');out center tags;';
    try {
      const response = await fetch("https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(query), {
        headers: { "Accept": "application/json" }
      });
      if (!response.ok) throw new Error("HTTP " + response.status + ". Server publik mungkin sibuk.");
      const payload = await response.json();
      const unique = new Map();
      (payload.elements || []).forEach(el => unique.set(el.type + "/" + el.id, el));
      const list = [...unique.values()];
      renderPOIs(list, lat, lon);
    } catch (error) {
      $("poiSummary").textContent = "Pencarian gagal.";
      $("poiCount").textContent = "—";
      $("poiResults").innerHTML = '<div class="empty">Overpass tidak merespons: ' + esc(error.message) + '<br>Coba lagi nanti atau buka Overpass Turbo.</div>';
    }
  }
  function useBrowserLocation() {
    if (!navigator.geolocation) { alert("Browser tidak mendukung geolokasi."); return; }
    $("geoBtn").disabled = true; $("geoBtn").textContent = "Meminta lokasi…";
    navigator.geolocation.getCurrentPosition(pos => {
      $("lat").value = pos.coords.latitude.toFixed(6);
      $("lon").value = pos.coords.longitude.toFixed(6);
      $("geoBtn").disabled = false; $("geoBtn").textContent = "Gunakan lokasi saya";
    }, err => {
      $("geoBtn").disabled = false; $("geoBtn").textContent = "Gunakan lokasi saya";
      alert("Lokasi tidak dapat diakses: " + err.message + ". Isi koordinat manual.");
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
  }

  $("findBtn").addEventListener("click", () => renderRecommendations(collectProfile()));
  $("clearBtn").addEventListener("click", clearProfile);
  $("addInventory").addEventListener("click", addInventory);
  $("exportInventory").addEventListener("click", exportInventory);
  $("clearInventory").addEventListener("click", () => {
    if (!inventory.length || confirm("Hapus semua resource lokal dari browser ini?")) {
      inventory = []; saveInventory(); renderRecommendations(collectProfile());
    }
  });
  $("importInventory").addEventListener("change", e => {
    if (e.target.files && e.target.files[0]) importInventory(e.target.files[0]);
  });
  $("nearbyBtn").addEventListener("click", searchNearby);
  $("geoBtn").addEventListener("click", useBrowserLocation);

  renderInventory();
  initMap();
  loadFeeds();
})();