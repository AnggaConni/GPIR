(function(){
"use strict";
const DATA_URL="./data/data.json";
const $=id=>document.getElementById(id);
let allRows=[],filtered=[],map=null,markers=null,selected=null;
const fmtMoney=v=>v==null||!Number.isFinite(Number(v))?"—":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2}).format(Number(v));
const fmtPct=v=>v==null||!Number.isFinite(Number(v))?"—":(Number(v)>0?"+":"")+Number(v).toFixed(1)+"%";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num=v=>v==null||v===""||!Number.isFinite(Number(v))?null:Number(v);
function normalize(raw){
 const rows=Array.isArray(raw)?raw:(raw.records||raw.items||raw.data||[]);
 const meta=raw.meta||raw.metadata||{};
 return rows.map((r,i)=>{
  const product=r.product||{},market=r.market||{},trade=r.trade||{},assessment=r.assessment||{},evidence=r.evidence||{};
  return {...r,_id:r.id||[product.hs_code||r.product_code,market.country_iso3||r.market_iso3,trade.period||r.latest_year,i].join("-"),
   _productName:product.name||r.product_name||"Unknown product",_hs:String(product.hs_code??r.product_code??r.hs_code??""),
   _country:market.country_name||r.market_name||"Unknown market",_iso:market.country_iso3||r.market_iso3||"",
   _period:String(trade.period??r.latest_year??r.period??""),_value:num(trade.value_usd??r.latest_import_usd??r.value_usd??r.primaryValue),
   _growth:num(trade.yoy_growth_pct??r.yoy_growth_pct),_score:num(assessment.opportunity_score??r.opportunity_score),
   _source:evidence.source||r.source_name||r.source||"Unknown source",_sourceUrl:evidence.source_url||r.source_url||"",
   _status:evidence.data_status||r.data_mode||meta.mode||"unknown",
   _lat:num(market.latitude??market.lat??r.market_latitude??r.latitude),_lon:num(market.longitude??market.lon??r.market_longitude??r.longitude),
   _quantity:num(trade.quantity??r.quantity),_cagr:num(trade.three_year_cagr_pct??r.cagr_pct),
   _series:Array.isArray(trade.series)?trade.series:(Array.isArray(r.series)?r.series:[]),_classification:r.classification||""};
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
 $("country").innerHTML='<option value="">All markets</option>'+countries.map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join("");
 $("category").innerHTML='<option value="">All chapters</option>'+chapters.map(c=>'<option value="'+esc(c)+'">'+esc(c)+' — HS chapter</option>').join("");
}
function applyFilters(){
 const q=$("search").value.trim().toLowerCase(),country=$("country").value,chapter=$("category").value;
 filtered=allRows.filter(r=>(!q||(r._productName+" "+r._hs+" "+r._country).toLowerCase().includes(q))&&(!country||r._country===country)&&(!chapter||r._hs.slice(0,2)===chapter));
 render();
}
function score(r){return r._score==null?null:Math.max(0,Math.min(100,r._score));}
function render(){
 $("kpiCount").textContent=filtered.length.toLocaleString();
 $("kpiMarkets").textContent=new Set(filtered.map(r=>r._country)).size.toLocaleString();
 $("kpiGrowth").textContent=filtered.filter(r=>r._growth!=null&&r._growth>0).length.toLocaleString();
 const years=filtered.map(r=>Number(r._period)).filter(Number.isFinite);$("kpiFresh").textContent=years.length?Math.max(...years):"—";
 $("rankCount").textContent=filtered.length+" records";
 const sorted=[...filtered].sort((a,b)=>(score(b)??-1)-(score(a)??-1));
 $("rankBody").innerHTML=sorted.length?sorted.slice(0,250).map(r=>'<tr data-id="'+esc(r._id)+'"><td><span class="product">'+esc(r._productName)+'</span><span class="sub">HS '+esc(r._hs)+' · '+esc(r._country)+'</span></td><td>'+fmtMoney(r._value)+'</td><td class="'+(r._growth!=null&&r._growth<0?"negative":"")+'">'+fmtPct(r._growth)+'</td><td class="score">'+(score(r)==null?"—":score(r).toFixed(0)+"/100")+'</td></tr>').join(""):'<tr><td colspan="4" class="empty">No records match these filters.</td></tr>';
 [...$("rankBody").querySelectorAll("tr[data-id]")].forEach(tr=>tr.addEventListener("click",()=>selectRecord(filtered.find(r=>r._id===tr.dataset.id))));
 renderMarkers(); if(selected&&!filtered.some(r=>r._id===selected._id))selected=null;if(selected&&filtered.some(r=>r._id===selected._id))showDetails(selected);
}
function renderMarkers(){
 if(!markers)return;markers.clearLayers();
 const byCountry=new Map();
 filtered.forEach(r=>{if(r._lat==null||r._lon==null)return;const x=byCountry.get(r._iso)||{lat:r._lat,lon:r._lon,rows:[]};x.rows.push(r);byCountry.set(r._iso,x);});
 byCountry.forEach((entry,iso)=>{
  const count=entry.rows.length,marker=L.circleMarker([entry.lat,entry.lon],{radius:Math.min(14,5+Math.log2(count+1)),weight:1,color:"#fff",fillColor:"#168b7d",fillOpacity:.85});
  marker.bindTooltip(esc(entry.rows[0]._country)+" · "+count+" product signals");
  marker.bindPopup('<b>'+esc(entry.rows[0]._country)+'</b><br>'+count+' product signals');
  marker.on("click",()=>selectRecord(entry.rows[0]));marker.addTo(markers);
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
  const meta=raw.meta||raw.metadata||{},status=String(meta.status||meta.data_status||meta.mode||"unknown");
  const isDemo=status.toLowerCase().includes("demo")||status.toLowerCase().includes("sample")||allRows.some(r=>r._status==="demo");
  $("dataNotice").textContent=isDemo?"DEMO DATA — These are illustrative values, not verified statistics. Run the pipeline to replace them with fetched trade data.":allRows.length?("DATA STATUS: "+status.replaceAll("_"," ").toUpperCase()+" — Import data is trade statistics, not retail sales. Check coverage and source periods."): "NO DATA YET — Pipeline has not populated data/data.json. Run the GitHub Actions workflow or configure the UN Comtrade API key.";
  $("dataNotice").style.background=isDemo?"#fff7e2":"#eef6ff";$("dataNotice").style.borderColor=isDemo?"#f1d998":"#c9ddf7";$("dataNotice").style.color=isDemo?"#694a08":"#204f82";
  setupFilters();applyFilters();$("updatedAt").textContent="Build: "+(raw.generated_at||meta.generated_at||"unknown")+" · Mode: "+status;
 }catch(e){allRows=[];filtered=[];render();$("dataNotice").textContent="Could not load data/data.json ("+e.message+"). Check that the JSON file exists in the deployed branch."; $("dataNotice").style.background="#feeceb";$("dataNotice").style.color="#9a2424";}
}
$("search").addEventListener("input",applyFilters);$("country").addEventListener("change",applyFilters);$("category").addEventListener("change",applyFilters);$("reload").addEventListener("click",loadData);$("reset").addEventListener("click",()=>{$("search").value="";$("country").value="";$("category").value="";applyFilters()});
initMap();loadData();
})();