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
  let poiConnections = null;
  let userMarker = null;
  let radiusCircle = null;
  let areaRectangle = null;
  let selectedAreaBounds = null;
  let currentLocation = null;
  let currentLocationLabel = "";
  let nearbyPoints = [];
  let activeOpportunityId = null;
  let markerIndex = new Map();
  let lastOverpassRequestAt = 0;
  const POI_CACHE_TTL = 6 * 60 * 60 * 1000;
  const GEOCODE_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
  const POI_COLORS = { retail:"#2563eb", market:"#d97706", food_buyer:"#b45309", supplier:"#7c3aed", maker:"#7c3aed", service:"#0891b2", institution:"#059669", other:"#64748b" };

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
      businessScale: $("businessScale") ? $("businessScale").value : "micro",
      buyerSegment: $("buyerSegment") ? $("buyerSegment").value : "mixed",
      market: $("targetMarket").value,
      resourceText: resources.join(", "),
      resources: [...new Set(resources.map(clean).filter(Boolean))],
      skills: [...new Set(tokenize($("skills").value).map(clean).filter(Boolean))]
    };
  }
  function hasKeyword(texts, keywords) {
    // Match complete words/phrases, not broad substrings that cause accidental fits.
    return keywords.some(k => {
      const key = clean(k).replace(/\s+/g, " ");
      if (!key) return false;
      const escaped = key.split("").map(ch => /[.*+?^$()|[\]{}\\]/.test(ch) ? "\\" + ch : ch).join("").replace(/\s+/g, "\\s+");
      const pattern = new RegExp("(?:^|[^a-z0-9])" + escaped + "(?:$|[^a-z0-9])", "i");
      return texts.some(t => pattern.test(clean(t).replace(/\s+/g, " ")));
    });
  }
  function getResourceMatches(opp, profile) {
    return opp.resource_keywords.filter(k => hasKeyword(profile.resources, [k]));
  }
  function getSkillMatches(opp, profile) {
    return opp.skill_keywords.filter(k => hasKeyword(profile.skills, [k]));
  }
  function businessType(opp) {
    if (opp.business_type) return opp.business_type;
    if (opp.id === "local-aggregation" || opp.id === "textile-craft-micro") return "service";
    return "sell";
  }
  function businessTypeLabel(type) {
    return type === "grow" ? "Tanam / budidaya" : type === "service" ? "Usaha jasa" : "Jual produk / olahan";
  }
  function findNearbyLeads(opp) {
    const wanted = Array.isArray(opp.map_categories) ? opp.map_categories : [];
    return wanted.length ? nearbyPoints.filter(p=>wanted.includes(p.category)).sort((a,b)=>(a.distance??9999)-(b.distance??9999)) : [];
  }
  function buyerSegmentLabel(segment) {
    return ({consumers:"Konsumen rumah tangga",msme:"UMKM: mikro, kecil, menengah",business:"Perusahaan / institusi / grosir",export:"Importir / distributor luar negeri",mixed:"Campuran / belum ditentukan"})[segment] || "Campuran / belum ditentukan";
  }
  function segmentFit(opp, segment) {
    if (!segment || segment === "mixed") return true;
    const id = opp.id || "";
    const consumers = ["cassava-snacks","fruit-preservation","coconut-value-added","coffee-cacao","dried-spices","fish-shelf-stable","textile-craft-micro","service-repair","service-local-delivery","grow-plant-nursery"];
    const msme = ["coconut-value-added","cassava-snacks","coffee-cacao","dried-spices","fish-shelf-stable","fruit-preservation","bamboo-rattan-craft","textile-craft-micro","local-aggregation","grow-fast-greens","grow-plant-nursery","sell-compost","service-repair","service-local-delivery"];
    const business = ["coconut-value-added","coffee-cacao","dried-spices","fish-shelf-stable","fruit-preservation","bamboo-rattan-craft","textile-craft-micro","local-aggregation","grow-fast-greens","grow-plant-nursery","sell-compost","service-repair","service-local-delivery"];
    const exports = ["coconut-value-added","coffee-cacao","dried-spices","bamboo-rattan-craft","textile-craft-micro"];
    return segment==="consumers" ? consumers.includes(id) : segment==="msme" ? msme.includes(id) :
      segment==="business" ? business.includes(id) : segment==="export" ? exports.includes(id) : true;
  }
  function scaleAdvice(opp, scale) {
    return ({
      micro:"Uji batch kecil atau pre-order; hitung biaya per unit sebelum membeli alat.",
      small:"Standarkan mutu/kemasan, jadwalkan produksi dan pengiriman, catat arus kas serta pesanan ulang.",
      medium:"Validasi kapasitas pasok, kontrol mutu, izin/sertifikasi, modal kerja, kontrak B2B dan logistik.",
      scalable:"Mulai dengan pilot mikro; naikkan kapasitas setelah ada pesanan berulang dan biaya per unit terukur."
    })[scale] || "Mulai dari skala yang sesuai modal dan kemampuan saat ini.";
  }
  function rankOpportunity(opp, profile) {
    const resourceMatches=getResourceMatches(opp,profile), skillMatches=getSkillMatches(opp,profile);
    const hasInputs=profile.resources.length>0||profile.skills.length>0;
    const resourceScore=profile.resources.length?Math.min(60,resourceMatches.length*24):0;
    const skillScore=profile.skills.length?Math.min(20,skillMatches.length*10):0;
    const marketScore=opp.market_fit.includes(profile.market)?8:0;
    const segmentMatches=segmentFit(opp,profile.buyerSegment);
    const buyerScore=profile.buyerSegment==="mixed"?5:(segmentMatches?12:0);
    const capitalScore=profile.capital==="micro"&&opp.capital_level==="micro"?5:profile.capital==="small"?4:profile.capital==="medium"?3:2;
    const scaleBonus=profile.businessScale==="micro"&&opp.capital_level==="micro"?5:profile.businessScale==="small"?4:profile.businessScale==="medium"?3:5;
    const evidence=matchingTradeRows(opp,profile,3), locationMatches=findNearbyLeads(opp);
    const hasResourceFit=resourceMatches.length>0, hasSkillFit=skillMatches.length>0;
    const rawScore=resourceScore+skillScore+marketScore+buyerScore+capitalScore+scaleBonus;
    return {...opp,business_type:businessType(opp),resourceMatches,skillMatches,evidenceCount:evidence.length,locationMatches,
      locationScore:Math.min(15,locationMatches.length*3),buyerSegmentMatch:segmentMatches,
      fitScore:hasInputs?Math.min(100,Math.round(rawScore)):null,
      hasInputs,hasResourceFit,hasSkillFit,scaleAdvice:scaleAdvice(opp,profile.businessScale)};
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
  function businessSearchUrl(base, query) { return base + encodeURIComponent(String(query||"").trim()); }
  function firstText(list,fallback) { return Array.isArray(list)&&list.length?list.slice(0,3).join(" · "):fallback; }
  function localAreaText(profile) { return [profile.district,profile.province].filter(Boolean).join(", ")||currentLocationLabel||"lokasi terpilih"; }
  function renderRecommendations(profile) {
    const all=catalog.map(o=>rankOpportunity(o,profile)).sort((a,b)=>
      Number(b.hasResourceFit)-Number(a.hasResourceFit)||Number(b.hasSkillFit)-Number(a.hasSkillFit)||
      b.locationMatches.length-a.locationMatches.length||(b.fitScore??-1)-(a.fitScore??-1)||b.evidenceCount-a.evidenceCount);
    lastRecommendations=all;
    const chosenType=$("businessTypeFilter")?$("businessTypeFilter").value:"all";
    const candidates=chosenType==="all"?all:all.filter(o=>o.business_type===chosenType);
    const matches=candidates.filter(o=>o.hasResourceFit||o.hasSkillFit);
    $("recCount").textContent=Math.min(6,candidates.length);
    $("resourceMatches").textContent=matches.length;
    const statuses=[];
    if(profile.resources.length||profile.skills.length)statuses.push(matches.length+" IDE SELARAS INPUT");
    if(currentLocation)statuses.push(nearbyPoints.length+" TITIK SEKITAR");
    $("recommendationStatus").textContent=statuses.join(" · ")||"IDE AWAL — PERLU DIUJI";
    $("recommendationStatus").className="pill "+(matches.length||nearbyPoints.length?"green":"gold");
    let display;
    if(chosenType==="all"&&!profile.resources.length&&!profile.skills.length){
      // Show a balanced starter set across product sales, cultivation and services before user inputs exist.
      display=["sell","grow","service"].flatMap(type=>all.filter(o=>o.business_type===type).slice(0,2))
        .sort((a,b)=>b.locationMatches.length-a.locationMatches.length||(b.fitScore??-1)-(a.fitScore??-1)||b.evidenceCount-a.evidenceCount);
    } else display=candidates.slice(0,6);
    if(!display.length){$("recommendations").innerHTML='<div class="panel empty">Tidak ada ide pada kategori ini. Coba jenis usaha lain.</div>';renderRelationshipFlow(null,profile);renderTradeTable([],profile);return;}
    const selectedBeforeRender=candidates.find(o=>o.id===activeOpportunityId)||display[0];
    activeOpportunityId=selectedBeforeRender?selectedBeforeRender.id:null;
    const area=localAreaText(profile);
    $("recommendations").innerHTML=display.map((opp,i)=>{
      const type=opp.business_type,typeClass=type==="grow"?"grow":type==="service"?"service":"sell";
      const what=firstText(opp.products,"layanan sesuai keterampilan");
      const resourceText=opp.resourceMatches.length?"Cocok dengan: "+opp.resourceMatches.join(", "):
        (profile.resources.length?"Belum ada bahan yang cocok; periksa ketersediaan sebelum memilih.":"Tambahkan sumber daya lokal untuk pencocokan lebih akurat.");
      const skillText=opp.skillMatches.length?"Keterampilan cocok: "+opp.skillMatches.join(", "):(profile.skills.length?"Kecocokan skill belum terdeteksi.":"Sesuaikan dengan keterampilan yang sudah dikuasai.");
      const leadText=opp.locationMatches.length?opp.locationMatches.slice(0,3).map(p=>p.name+" ("+(p.distance==null?"jarak tidak ada":p.distance<1?Math.round(p.distance*1000)+" m":p.distance.toFixed(1)+" km")+")").join(" · "):
        (currentLocation?"Belum ada titik kategori cocok; bukan berarti pembeli tidak ada.":"Tentukan lokasi untuk memetakan kanal yang tersedia.");
      const trade=matchingTradeRows(opp,profile,2);
      const tradeText=trade.length?trade.map(t=>(t.market_name||t.market_iso3)+": "+compactUSD(number(t.latest_import_usd))+" ("+(t.latest_year||"tahun?")+")").join(" · "):"Belum ada padanan perdagangan yang cocok.";
      const buy=(opp.buy_from||["Pemasok lokal yang bisa diverifikasi","Bandingkan harga, kualitas dan ongkir"]).slice(0,3).map(x=>"<li>"+esc(x)+"</li>").join("");
      const sell=(opp.sell_to||["Wawancarai calon pembeli lokal"]).slice(0,3).map(x=>"<li>"+esc(x)+"</li>").join("");
      const channels=(opp.channels||["Pre-order skala kecil","Ukur penjualan dan pesanan ulang"]).slice(0,2).map(x=>"<li>"+esc(x)+"</li>").join("");
      const supplierQuery=[opp.local_input_search||"pemasok bahan",area].join(" ");
      const buyerQuery=[opp.local_buyer_search||(opp.sell_to||["calon pembeli"]).slice(0,2).join(" "),area].join(" ");
      const onlineQuery=opp.online_input_search||(opp.products||[]).slice(0,2).join(" ");
      const foreignQuery=opp.international_search||(opp.products||[]).slice(0,2).join(" ")+" importer";
      const icon=type==="grow"?"🌱":type==="service"?"🛠️":"🛍️";
      const fit=opp.fitScore==null?"Lengkapi input":opp.fitScore+"/100 cocok-input";
      const scaleLabels={micro:"Mikro / rumahan",small:"Kecil / UMKM berkembang",medium:"Menengah / SME supplier",scalable:"Mulai kecil lalu scale-up"};
      const scaleLabel=scaleLabels[profile.businessScale]||scaleLabels.micro;
      const buyerLabel=buyerSegmentLabel(profile.buyerSegment);
      const buyerFitText=profile.buyerSegment==="mixed"?"Segmen pembeli masih terbuka":opp.buyerSegmentMatch?"Sesuai segmen pelanggan yang dipilih":"Validasi segmen pelanggan alternatif";
      const steps=Array.isArray(opp.start_steps)?opp.start_steps:[opp.first_test||"Wawancarai calon pembeli dan hitung biaya per unit."];
      const stepHtml="<ol>"+steps.map(s=>"<li>"+esc(s)+"</li>").join("")+"</ol>";
      return '<article class="rec '+(opp.id===activeOpportunityId?'is-selected':'')+'" data-opportunity-card="'+esc(opp.id)+'"><div class="kind-row"><span class="kind-badge '+typeClass+'">'+icon+' '+esc(businessTypeLabel(type))+'</span><span class="'+(opp.fitScore==null?"tiny":"fit")+'">'+esc(fit)+'</span></div>'+
        '<h3>'+esc(opp.title)+'</h3><p class="action-summary">'+esc(opp.action_summary||opp.rationale)+'</p>'+
        '<div class="rec-detail-grid"><div class="rec-detail"><h4>Yang bisa dibuat / ditawarkan</h4><p><b>'+esc(what)+'</b></p><p class="tiny" style="margin-top:6px">'+esc(resourceText)+'</p><p class="tiny" style="margin-top:5px">'+esc(skillText)+'</p></div>'+
        '<div class="rec-detail"><h4>Yang perlu dibeli / disiapkan</h4><ul>'+buy+'</ul><p class="tiny" style="margin-top:6px">Modal pilot mikro indikatif: <b>'+esc(capitalRange(opp))+'</b></p><p class="tiny" style="margin-top:6px"><b>Skala:</b> '+esc(scaleLabel)+'</p><p class="tiny" style="margin-top:4px">'+esc(opp.scaleAdvice||"Sesuaikan skala dengan modal dan kemampuan.")+'</p></div>'+
        '<div class="rec-detail"><h4>Calon pembeli awal</h4><ul>'+sell+'</ul><p class="tiny" style="margin-top:6px"><b>Segmen pilihan:</b> '+esc(buyerLabel)+' · '+esc(buyerFitText)+'</p><p class="tiny" style="margin-top:6px">Kanal terpetakan: '+esc(leadText)+'</p></div>'+
        '<div class="rec-detail"><h4>Cara mulai mencari pelanggan</h4><ul>'+channels+'</ul><p class="tiny" style="margin-top:6px">'+esc(getMarketText(opp,profile))+'</p></div>'+
        '<div class="rec-detail"><h4>Sinyal perdagangan luar</h4><p>'+esc(tradeText)+'</p><p class="tiny" style="margin-top:5px">Impor negara bukan bukti buyer tertentu atau penjualan retail.</p></div>'+
        '<div class="rec-detail"><h4>Langkah uji pertama</h4><div class="tiny">'+stepHtml+'</div><ul>'+((opp.risks||[]).slice(0,2).map(r=>"<li>"+esc(r)+"</li>").join(""))+'</ul></div></div>'+
        '<div class="external-links"><a href="'+esc(businessSearchUrl("https://www.google.com/maps/search/?api=1&query=",supplierQuery))+'" target="_blank" rel="noopener noreferrer">Cari pemasok sekitar ↗</a>'+
        '<a href="'+esc(businessSearchUrl("https://www.google.com/maps/search/?api=1&query=",buyerQuery))+'" target="_blank" rel="noopener noreferrer">Cari calon pembeli ↗</a>'+
        '<a href="'+esc(businessSearchUrl("https://www.tokopedia.com/search?st=product&q=",onlineQuery))+'" target="_blank" rel="noopener noreferrer">Cari input di Tokopedia ↗</a>'+
        '<a href="'+esc(businessSearchUrl("https://shopee.co.id/search?keyword=",onlineQuery))+'" target="_blank" rel="noopener noreferrer">Cari input di Shopee ↗</a>'+
        '<a href="'+esc(businessSearchUrl("https://www.alibaba.com/trade/search?SearchText=",foreignQuery))+'" target="_blank" rel="noopener noreferrer">Cari pemasok luar ↗</a></div>'+
        '<div class="actions"><button class="primary" data-map-flow="'+esc(opp.id)+'">Tampilkan hubungan di peta</button><button data-test="'+esc(opp.id)+'">Langkah uji pertama</button><button data-evidence="'+esc(opp.id)+'">Bukti perdagangan</button></div>'+
        '<div class="tiny" id="test-'+esc(opp.id)+'" hidden><b>Langkah uji:</b> '+esc(opp.first_test||"")+'</div></article>';
    }).join("");
    $("recommendations").querySelectorAll("[data-test]").forEach(btn=>btn.addEventListener("click",()=>{
      const el=$("test-"+btn.dataset.test);el.hidden=!el.hidden;btn.textContent=el.hidden?"Langkah uji pertama":"Sembunyikan langkah";
    }));
    $("recommendations").querySelectorAll("[data-map-flow]").forEach(btn=>btn.addEventListener("click",()=>{
      const opp=lastRecommendations.find(o=>o.id===btn.dataset.mapFlow);activeOpportunityId=btn.dataset.mapFlow;
      renderRelationshipFlow(opp,collectProfile());
      if(currentLocation)renderPOIs(nearbyPoints.map(p=>p.raw),currentLocation.lat,currentLocation.lon);
      $("recommendations").querySelectorAll("[data-opportunity-card]").forEach(card=>card.classList.toggle("is-selected",card.dataset.opportunityCard===activeOpportunityId));
      $("pathwaySection")?.scrollIntoView({behavior:"smooth",block:"center"});
      $("relationshipTitle").scrollIntoView({behavior:"smooth",block:"center"});
    }));
    $("recommendations").querySelectorAll("[data-evidence]").forEach(btn=>btn.addEventListener("click",()=>{
      const opp=catalog.find(o=>o.id===btn.dataset.evidence);renderTradeTable(matchingTradeRows(opp,profile,20),profile);
      $("tradeBody").closest(".panel").scrollIntoView({behavior:"smooth",block:"start"});
    }));
    const selected=candidates.find(o=>o.id===activeOpportunityId)||display[0];
    if(selected){activeOpportunityId=selected.id;renderRelationshipFlow(selected,profile);}
    $("recommendations").querySelectorAll("[data-opportunity-card]").forEach(card=>card.classList.toggle("is-selected",card.dataset.opportunityCard===activeOpportunityId));
    renderTradeTable(matchingTradeRows(null,profile,30),profile);
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
    $("capital").value = "micro"; $("businessScale").value = "micro"; $("buyerSegment").value = "mixed"; $("targetMarket").value = "both";
    renderRecommendations(collectProfile());
  }
  function initMap() {
    if(!window.L){$("poiMap").innerHTML='<div class="empty">Pustaka peta tidak tersedia. Daftar hasil tetap bisa dilihat.</div>';return;}
    poiMap=L.map("poiMap",{scrollWheelZoom:false}).setView([-2.5,118],4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:18,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(poiMap);
    poiMarkers=L.layerGroup().addTo(poiMap);poiConnections=L.layerGroup().addTo(poiMap);
  }
  function distanceKm(aLat,aLon,bLat,bLon){const rad=x=>x*Math.PI/180,R=6371,dLat=rad(bLat-aLat),dLon=rad(bLon-aLon),x=Math.sin(dLat/2)**2+Math.cos(rad(aLat))*Math.cos(rad(bLat))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(x));}
  function safeHttpUrl(value){try{const u=new URL(String(value||""),window.location.href);return ["http:","https:"].includes(u.protocol)?u.href:"";}catch(_){return "";}}
  function classifyPOI(el){
    const t=el.tags||{},shop=String(t.shop||"").toLowerCase(),amenity=String(t.amenity||"").toLowerCase(),craft=String(t.craft||"").toLowerCase(),office=String(t.office||"").toLowerCase(),landuse=String(t.landuse||"").toLowerCase();
    if(amenity==="marketplace")return {category:"market",label:"Pasar / marketplace",color:POI_COLORS.market};
    if(["restaurant","cafe","fast_food","food_court","bakery","ice_cream"].includes(amenity))return {category:"food_buyer",label:"Usaha kuliner",color:POI_COLORS.food_buyer};
    if(["car_repair","motorcycle_repair","bicycle_repair","tailor","electronics_repair","shoemaker"].includes(craft)||["car_repair","bicycle","motorcycle"].includes(shop)||["car_repair","repair"].includes(amenity))return {category:"service",label:"Jasa / bengkel",color:POI_COLORS.service};
    if(["farmland","orchard","plant_nursery"].includes(landuse)||["agrarian","farm"].includes(shop))return {category:"supplier",label:"Pertanian / pemasok",color:POI_COLORS.supplier};
    if(shop==="wholesale"||office==="wholesale")return {category:"supplier",label:"Pemasok / grosir",color:POI_COLORS.supplier};
    if(craft||["company","commercial"].includes(office))return {category:"maker",label:"Pengrajin / usaha",color:POI_COLORS.maker};
    if(shop)return {category:"retail",label:"Toko / retail",color:POI_COLORS.retail};
    if(["school","hospital","clinic","community_centre","hotel","guest_house"].includes(amenity))return {category:"institution",label:"Institusi / fasilitas",color:POI_COLORS.institution};
    return {category:"other",label:"Titik usaha/fasilitas",color:POI_COLORS.other};
  }
  function readTimedCache(key,ttl){
    try{let obj=JSON.parse(sessionStorage.getItem(key)||"null");if(obj&&obj.savedAt&&Date.now()-obj.savedAt<ttl)return obj.data;}catch(_){}
    try{let obj=JSON.parse(localStorage.getItem(key)||"null");if(obj&&obj.savedAt&&Date.now()-obj.savedAt<ttl)return obj.data;}catch(_){}
    return null;
  }
  function writeTimedCache(key,data){
    const obj=JSON.stringify({savedAt:Date.now(),data});
    try{sessionStorage.setItem(key,obj);}catch(_){}
    if(key.startsWith("gpir:geocode:"))try{localStorage.setItem(key,obj);}catch(_){}
  }
  function validBounds(b) { return !!b && [b.south,b.west,b.north,b.east].every(Number.isFinite) && b.south<b.north && b.west<b.east && (b.north-b.south)*(b.east-b.west)<=1.2; }
  function parseBounds(raw) {
    if(!Array.isArray(raw)||raw.length<4)return null;
    const b={south:Number(raw[0]),north:Number(raw[1]),west:Number(raw[2]),east:Number(raw[3])};
    return validBounds(b)?b:null;
  }
  function scopeKey() {
    return $("coverage")&&$("coverage").value==="area"&&validBounds(selectedAreaBounds)
      ? "area:"+[selectedAreaBounds.south,selectedAreaBounds.west,selectedAreaBounds.north,selectedAreaBounds.east].map(v=>v.toFixed(3)).join(",")
      : "nearby:"+Number($("radius").value||3000);
  }
  function updateMapCenter(lat,lon){
    if(!poiMap||lat==null||lon==null)return;
    if(userMarker)poiMap.removeLayer(userMarker);if(radiusCircle)poiMap.removeLayer(radiusCircle);if(areaRectangle)poiMap.removeLayer(areaRectangle);
    userMarker=L.circleMarker([lat,lon],{radius:8,color:"#fff",weight:2,fillColor:"#dc2626",fillOpacity:1}).bindPopup("<b>Lokasi aktif</b><br>"+esc(currentLocationLabel||"Lokasi terpilih")).addTo(poiMap);
    if($("coverage")&&$("coverage").value==="area"&&validBounds(selectedAreaBounds)){
      areaRectangle=L.rectangle([[selectedAreaBounds.south,selectedAreaBounds.west],[selectedAreaBounds.north,selectedAreaBounds.east]],{color:"#2563eb",weight:2,dashArray:"6 4",fillColor:"#60a5fa",fillOpacity:.05}).addTo(poiMap);
      poiMap.fitBounds(areaRectangle.getBounds(),{padding:[12,12],maxZoom:11});
    } else {
      const radius=Number($("radius").value||3000);
      radiusCircle=L.circle([lat,lon],{radius,color:"#dc2626",weight:1,dashArray:"5 5",fillColor:"#dc2626",fillOpacity:.035}).addTo(poiMap);
      poiMap.setView([lat,lon],radius<=1000?14:radius<=3000?13:radius<=10000?11:10);
    }
  }
  function distanceLabel(km){return km==null?"jarak tidak tersedia":km<1?Math.round(km*1000)+" m":km.toFixed(1)+" km";}
  function renderPOIs(elements,lat,lon){
    if(lat==null||lon==null){nearbyPoints=[];$("poiCount").textContent="0 titik";$("poiSummary").textContent="Belum ada lokasi aktif.";return;}
    const normalized=(elements||[]).map(el=>{
      const t=el.tags||{},name=t.name||t.brand||t.operator||"Lokasi tanpa nama",type=classifyPOI(el);
      const lat2=number(el.lat!=null?el.lat:el.center&&el.center.lat),lon2=number(el.lon!=null?el.lon:el.center&&el.center.lon);
      return {raw:el,key:el.type+"/"+el.id,name,type:type.label,category:type.category,color:type.color,lat:lat2,lon:lon2,distance:lat2==null||lon2==null?null:distanceKm(lat,lon,lat2,lon2)};
    }).sort((a,b)=>(a.distance??9999)-(b.distance??9999));
    const unique=new Map();normalized.forEach(p=>unique.set(p.key,p));nearbyPoints=[...unique.values()].sort((a,b)=>(a.distance??9999)-(b.distance??9999));
    const active=lastRecommendations.find(o=>o.id===activeOpportunityId),wanted=active?(active.map_categories||[]):[];
    const relevant= p=>wanted.includes(p.category);
    const areaMode=$("coverage")&&$("coverage").value==="area"&&validBounds(selectedAreaBounds);
    const within=Number($("radius").value||3000);
    $("poiCount").textContent=nearbyPoints.length+" titik";
    $("poiSummary").textContent=nearbyPoints.length?nearbyPoints.length+" lokasi terpetakan "+(areaMode?"dalam area administrasi terpilih":"dalam radius "+(within/1000)+" km")+"; "+nearbyPoints.filter(relevant).length+" berkategori terkait ide aktif.":"Tidak ada titik ditemukan; data peta mungkin tidak lengkap.";
    if(poiMarkers)poiMarkers.clearLayers();if(poiConnections)poiConnections.clearLayers();markerIndex=new Map();
    const mapPoints=nearbyPoints.length<=350?nearbyPoints:nearbyPoints.filter((p,i)=>i%Math.ceil(nearbyPoints.length/350)===0).slice(0,350);
    mapPoints.forEach((p,i)=>{
      if(p.lat==null||p.lon==null)return;
      const isRelevant=relevant(p);
      if(poiConnections&&i<35)L.polyline([[lat,lon],[p.lat,p.lon]],{color:isRelevant?"#0d9488":p.color,weight:isRelevant?2.5:1,opacity:isRelevant?.65:.3,dashArray:isRelevant?"":"4 5"}).addTo(poiConnections);
      const marker=L.circleMarker([p.lat,p.lon],{radius:isRelevant?7:5,color:"#fff",weight:1,fillColor:p.color,fillOpacity:.9});
      marker.bindPopup("<b>"+esc(p.name)+"</b><br>"+esc(p.type)+"<br>"+esc(distanceLabel(p.distance))+(isRelevant?"<br><b>Kategori cocok dengan ide aktif</b>":""));
      marker.addTo(poiMarkers);markerIndex.set(p.key,marker);
    });
    updateMapCenter(lat,lon);
    if(!(areaMode&&validBounds(selectedAreaBounds))) poiMap.setView([lat,lon],within<=1000?14:within<=3000?13:within<=10000?11:10);
    $("poiResults").innerHTML=nearbyPoints.length?nearbyPoints.slice(0,60).map(p=>{
      const isRelevant=relevant(p),q=[p.name,currentLocationLabel].filter(Boolean).join(" ");
      const mapsUrl="https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(q);
      const osmType=({node:"node",way:"way",relation:"relation"})[p.raw.type]||"node",osmUrl="https://www.openstreetmap.org/"+osmType+"/"+encodeURIComponent(p.raw.id);
      const website=safeHttpUrl(p.raw.tags&&p.raw.tags.website);
      return '<div class="poi-item"><div class="poi-primary"><b>'+esc(p.name)+'</b><span class="poi-meta">'+esc(p.type)+' · '+esc(distanceLabel(p.distance))+'</span></div>'+
      (isRelevant?'<span class="relevance">Kategori cocok</span>':'<span class="tiny">'+esc(p.category)+'</span>')+
      '<div class="poi-actions"><button type="button" data-zoom-poi="'+esc(p.key)+'">Lihat di peta</button><a href="'+esc(mapsUrl)+'" target="_blank" rel="noopener noreferrer">Buka Maps ↗</a><a href="'+esc(osmUrl)+'" target="_blank" rel="noopener noreferrer">Data OSM ↗</a>'+
      (website?'<a href="'+esc(website)+'" target="_blank" rel="noopener noreferrer">Website ↗</a>':"")+'</div></div>';
    }).join(""):'<div class="empty">Belum ada titik. Coba radius lebih luas. Tidak adanya titik OSM bukan bukti tidak ada usaha/pembeli.</div>';
    $("poiResults").querySelectorAll("[data-zoom-poi]").forEach(btn=>btn.addEventListener("click",()=>{
      const p=nearbyPoints.find(x=>x.key===btn.dataset.zoomPoi),marker=markerIndex.get(btn.dataset.zoomPoi);
      if(p&&p.lat!=null&&p.lon!=null&&poiMap){poiMap.setView([p.lat,p.lon],16);if(marker)marker.openPopup();}
    }));
  }
  async function searchNearby(){
    const lat=number($("lat").value),lon=number($("lon").value),radius=Number($("radius").value||3000);
    if(lat==null||lon==null||lat< -90||lat>90||lon< -180||lon>180){$("locationStatus").textContent="Pilih lokasi perangkat atau cari kecamatan/kota terlebih dahulu.";return;}
    const areaMode=$("coverage")&&$("coverage").value==="area";
    if(areaMode&&!validBounds(selectedAreaBounds)){
      $("locationStatus").textContent="Untuk memetakan seluruh kota/area, cari nama wilayah administratif terlebih dahulu (contoh: Jakarta, Indonesia).";
      $("locationSearch").focus();return;
    }
    currentLocation={lat,lon};currentLocationLabel=currentLocationLabel||"Lokasi terpilih";updateMapCenter(lat,lon);
    $("locationStatus").textContent=areaMode?"Memetakan seluruh area terpilih…":"Mencari titik sekitar "+currentLocationLabel+"…";
    $("poiSummary").textContent="Mencari toko, pasar, pemasok, jasa, dan calon mitra…";
    $("poiResults").innerHTML='<div class="empty">Memuat data peta OpenStreetMap…</div>';
    const key="gpir:overpass:v3:"+scopeKey()+":"+lat.toFixed(3)+":"+lon.toFixed(3),cached=readTimedCache(key,POI_CACHE_TTL);
    if(Array.isArray(cached)){renderPOIs(cached,lat,lon);$("locationStatus").textContent="Hasil peta dimuat dari cache browser; verifikasi status tempat.";renderRecommendations(collectProfile());return;}
    if(Date.now()-lastOverpassRequestAt<1500){$("locationStatus").textContent="Tunggu sebentar sebelum mengulangi pencarian peta.";return;}
    lastOverpassRequestAt=Date.now();
    const shape=areaMode?'nwr('+selectedAreaBounds.south+','+selectedAreaBounds.west+','+selectedAreaBounds.north+','+selectedAreaBounds.east+')':'nwr(around:'+radius+','+lat+','+lon+')';
    const q='[out:json][timeout:35];('+shape+'["shop"];'+shape+'["amenity"~"marketplace|restaurant|cafe|fast_food|food_court|bakery|ice_cream|community_centre|school|hospital|clinic|car_repair|fuel"];'+shape+'["craft"];'+shape+'["office"~"company|commercial|wholesale"];'+shape+'["landuse"~"farmland|orchard|plant_nursery"];);out center tags;';
    try{
      const response=await fetch("https://overpass-api.de/api/interpreter?data="+encodeURIComponent(q),{headers:{"Accept":"application/json"}});
      if(!response.ok)throw new Error("HTTP "+response.status+". Endpoint publik mungkin sibuk.");
      const payload=await response.json(),unique=new Map();(payload.elements||[]).forEach(el=>unique.set(el.type+"/"+el.id,el));
      const list=[...unique.values()];writeTimedCache(key,list);renderPOIs(list,lat,lon);
      $("locationStatus").textContent="Analisis selesai. "+list.length+" titik ditemukan; verifikasi status tempat sebelum mengambil keputusan.";
      renderRecommendations(collectProfile());
    }catch(error){$("locationStatus").textContent="Pencarian peta gagal; rekomendasi umum tetap tersedia.";
      $("poiSummary").textContent="Layanan peta tidak merespons. Coba radius lokal atau ulangi beberapa saat lagi.";$("poiCount").textContent="—";
      $("poiResults").innerHTML='<div class="empty">Overpass gagal: '+esc(error.message)+'. Coba lagi nanti.</div>';}
  }
  function parseAddress(a){
    if(!a)return;const district=a.city_district||a.district||a.suburb||a.village||a.town||a.city||a.county;
    const province=[a.county&&a.county!==district?a.county:"",a.state].filter(Boolean).join(", ");
    if(district&&!$("district").value.trim())$("district").value=district;
    if(province&&!$("province").value.trim())$("province").value=province;
  }
  async function searchLocation(){
    const query=$("locationSearch").value.trim();
    if(query.length<3){$("locationStatus").textContent="Masukkan nama kecamatan, kota, desa atau alamat yang lebih lengkap.";return;}
    const key="gpir:geocode:search:"+query.toLowerCase();let item=readTimedCache(key,GEOCODE_CACHE_TTL);
    if(!item){
      $("locationSearchBtn").disabled=true;$("locationStatus").textContent="Mencari lokasi pilihan…";
      try{
        const response=await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q="+encodeURIComponent(query),{headers:{"Accept":"application/json"}});
        if(!response.ok)throw new Error("HTTP "+response.status);
        const results=await response.json();if(!results.length)throw new Error("Lokasi tidak ditemukan. Tambahkan kabupaten/provinsi.");
        item=results[0];writeTimedCache(key,item);
      }catch(error){$("locationStatus").textContent="Pencarian lokasi gagal: "+error.message+". Coba nama lebih lengkap atau deteksi lokasi perangkat.";
        $("locationSearchBtn").disabled=false;return;}
    }
    $("locationSearchBtn").disabled=false;const lat=number(item.lat),lon=number(item.lon);
    if(lat==null||lon==null){$("locationStatus").textContent="Koordinat lokasi tidak tersedia.";return;}
    currentLocationLabel=item.display_name||query;$("locationName").textContent=currentLocationLabel;
    $("lat").value=lat.toFixed(6);$("lon").value=lon.toFixed(6);parseAddress(item.address);currentLocation={lat,lon};
    selectedAreaBounds=parseBounds(item.boundingbox);
    $("locationStatus").textContent=$("coverage").value==="area"?"Area pilihan aktif; menyiapkan peta seluruh area…":"Lokasi pilihan aktif. Mencari titik sekitar…";
    updateMapCenter(lat,lon);await searchNearby();
  }
  function useBrowserLocation(options={}){
    const automatic=!!options.automatic;
    if(!navigator.geolocation){$("locationStatus").textContent="Browser tidak mendukung lokasi perangkat. Cari lokasi secara manual.";if(!automatic)alert("Browser tidak mendukung geolokasi.");return;}
    $("geoBtn").disabled=true;$("geoBtn").textContent="Meminta izin lokasi…";
    if(!automatic)$("locationStatus").textContent="Meminta izin lokasi dari browser…";
    navigator.geolocation.getCurrentPosition(async pos=>{
      const lat=pos.coords.latitude,lon=pos.coords.longitude;$("lat").value=lat.toFixed(6);$("lon").value=lon.toFixed(6);
      selectedAreaBounds=null;
      currentLocation={lat,lon};currentLocationLabel="Lokasi perangkat ("+lat.toFixed(3)+", "+lon.toFixed(3)+")";
      $("locationName").textContent=currentLocationLabel;$("geoBtn").disabled=false;$("geoBtn").textContent="◎ Deteksi lokasi saya";
      $("locationStatus").textContent="Lokasi terdeteksi; memeriksa titik terdekat…";updateMapCenter(lat,lon);await searchNearby();
    },err=>{
      $("geoBtn").disabled=false;$("geoBtn").textContent="◎ Deteksi lokasi saya";
      const message=err.code===1?"izin lokasi belum diberikan":err.code===2?"posisi tidak tersedia":"permintaan lokasi terlalu lama";
      $("locationStatus").textContent=automatic?"Lokasi otomatis tidak tersedia ("+message+"). Cari kecamatan/kota secara manual atau tekan Deteksi lokasi saya.":"Lokasi tidak dapat diakses ("+message+"). Cari nama lokasi secara manual.";
      if(!automatic&&err.code===1)alert("Izinkan akses lokasi di browser atau cari nama lokasi secara manual.");
    },{enableHighAccuracy:false,timeout:12000,maximumAge:300000});
  }
  function renderRelationshipFlow(opp,profile){
    if(!opp||!$("relationshipVisual"))return;
    const leads=findNearbyLeads(opp).slice(0,2),trade=matchingTradeRows(opp,profile,2);
    const input=[...profile.resources.slice(0,2),...profile.skills.slice(0,1)].join(" · ")||"Sumber daya/keterampilan belum diisi";
    const nodes=[
      {label:"INPUT LOKAL",value:input,detail:"Dari input pengguna/inventaris lokal"},
      {label:businessTypeLabel(opp.business_type),value:firstText(opp.products,opp.title),detail:opp.action_summary||opp.rationale},
      {label:"CALON PEMBELI",value:firstText(opp.sell_to,"Identifikasi lewat wawancara"),detail:firstText(opp.channels,"Uji kanal sebelum investasi")},
      {label:"TITIK SEKITAR",value:leads.length?leads.map(p=>p.name+" · "+distanceLabel(p.distance)).join(" / "):"Belum ada titik kategori cocok",detail:leads.length+" lokasi peta yang masuk kategori terkait; verifikasi dulu"},
      {label:"SINYAL PASAR LUAR",value:trade.length?trade.map(t=>(t.market_name||t.market_iso3)+" · "+compactUSD(number(t.latest_import_usd))+" / "+(t.latest_year||"tahun?")).join(" / "):"Belum ada padanan pada feed",detail:"Impor tahunan tingkat negara, bukan buyer atau pesanan terverifikasi"}
    ];
    $("relationshipTitle").textContent="Rantai peluang: "+opp.title;
    $("relationshipSummary").textContent="Hubungan dihitung dari bahan/skill, tipe usaha, calon pembeli, lokasi terpetakan dan padanan perdagangan.";
    $("relationshipStatus").textContent="IDE: "+businessTypeLabel(opp.business_type).toUpperCase();
    $("relationshipStatus").className="pill "+(opp.hasResourceFit||opp.hasSkillFit?"green":"gold");
    $("relationshipVisual").innerHTML=nodes.map((n,i)=>'<div class="flow-step '+(i===1?'is-active':'')+'"><span class="step-no">LANGKAH '+(i+1)+'</span><h3>'+esc(n.label)+'</h3><strong>'+esc(n.value)+'</strong><p>'+esc(n.detail)+'</p></div>'+(i<nodes.length-1?'<span class="flow-arrow" aria-hidden="true">→</span>':"")).join("");
    $("pathwaySection")?.classList.add("is-active");
  }
  $("findBtn").addEventListener("click",()=>{
    // Do not let a previous homepage category filter override the resources and skills just entered.
    if($("businessTypeFilter")) $("businessTypeFilter").value="all";
    activeOpportunityId=null;
    renderRecommendations(collectProfile());
    const resultHeading=$("recommendationStatus")?.closest(".section-title");
    if(resultHeading) resultHeading.scrollIntoView({behavior:"smooth",block:"start"});
    else $("recommendations")?.scrollIntoView({behavior:"smooth",block:"start"});
  });
  $("clearBtn").addEventListener("click",clearProfile);
  $("addInventory").addEventListener("click",addInventory);
  $("exportInventory").addEventListener("click",exportInventory);
  $("clearInventory").addEventListener("click",()=>{if(!inventory.length||confirm("Hapus semua resource lokal dari browser ini?")){inventory=[];saveInventory();renderRecommendations(collectProfile());}});
  $("importInventory").addEventListener("change",e=>{if(e.target.files&&e.target.files[0])importInventory(e.target.files[0]);});
  $("nearbyBtn").addEventListener("click",searchNearby);
  $("geoBtn").addEventListener("click",()=>useBrowserLocation({automatic:false}));
  $("locationSearchBtn").addEventListener("click",searchLocation);
  $("locationSearch").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();searchLocation();}});
  $("radius").addEventListener("change",()=>{if(currentLocation&&$("coverage").value==="nearby")searchNearby();});
  $("coverage").addEventListener("change",()=>{if(currentLocation)searchNearby();});
  $("businessTypeFilter").addEventListener("change",()=>renderRecommendations(collectProfile()));
  renderInventory();initMap();loadFeeds();
  const params=new URLSearchParams(window.location.search);
  const qLat=number(params.get("lat")),qLon=number(params.get("lon")),qLocation=params.get("location")||"";
  const qRadius=Number(params.get("radius")),qType=params.get("type")||"all",qScope=params.get("scope")||"nearby",qBounds=params.get("bounds");
  if([1000,3000,5000,10000,15000].includes(qRadius))$("radius").value=String(qRadius);
  if(["all","sell","grow","service"].includes(qType))$("businessTypeFilter").value=qType;
  if(["nearby","area"].includes(qScope))$("coverage").value=qScope;
  if(qBounds){try{selectedAreaBounds=parseBounds(qBounds.split(",").map(Number));}catch(_){selectedAreaBounds=null;}}
  if(qLat!=null&&qLon!=null&&qLat>=-90&&qLat<=90&&qLon>=-180&&qLon<=180){
    currentLocation={lat:qLat,lon:qLon};currentLocationLabel=qLocation||("Lokasi terpilih ("+qLat.toFixed(3)+", "+qLon.toFixed(3)+")");
    $("locationName").textContent=currentLocationLabel;$("locationSearch").value=qLocation;$("lat").value=qLat;$("lon").value=qLon;
    updateMapCenter(qLat,qLon);searchNearby();
  }else if(qLocation){$("locationSearch").value=qLocation;searchLocation();}
  else useBrowserLocation({automatic:true});
})();