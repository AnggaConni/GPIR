(function(){
"use strict";
const DATA_URL="./data/data.json";
const $=id=>document.getElementById(id);
let allRows=[], filtered=[], map=null, markers=null, selected=null;
const fmtMoney=v=>v==null||!Number.isFinite(Number(v))?"—":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2}).format(Number(v));
const fmtPct=v=>v==null||!Number.isFinite(Number(v))?"—":(Number(v)>0?"+":"")+Number(v).toFixed(1)+"%";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num=v=>v==null||v===""||!Number.isFinite(Number(v))?null:Number(v);
function normalize(raw){
 const rows=Array.isArray(raw)?raw:(raw.records||raw.data||[]);
 return rows.map((r,i)=>{
  const product=r.product||{},market=r.market||{},trade=r.trade||{},assessment=r.assessment||{},evidence=r.evidence||{};
  const value=num(trade.value_usd??r.value_usd??r.primaryValue),growth=num(trade.yoy_growth_pct??r.yoy_growth_pct),score=num(assessment.opportunity_score??r.opportunity_score);
  return {...r,_id:r.id||[product.hs_code,market.country_iso3,trade.period,i].join("-"),_productName:product.name||r.product_name||"Unknown product",_hs:String(product.hs_code??r.hs_code??""),_country:market.country_name||r.country_name||"Unknown market",_iso:market.country_iso3||r.country_iso3||"",_period:String(trade.period??r.period??""),_value:value,_growth:growth,_score:score,_source:evidence.source||r.source||"Unknown source",_sourceUrl:evidence.source_url||r.source_url||"",_status:evidence.data_status||r.data_status||raw.data_status||"unknown",_lat:num(market.latitude??market.lat??r.latitude),_lon:num(market.longitude??market.lon??r.longitude),_quantity:num(trade.quantity??r.quantity),_cagr:num(trade.three_year_cagr_pct??r.three_year_cagr_pct)};
 }).filter(r=>r._productName||r._hs);
}
function initMap(){
 if(!window.L){$("map").innerHTML='<div class="empty">Map library did not load. Check your connection.</div>';return;}
 map=L.map("map",{scrollWheelZoom:false}).setView([20,5],2);
 L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:18,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
 markers=L.layerGroup().addTo(map);
}
function setupFilters(){
 const countries=[...new Set(allRows.map(r=>r._country).filter(x=>x!=="Unknown market"))].sort();
 const chapters=[...new Set(allRows.map(r=>r._hs.slice(0,2)).filter(Boolean))].sort();
 $("country").innerHTML='<option value="">All markets</option>'+countries.map(c=>'<option>'+esc(c)+'</option>').join("");
 $("category").innerHTML='<option value="">All chapters</option>'+chapters.map(c=>'<option value="'+esc(c)+'">'+esc(c)+' — HS chapter</option>').join("");
}
function applyFilters(){
 const q=$("search").value.trim().toLowerCase(),country=$("country").value,chapter=$("category").value;
 filtered=allRows.filter(r=>(!q||(r._productName+" "+r._hs+" "+r._country).toLowerCase().includes(q))&&(!country||r._country===country)&&(!chapter||r._hs.slice(0,2)===chapter));
 render();
}
function score(r){if(r._score!=null)return Math.max(0,Math.min(100,r._score));return null;}
function render(){
 $("kpiCount").textContent=filtered.length.toLocaleString();
 $("kpiMarkets").textContent=new Set(filtered.map(r=>r._country)).size.toLocaleString();
 $("kpiGrowth").textContent=filtered.filter(r=>r._growth!=null&&r._growth>0).length.toLocaleString();
 const years=filtered.map(r=>Number(r._period)).filter(Number.isFinite);$("kpiFresh").textContent=years.length?Math.max(...years):"—";
 $("rankCount").textContent=filtered.length+" records";
 const sorted=[...filtered].sort((a,b)=>(score(b)??-1)-(score(a)??-1));
 $("rankBody").innerHTML=sorted.length?sorted.slice(0,150).map(r=>'<tr data-id="'+esc(r._id)+'"><td><span class="product">'+esc(r._productName)+'</span><span class="sub">HS '+esc(r._hs)+' · '+esc(r._country)+'</span></td><td>'+fmtMoney(r._value)+'</td><td class="'+(r._growth!=null&&r._growth<0?"negative":"")+'">'+fmtPct(r._growth)+'</td><td class="score">'+(score(r)==null?"—":score(r).toFixed(0)+"/100")+'</td></tr>').join(""):'<tr><td colspan="4" class="empty">No records match these filters.</td></tr>';
 [...$("rankBody").querySelectorAll("tr[data-id]")].forEach(tr=>tr.addEventListener("click",()=>selectRecord(filtered.find(r=>r._id===tr.dataset.id))));
 renderMarkers(); if(selected&&!filtered.some(r=>r._id===selected._id))selected=null;if(selected&&filtered.some(r=>r._id===selected._id))showDetails(selected);
}
function renderMarkers(){
 if(!markers)return;markers.clearLayers();
 filtered.filter(r=>r._lat!=null&&r._lon!=null&&r._lat>=-90&&r._lat<=90&&r._lon>=-180&&r._lon<=180).forEach(r=>{
  const marker=L.circleMarker([r._lat,r._lon],{radius:6,weight:1,color:"#fff",fillColor:r._growth>0?"#159b84":"#3976cf",fillOpacity:.85});
  marker.bindTooltip(esc(r._country)+" · "+esc(r._productName));marker.on("click",()=>selectRecord(r));marker.addTo(markers);
 });
}
function selectRecord(r){if(!r)return;selected=r;showDetails(r);document.querySelectorAll("#rankBody tr").forEach(tr=>tr.style.background=tr.dataset.id===r._id?"#eaf2fc":"");}
function showDetails(r){
 $("evidencePill").textContent=(r._status||"unknown").replaceAll("_"," ").toUpperCase();
 $("details").innerHTML='<h3>'+esc(r._productName)+'</h3><p>HS '+esc(r._hs)+' · '+esc(r._country)+' · observation '+esc(r._period||"unknown period")+'</p><div class="meta"><div><span>Reported trade value</span><b>'+fmtMoney(r._value)+'</b></div><div><span>Year-on-year growth</span><b>'+fmtPct(r._growth)+'</b></div><div><span>3-year CAGR</span><b>'+fmtPct(r._cagr)+'</b></div><div><span>Opportunity score</span><b>'+(score(r)==null?"Not available":score(r).toFixed(0)+"/100")+'</b></div><div><span>Source</span><b>'+esc(r._source)+'</b></div><div><span>Quantity</span><b>'+(r._quantity==null?"Not reported":r._quantity.toLocaleString())+'</b></div></div>'+(r._sourceUrl?'<p><a href="'+esc(r._sourceUrl)+'" target="_blank" rel="noopener">Open source record ↗</a></p>':"")+'<p>Interpretation: import growth can indicate rising cross-border demand, but does not establish retail sales or profitability.</p>';
 if(r._lat!=null&&r._lon!=null&&map)map.setView([r._lat,r._lon],Math.max(map.getZoom(),3));
}
async function loadData(){
 $("dataNotice").textContent="Loading data…";
 try{
  const res=await fetch(DATA_URL+"?t="+Date.now(),{cache:"no-store"});if(!res.ok)throw new Error("HTTP "+res.status);
  const raw=await res.json();allRows=normalize(raw);
  const status=raw.metadata?.data_status||raw.data_status||"unknown",isDemo=String(status).toLowerCase().includes("demo")||String(status).toLowerCase().includes("sample");
  $("dataNotice").textContent=isDemo?"DEMO DATA — The current file contains illustrative sample records, not verified current trade statistics. Run the data pipeline to replace them.":"DATA STATUS: "+String(status).replaceAll("_"," ").toUpperCase()+" — inspect record-level sources and observation periods before drawing conclusions.";
  $("dataNotice").style.background=isDemo?"#fff7e2":"#e8f7ef";$("dataNotice").style.borderColor=isDemo?"#f1d998":"#bae6cf";$("dataNotice").style.color=isDemo?"#694a08":"#166444";
  setupFilters();applyFilters();
  $("updatedAt").textContent="Build: "+(raw.metadata?.generated_at||raw.generated_at||"timestamp not supplied")+" · Source data: "+(raw.metadata?.source||"record-level");
 }catch(e){
  allRows=[];filtered=[];render();$("dataNotice").textContent="Could not load data/data.json ("+e.message+"). Check the data file and deployment path."; $("dataNotice").style.background="#feeceb";$("dataNotice").style.color="#9a2424";
 }
}
$("search").addEventListener("input",applyFilters);$("country").addEventListener("change",applyFilters);$("category").addEventListener("change",applyFilters);$("reload").addEventListener("click",loadData);$("reset").addEventListener("click",()=>{$("search").value="";$("country").value="";$("category").value="";applyFilters()});
initMap();loadData();
})();