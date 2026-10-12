(function(){
"use strict";
const $ = id => document.getElementById(id);
const MANIFEST_URL = "./data/un_tourism/manifest.json";
const CATALOG_URL = "./data/opportunity_catalog.json";
const PLACES_URL = "./data/tourism_places.json";
const ROOT_SHEETS = "./data/un_tourism/sheets/";
const state = { manifest:null, datasets:[], catalog:[], places:[], activeDataset:null, raw:null, headers:[], records:[], filtered:[], shown:100, dimensionKey:"", dimensionOptions:[] };
const norm = value => String(value == null ? "" : value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
const keyNorm = value => norm(value).replace(/[^a-z0-9]/g,"");
const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = value => {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const clean = String(value).replace(/\s/g,"").replace(/,/g,"");
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
};
const compact = value => value == null ? "—" : new Intl.NumberFormat("id-ID",{notation:Math.abs(value)>=1000?"compact":"standard",maximumFractionDigits:2}).format(value);
const formatNumber = value => value == null ? "Tidak tersedia" : new Intl.NumberFormat("id-ID",{maximumFractionDigits:2}).format(value);
const titleize = value => String(value || "").replace(/^UN_Tourism_/i,"").replace(/__(01|02)_/g," ").replace(/_(12_2025|05_2026|06_2026|03_2026)/g," ").replace(/_/g," ").replace(/\s+/g," ").trim();
function datasetTitle(item){
  const f = norm(item.workbook).replace(/_/g," ").replace(/\.xlsx?$/i,"");
  const rules = [
    [/inbound arrivals by region/,"Kedatangan internasional menurut wilayah asal"],
    [/inbound arrivals by purpose/,"Kedatangan internasional menurut tujuan perjalanan"],
    [/inbound arrivals by transport/,"Kedatangan internasional menurut moda transportasi"],
    [/inbound arrivals/,"Kedatangan wisatawan internasional"],
    [/inbound expenditure/,"Pengeluaran wisatawan internasional"],
    [/outbound departures/,"Keberangkatan wisatawan ke luar negeri"],
    [/outbound expenditure/,"Pengeluaran wisatawan outbound"],
    [/domestic trips/,"Perjalanan wisata domestik"],
    [/domestic accommodation/,"Akomodasi wisata domestik"],
    [/inbound accommodation/,"Akomodasi wisata inbound"],
    [/accommodation hotels/,"Indikator hotel"],
    [/accommodation other indicators/,"Indikator akomodasi lainnya"],
    [/tdgdp/,"Kontribusi langsung pariwisata terhadap GDP (SDG 8.9.1)"],
    [/employed persons/,"Pekerja dalam industri pariwisata (SDG 8.9.2)"],
    [/tsa seea/,"Tourism Satellite Account / SEEA (SDG 12.b.1)"]
  ];
  const match = rules.find(([re])=>re.test(f));
  return match ? match[1] : titleize(item.workbook.replace(/\.xlsx?$/i,""));
}
function setStatus(message, tone="neutral"){
  const el=$("datasetStatus"); if(!el)return;
  el.textContent=message;
  el.style.background=tone==="error"?"#fff0ef":tone==="success"?"#e8f7ef":"#f9fbfd";
  el.style.color=tone==="error"?"#9a2424":tone==="success"?"#17664f":"#62738a";
}
function kindLabel(type){
  return type==="grow"?"Tanam / budidaya":type==="service"?"Jasa":"Jual produk / olahan";
}
function idr(value){
  if(value==null)return "Belum ditentukan";
  return new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(value);
}
function terms(value){return norm(value).split(/[,;\n]+/).map(s=>s.trim()).filter(s=>s.length>1);}
function textMatches(haystack, term){
  const h=" "+norm(haystack).replace(/[^a-z0-9]+/g," ")+" ";
  const t=norm(term).replace(/[^a-z0-9]+/g," ").trim();
  return !!t && h.includes(" "+t+" ");
}
function classifyScore(opp, profile){
  const resourceTerms=terms(profile.resources);
  const skillTerms=terms(profile.skills);
  const resourceKeys=[...(opp.resource_keywords||[]),...(opp.products||[])];
  const skillKeys=opp.skill_keywords||[];
  const resourceMatches=resourceKeys.filter(k=>resourceTerms.some(t=>textMatches(k,t)||textMatches(t,k)));
  const skillMatches=skillKeys.filter(k=>skillTerms.some(t=>textMatches(k,t)||textMatches(t,k)));
  const budget=profile.capital;
  let score=34;
  score += opp.tourism_fit==="high"?16:opp.tourism_fit==="medium"?9:3;
  score += Math.min(28,resourceMatches.length*9);
  score += Math.min(16,skillMatches.length*8);
  score += budget==null?0:(Number(opp.capital_min_idr||0)<=budget?10:-10);
  if(budget!=null && Number(opp.capital_max_idr||0)<=budget)score+=4;
  if(profile.stage==="start") score += Number(opp.capital_min_idr||0)<=5000000?8:0;
  else score += opp.tourism_fit==="high"?8:4;
  if(profile.buyer==="visitor" && opp.tourism_fit==="high")score+=5;
  if(profile.buyer==="hospitality" && /cafe|hotel|guesthouse|restaurant|homestay|hospitality|souvenir|visitor/i.test([opp.tourism_buyer_hypothesis,opp.title,opp.action_summary].join(" ")))score+=5;
  if(profile.buyer==="local" && /local|warung|household|community|village|warga|warung/i.test([opp.title,opp.action_summary,opp.sell_to||[]].flat().join(" ")))score+=3;
  return {score:Math.max(0,Math.min(100,Math.round(score))),resourceMatches:[...new Set(resourceMatches)].slice(0,4),skillMatches:[...new Set(skillMatches)].slice(0,3)};
}
function growthPlan(opp){
  const type=opp.business_type||"sell";
  if(type==="grow")return [
    "Catat benih/input, survival rate atau hasil panen, waktu produksi, dan biaya per unit selama beberapa siklus.",
    "Samakan spesifikasi, waktu pengiriman, dan kualitas sebelum menerima pesanan rutin.",
    "Uji kontrak atau komitmen pembelian dari 2–3 buyer sebelum menambah lahan, stok, atau kapasitas."
  ];
  if(type==="service")return [
    "Catat lead, booking berbayar, tingkat pembatalan, jam kerja, dan margin per layanan selama 4 minggu.",
    "Buat SOP sederhana, harga paket, jadwal, serta standar layanan yang dapat direplikasi.",
    "Tawarkan paket berulang kepada 3–5 buyer bisnis dan tambah kapasitas hanya ketika jadwal/permintaan terisi."
  ];
  return [
    "Catat penjualan berbayar, margin kotor per unit, barang rusak/terbuang, dan repeat order selama 4 minggu.",
    "Standarkan resep/spesifikasi, kualitas, kemasan, label, serta waktu pemenuhan pesanan.",
    "Uji pembelian ulang dari 3–5 buyer bisnis sebelum membeli mesin, menyewa ruang lebih besar, atau menambah pekerja."
  ];
}
function renderRecommendations(){
  if(!state.catalog.length)return;
  const profile={
    stage:$("businessStage").value,
    type:$("businessType").value,
    capital:num($("capital").value),
    buyer:$("targetBuyer").value,
    resources:$("resources").value,
    skills:$("skills").value
  };
  const scored=state.catalog.filter(o=>profile.type==="all"||(o.business_type||"sell")===profile.type)
    .map(opp=>({...opp,_fit:classifyScore(opp,profile)}))
    .sort((a,b)=>b._fit.score-a._fit.score || Number(a.capital_min_idr||0)-Number(b.capital_min_idr||0));
  const top=scored.slice(0,8);
  $("recCount").textContent=top.length+" rekomendasi";
  $("recommendationStatus").textContent=profile.resources.trim()||profile.skills.trim()
    ?"Urutan berdasarkan kecocokan input, modal indikatif dan tourism-fit pada katalog. Bukan prediksi permintaan."
    :"Isi sumber daya atau keterampilan agar rekomendasi lebih personal. Untuk saat ini urutan memakai modal dan kaitan pariwisata pada katalog.";
  if(!top.length){$("recommendations").innerHTML='<div class="panel empty">Tidak ada ide untuk filter ini.</div>';return;}
  $("recommendations").innerHTML=top.map((opp,index)=>{
    const fit=opp._fit;
    const type=opp.business_type||"sell";
    const range=idr(opp.capital_min_idr)+" – "+idr(opp.capital_max_idr);
    const matching=fit.resourceMatches.length||fit.skillMatches.length
      ?'<p><b>Yang cocok dengan profil:</b> '+esc([...fit.resourceMatches,...fit.skillMatches].join(", "))+'</p>'
      :'<p><b>Penyesuaian:</b> belum ada kata kunci resource/skill yang cocok secara eksplisit. Periksa kembali kecocokan dengan kondisi nyata.</p>';
    const actions=profile.stage==="start"
      ?'<div class="detail"><b>Eksperimen pertama</b><p>'+esc(opp.first_test||opp.tourism_validation_test||"Wawancarai calon buyer sebelum melakukan investasi.")+'</p></div><div class="detail"><b>Langkah awal</b><ul>'+((opp.start_steps||[]).slice(0,3).map(s=>'<li>'+esc(s)+'</li>').join("")||"<li>Uji penawaran kecil sebelum menambah biaya tetap.</li>")+'</ul></div>'
      :'<div class="detail"><b>Rencana pengembangan</b><ul>'+growthPlan(opp).map(s=>'<li>'+esc(s)+'</li>').join("")+'</ul></div><div class="detail"><b>Gerbang sebelum scale-up</b><p>Pastikan margin per unit, mutu konsisten, pembelian ulang, kapasitas pasok, dan arus kas teruji. Jangan menambah aset hanya karena statistik nasional sedang tinggi.</p></div>';
    const buyer=opp.tourism_buyer_hypothesis||"Buyer lokal atau pengguna jasa yang perlu diidentifikasi melalui riset lapangan";
    const validation=opp.tourism_validation_test||opp.first_test||"Wawancarai calon buyer dan validasi dengan transaksi percobaan.";
    const risks=Array.isArray(opp.risks)?opp.risks.slice(0,3):[];
    return '<article class="rec"><div class="rec-top"><div><div class="rec-tags"><span class="tag '+esc(type)+'">'+esc(kindLabel(type))+'</span><span class="tag">'+esc("Tourism fit: "+(opp.tourism_fit||"not rated"))+'</span><span class="tag">#'+(index+1)+'</span></div><h3 style="margin-top:8px">'+esc(opp.title)+'</h3></div><div class="fit">'+fit.score+'/100<small style="display:block;font-size:9px;font-weight:600;color:var(--muted)">kecocokan</small></div></div>'
      +'<p>'+esc(opp.action_summary||opp.rationale||"Ide usaha untuk diuji secara lokal.")+'</p>'
      +'<div class="detail"><b>Modal indikatif katalog</b><p><strong>'+esc(range)+'</strong></p><p style="margin-top:5px">'+esc(opp.rationale||"Validasi pasokan, mutu dan harga sebelum berinvestasi.")+'</p></div>'
      +matching
      +'<div class="subgrid">'+actions+'</div>'
      +'<div class="detail"><b>Hipotesis buyer terkait pariwisata</b><p>'+esc(buyer)+'</p><p style="margin-top:6px"><b style="display:inline">Validasi:</b> '+esc(validation)+'</p></div>'
      +'<div class="detail"><b>Risiko yang perlu diperiksa</b><ul>'+risks.map(s=>'<li>'+esc(s)+'</li>').join("")+'</ul></div>'
      +'<div class="actions"><a class="btn primary" href="./enterprise.html">Analisis lokasi & buyer ↗</a><a class="btn" href="./data/opportunity_catalog.json" target="_blank" rel="noopener">Lihat katalog sumber</a></div>'
      +'<p class="hint">Skor adalah kecocokan input dan katalog, bukan peluang keberhasilan. “Tourism fit” merupakan hipotesis katalog, bukan pengukuran visitor demand.</p></article>';
  }).join("");
}
function keyAt(headers, exacts, contains=[]){
  const keys=headers.map(keyNorm);
  for(const exact of exacts){const i=keys.indexOf(keyNorm(exact));if(i>=0)return i;}
  for(let i=0;i<keys.length;i++)if(contains.some(part=>keys[i].includes(keyNorm(part))))return i;
  return -1;
}
function detectYearHeaders(headers){
  return headers.map((h,i)=>({i,year:Number(String(h||"").trim())})).filter(x=>/^(19|20)\d{2}$/.test(String(x.year))).map(x=>({index:x.i,year:x.year}));
}
function normaliseWorksheet(raw, dataset){
  const grid=Array.isArray(raw.data)?raw.data:[];
  if(!grid.length)return {headers:[],records:[]};
  const headers=grid[0].map((h,i)=>String(h==null||h===""?"Column "+(i+1):h).trim());
  const countryIdx=keyAt(headers,["reporter_area_label","country_name","country","area_label","area_name","geo_area_name","geoareaname","reference_area","ref_area_label","geography"],["countryname"]);
  const yearIdx=keyAt(headers,["year","time_period","time","period","reference_year"]);
  const valueIdx=keyAt(headers,["value","obs_value","observation_value","data_value","observationvalue"]);
  const indicatorIdx=keyAt(headers,["indicator_label","indicator_name","indicator","series_name","measure_label","variable"]);
  const unitIdx=keyAt(headers,["unit","unit_of_measure","unit_measure","measurement_unit"]);
  const wideYears=detectYearHeaders(headers);
  const longForm=yearIdx>=0 && valueIdx>=0;
  const records=[];
  const baseIndices=new Set([countryIdx,yearIdx,valueIdx,indicatorIdx,unitIdx,...wideYears.map(y=>y.index)].filter(i=>i>=0));
  headers.forEach((h,i)=>{const k=keyNorm(h);if(/^(indicatorcode|indicatorpreviouscode|reporterareacode|partnerareacode|flag|flaglabel|notes|note|source|sourceurl|unitcode|obsstatus|observationstatus)$/.test(k))baseIndices.add(i);});
  for(let ri=1;ri<grid.length;ri++){
    const row=grid[ri]||[];
    if(!row.some(v=>v!==null&&v!==""))continue;
    let country=countryIdx>=0?row[countryIdx]:null;
    if(country==null||country===""){
      const firstString=row.find(v=>typeof v==="string"&&v.trim());
      country=firstString||"Area not identified";
    }
    const indicator=indicatorIdx>=0&&row[indicatorIdx]!=null&&row[indicatorIdx]!==""?String(row[indicatorIdx]):datasetTitle(dataset);
    const unit=unitIdx>=0?row[unitIdx]:null;
    const extras={};
    headers.forEach((h,i)=>{if(!baseIndices.has(i)&&row[i]!=null&&row[i]!=="")extras[h]=row[i];});
    const classification=Object.entries(extras).filter(([k])=>!/^(flag|flag label|notes?|indicator code|indicator previous code)$/i.test(k)).map(([k,v])=>k+": "+v).join(" · ");
    if(longForm){
      records.push({country:String(country),year:num(row[yearIdx]),indicator:String(indicator),value:num(row[valueIdx]),unit:unit==null?"":String(unit),classification,extras,raw:row});
    }else if(wideYears.length){
      for(const y of wideYears){
        const v=num(row[y.index]);
        if(v==null)continue;
        records.push({country:String(country),year:y.year,indicator:String(indicator),value:v,unit:unit==null?"":String(unit),classification,extras,raw:row});
      }
    }else{
      const numericIdx=row.findIndex((v,i)=>i!==countryIdx&&num(v)!=null);
      records.push({country:String(country),year:null,indicator:String(indicator),value:numericIdx>=0?num(row[numericIdx]):null,unit:unit==null?"":String(unit),classification,extras,raw:row});
    }
  }
  return {headers,records,longForm,wideYears:wideYears.map(x=>x.year),countryIdx,yearIdx,valueIdx,indicatorIdx,unitIdx};
}
function enableStats(enabled){
  ["countrySelect","indicatorSelect","statsSearch","breakdownSelect","yearFrom","yearTo","sortSelect","showMore"].forEach(id=>{$(id).disabled=!enabled;});
}
function refreshBreakdownForSelection(){
  const country=$("countrySelect").value;
  const indicator=$("indicatorSelect").value;
  const baseRows=state.records.filter(r=>(!country||r.country===country)&&(!indicator||r.indicator===indicator));
  const previous=$("breakdownSelect").value;
  refreshDimensionOptions(baseRows);
  if(previous&&[...$("breakdownSelect").options].some(o=>o.value===previous))$("breakdownSelect").value=previous;
}
function refreshDimensionOptions(baseRows){
  const select=$("breakdownSelect");
  select.innerHTML='<option value="">Semua klasifikasi</option>';
  state.dimensionKey="";
  state.dimensionOptions=[];
  const skip=new Set(["indicatorcode","indicatorpreviouscode","reporterareacode","partnerareacode","flag","flaglabel","notes","note","source","sourceurl","unit","unitofmeasure","year","value","indicatorlabel","indicatorname","indicator","country","countryname","reporterarealabel","arealabel","areaname","geoareaname"]);
  const keys=state.headers.filter(h=>!skip.has(keyNorm(h)));
  const priority=["partner_area_label","partner area label","purpose","transport","accommodation","region","category","visitor type"];
  const candidates=keys.map(k=>{
    const vals=[...new Set(baseRows.map(r=>r.extras[k]).filter(v=>v!=null&&v!=="").map(v=>String(v)))];
    return {key:k,values:vals};
  }).filter(x=>x.values.length>1&&x.values.length<=150).sort((a,b)=>{
    const ai=priority.findIndex(p=>keyNorm(a.key).includes(keyNorm(p)));
    const bi=priority.findIndex(p=>keyNorm(b.key).includes(keyNorm(p)));
    return (ai<0?99:ai)-(bi<0?99:bi)||a.key.localeCompare(b.key);
  });
  if(!candidates.length){select.disabled=true;return;}
  state.dimensionKey=candidates[0].key;
  state.dimensionOptions=candidates[0].values;
  select.innerHTML+='<option value="__FIELD__">'+esc("Pilih nilai untuk "+state.dimensionKey)+'</option>';
  candidates[0].values.sort((a,b)=>a.localeCompare(b)).forEach(v=>select.insertAdjacentHTML("beforeend",'<option value="'+esc(state.dimensionKey+"::"+v)+'">'+esc(String(v))+'</option>'));
  select.disabled=false;
}
function fillFilterSelects(){
  const countries=[...new Set(state.records.map(r=>r.country).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const country=$("countrySelect");
  country.innerHTML='<option value="">Semua negara / area</option>'+countries.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join("");
  const indCounts=new Map();
  state.records.forEach(r=>indCounts.set(r.indicator,(indCounts.get(r.indicator)||0)+1));
  const indicators=[...indCounts.keys()].sort((a,b)=>indCounts.get(b)-indCounts.get(a)||a.localeCompare(b));
  $("indicatorSelect").innerHTML='<option value="">Semua indikator</option>'+indicators.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join("");
  if(countries.some(v=>norm(v)==="indonesia"))country.value=countries.find(v=>norm(v)==="indonesia");
  else if(countries.length===1)country.value=countries[0];
  if(indicators.length) $("indicatorSelect").value=indicators[0];
  const years=[...new Set(state.records.map(r=>r.year).filter(Number.isFinite))].sort((a,b)=>a-b);
  for(const id of ["yearFrom","yearTo"]){
    $(id).innerHTML='<option value="">Semua</option>'+years.map(y=>'<option value="'+y+'">'+y+'</option>').join("");
  }
  $("yearFrom").value=years.length?String(years[0]):"";
  $("yearTo").value=years.length?String(years[years.length-1]):"";
  enableStats(true);
  refreshBreakdownForSelection();
}
function loadMessage(rowCount){
  return "Worksheet dimuat: "+rowCount.toLocaleString("id-ID")+" observasi. Filter berdasarkan negara, indikator, tahun, atau klasifikasi. Nilai tidak diisi otomatis bila sumber mencatat data kosong.";
}
function latestUnit(rows){
  const counts=new Map();rows.forEach(r=>{if(r.unit)counts.set(r.unit,(counts.get(r.unit)||0)+1);});
  return [...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||"Tidak diketahui";
}
function matchesBreakdown(record){
  const v=$("breakdownSelect").value;
  if(!v||v==="__FIELD__")return true;
  const split=v.indexOf("::");
  if(split<0)return true;
  return String(record.extras[v.slice(0,split)]??"")===v.slice(split+2);
}
function getFilteredRows(){
  const country=$("countrySelect").value;
  const indicator=$("indicatorSelect").value;
  const query=norm($("statsSearch").value);
  const yFrom=num($("yearFrom").value),yTo=num($("yearTo").value);
  let rows=state.records.filter(r=>(!country||r.country===country)&&(!indicator||r.indicator===indicator)&&
    (!Number.isFinite(yFrom)||!Number.isFinite(r.year)||r.year>=yFrom)&&(!Number.isFinite(yTo)||!Number.isFinite(r.year)||r.year<=yTo)&&
    (!query||norm([r.country,r.indicator,r.unit,r.classification].join(" ")).includes(query))&&matchesBreakdown(r));
  const sort=$("sortSelect").value;
  if(sort==="value-desc")rows.sort((a,b)=>(b.value??-Infinity)-(a.value??-Infinity));
  else if(sort==="country-asc")rows.sort((a,b)=>a.country.localeCompare(b.country)||((b.year??0)-(a.year??0)));
  else rows.sort((a,b)=>(b.year??-Infinity)-(a.year??-Infinity)||a.country.localeCompare(b.country));
  return rows;
}
function renderChart(rows){
  const svg=$("statsChart"),country=$("countrySelect").value,indicator=$("indicatorSelect").value;
  if(!country||!indicator){
    svg.innerHTML='<text x="450" y="125" text-anchor="middle">Pilih satu negara/area dan satu indikator untuk melihat tren.</text>';
    $("chartNote").textContent="Grafik hanya dibuat bila negara/area dan indikator dipilih.";
    $("chartBadge").textContent="PILIH FILTER";$("chartBadge").className="pill gray";return;
  }
  const withYear=rows.filter(r=>Number.isFinite(r.year)&&r.value!=null);
  const byYear=new Map();withYear.forEach(r=>byYear.set(r.year,(byYear.get(r.year)||0)+1));
  const duplicate=[...byYear.entries()].filter(([,n])=>n>1);
  if(duplicate.length){
    svg.innerHTML='<text x="450" y="105" text-anchor="middle">Ada lebih dari satu observasi pada sebagian tahun.</text><text x="450" y="128" text-anchor="middle">Pilih klasifikasi tambahan untuk membuat tren yang tidak mencampur kelompok.</text>';
    $("chartNote").textContent="Tidak menggabungkan baris duplikat agar kategori berbeda tidak tercampur.";
    $("chartBadge").textContent="PERLU BREAKDOWN";$("chartBadge").className="pill gold";return;
  }
  const data=withYear.sort((a,b)=>a.year-b.year);
  if(data.length<2){
    svg.innerHTML='<text x="450" y="125" text-anchor="middle">Belum cukup titik data untuk tren tahunan.</text>';
    $("chartNote").textContent=data.length===1?"Hanya satu titik tersedia setelah filter.":"Tidak ada nilai numerik untuk filter ini.";
    $("chartBadge").textContent="DATA TERBATAS";$("chartBadge").className="pill gray";return;
  }
  const W=900,H=250,left=68,right=18,top=20,bottom=38,plotW=W-left-right,plotH=H-top-bottom;
  const min=Math.min(...data.map(d=>d.value)),max=Math.max(...data.map(d=>d.value));
  const span=max-min||Math.max(1,Math.abs(max)*0.1);
  const yMin=min-0.06*span,yMax=max+0.08*span;
  const x=i=>left+(i/(data.length-1))*plotW;
  const y=v=>top+(1-(v-yMin)/(yMax-yMin))*plotH;
  let markup="";
  for(let i=0;i<=4;i++){
    const val=yMin+(yMax-yMin)*i/4,yy=y(val);
    markup+='<line x1="'+left+'" y1="'+yy+'" x2="'+(W-right)+'" y2="'+yy+'" stroke="#e6edf4" stroke-width="1"/>';
    markup+='<text x="'+(left-9)+'" y="'+(yy+3)+'" text-anchor="end">'+esc(compact(val))+'</text>';
  }
  const points=data.map((d,i)=>x(i)+","+y(d.value)).join(" ");
  markup+='<polyline points="'+points+'" fill="none" stroke="#2368cf" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>';
  data.forEach((d,i)=>{markup+='<circle cx="'+x(i)+'" cy="'+y(d.value)+'" r="3.5" fill="#0d8d7c"><title>'+esc(d.year+": "+formatNumber(d.value)+" "+d.unit)+'</title></circle>';});
  const labelCount=Math.min(7,data.length);
  for(let i=0;i<labelCount;i++){const idx=Math.round(i*(data.length-1)/Math.max(1,labelCount-1)),d=data[idx];markup+='<text x="'+x(idx)+'" y="'+(H-14)+'" text-anchor="middle">'+d.year+'</text>';}
  svg.innerHTML=markup;
  $("chartTitle").textContent=indicator+" · "+country;
  $("chartNote").textContent="Seri tahunan sesuai nilai pada sumber; tidak mengisi atau menginterpolasi data yang kosong.";
  $("chartBadge").textContent=data.length+" TITIK";$("chartBadge").className="pill green";
}
function renderStats(){
  if(!state.records.length)return;
  const rows=getFilteredRows();state.filtered=rows;
  const countries=new Set(rows.map(r=>r.country).filter(Boolean));
  const years=rows.map(r=>r.year).filter(Number.isFinite);
  $("statObservations").textContent=rows.length.toLocaleString("id-ID");
  $("statCountries").textContent=countries.size.toLocaleString("id-ID");
  $("statYears").textContent=years.length?(Math.min(...years)+"–"+Math.max(...years)):"Tidak tersedia";
  $("statUnit").textContent=latestUnit(rows);
  renderChart(rows);
  const shown=rows.slice(0,state.shown);
  $("statsBody").innerHTML=shown.length?shown.map(r=>'<tr><td>'+esc(r.country)+'</td><td>'+esc(r.year??"—")+'</td><td>'+esc(r.indicator)+'</td><td>'+esc(formatNumber(r.value))+'</td><td>'+esc(r.unit||"—")+'</td><td>'+esc(r.classification||"—")+'</td></tr>').join(""):'<tr><td colspan="6" class="empty">Tidak ada observasi yang cocok dengan filter.</td></tr>';
  $("tableSummary").textContent="Menampilkan "+Math.min(state.shown,rows.length).toLocaleString("id-ID")+" dari "+rows.length.toLocaleString("id-ID")+" observasi tersaring.";
  $("showMore").disabled=rows.length<=state.shown;
}
async function loadDataset(){
  const item=state.datasets.find(d=>d.file===$("datasetSelect").value);
  if(!item)return;
  const button=$("loadDataset");
  button.disabled=true;button.textContent="Memuat…";
  state.activeDataset=item;state.raw=null;state.headers=[];state.records=[];state.filtered=[];state.shown=100;
  $("statsBody").innerHTML='<tr><td colspan="6" class="empty">Memuat worksheet pilihan…</td></tr>';
  setStatus("Mengunduh hanya worksheet yang dipilih: "+datasetTitle(item)+". File besar bisa memerlukan beberapa saat.");
  try{
    const response=await fetch(ROOT_SHEETS+encodeURIComponent(item.file),{cache:"no-store"});
    if(!response.ok)throw new Error("HTTP "+response.status+" ketika membaca "+item.file);
    const raw=await response.json();
    const parsed=normaliseWorksheet(raw,item);
    if(!parsed.records.length)throw new Error("Worksheet tidak memiliki baris data yang dapat dibaca.");
    state.raw=raw;state.headers=parsed.headers;state.records=parsed.records;
    fillFilterSelects();
    $("openRawData").href=ROOT_SHEETS+encodeURIComponent(item.file);$("openRawData").hidden=false;
    setStatus(loadMessage(parsed.records.length)+" Sumber: "+item.workbook+" / "+item.worksheet+".", "success");
    $("chartTitle").textContent=datasetTitle(item);
    renderStats();
    $("footerStatus").textContent="Data sheet: "+item.workbook+" · "+(raw.generated_at||"timestamp sumber tidak tersedia");
  }catch(error){
    state.records=[];enableStats(false);
    setStatus("Gagal membaca dataset: "+error.message+". Periksa file di GitHub Pages atau coba dataset lain.","error");
    $("statsBody").innerHTML='<tr><td colspan="6" class="empty">Dataset gagal dimuat. Coba kembali atau pilih worksheet yang lebih kecil.</td></tr>';
    $("statsChart").innerHTML='<text x="450" y="125" text-anchor="middle">Dataset tidak dapat dimuat.</text>';
    $("openRawData").hidden=true;
  }finally{button.disabled=false;button.textContent="Muat dataset";}
}
async function loadSmallData(){
  setStatus("Memuat manifest, katalog SME dan snapshot tempat…");
  try{
    const [mr,cr,pr]=await Promise.all([
      fetch(MANIFEST_URL,{cache:"no-store"}),
      fetch(CATALOG_URL,{cache:"no-store"}),
      fetch(PLACES_URL,{cache:"no-store"})
    ]);
    if(!mr.ok)throw new Error("Manifest HTTP "+mr.status);
    if(!cr.ok)throw new Error("Katalog SME HTTP "+cr.status);
    const manifest=await mr.json(),catalog=await cr.json();
    const places=pr.ok?await pr.json():{items:[]};
    state.manifest=manifest;
    state.datasets=(manifest.worksheets||[]).filter(w=>w.worksheet==="Data"&&w.file).sort((a,b)=>datasetTitle(a).localeCompare(datasetTitle(b)));
    state.catalog=Array.isArray(catalog.opportunities)?catalog.opportunities:[];
    state.places=Array.isArray(places.items)?places.items:[];
    $("kpiDatasets").textContent=state.datasets.length.toLocaleString("id-ID");
    $("kpiIdeas").textContent=state.catalog.length.toLocaleString("id-ID");
    $("kpiPlaces").textContent=state.places.length.toLocaleString("id-ID");
    $("kpiBulkStatus").textContent="Tersedia";
    $("kpiBulkDate").textContent="Rilis arsip "+(manifest.meta?.archive||"UN Tourism").replace(/.*?(\d{2}_\d{4})\.zip/,"$1");
    $("datasetSelect").innerHTML=state.datasets.map(d=>'<option value="'+esc(d.file)+'">'+esc(datasetTitle(d))+' ('+Number(d.rows||0).toLocaleString("id-ID")+' baris)</option>').join("");
    $("datasetSelect").disabled=state.datasets.length===0;
    $("loadDataset").disabled=state.datasets.length===0;
    const defaultItem=state.datasets.find(d=>/inbound_arrivals_12_2025__02_Data/.test(d.file))||state.datasets.find(d=>/domestic_trips.*02_Data/.test(d.file))||state.datasets[0];
    if(defaultItem)$("datasetSelect").value=defaultItem.file;
    $("footerStatus").textContent="Manifest dibuat: "+(manifest.generated_at||"unknown")+" · "+state.datasets.length+" data sheets";
    renderRecommendations();
    setStatus("Manifest siap: "+state.datasets.length+" worksheet Data tersedia. Pilih dataset lalu klik “Muat dataset”. Data besar tidak dimuat otomatis.","success");
  }catch(error){
    $("kpiBulkStatus").textContent="Gagal";
    setStatus("Tidak dapat memuat manifest/katalog: "+error.message,"error");
    $("recommendations").innerHTML='<div class="panel empty">Katalog rekomendasi tidak tersedia. Periksa koneksi dan file data GPIR.</div>';
  }
}
$("generateRecs").addEventListener("click",renderRecommendations);
$("clearProfile").addEventListener("click",()=>{
  $("businessStage").value="start";$("businessType").value="all";$("capital").value="3000000";$("targetBuyer").value="mixed";$("resources").value="";$("skills").value="";renderRecommendations();
});
["businessStage","businessType","capital","targetBuyer"].forEach(id=>$(id).addEventListener("change",renderRecommendations));
$("loadDataset").addEventListener("click",loadDataset);
["countrySelect","indicatorSelect"].forEach(id=>$(id).addEventListener("change",()=>{state.shown=100;if(state.records.length){refreshBreakdownForSelection();renderStats();}}));
["statsSearch","breakdownSelect","yearFrom","yearTo","sortSelect"].forEach(id=>$(id).addEventListener("change",()=>{state.shown=100;if(state.records.length)renderStats();}));
$("statsSearch").addEventListener("input",()=>{state.shown=100;if(state.records.length)renderStats();});
$("showMore").addEventListener("click",()=>{state.shown+=100;renderStats();});
loadSmallData();
})();