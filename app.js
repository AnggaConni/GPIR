(function(){
"use strict";
const DATA_URL="./data/data.json";
const $=id=>document.getElementById(id);
let allRows=[],filtered=[],map=null,markers=null,selected=null,mapHasAutoFit=false;
let tradeFlows=[],tradeFlowMeta={},marketContextData=null,mapMode="signals",flowLayer=null,flowNodes=null,flowRenderer=null,flowMapHasAutoFit=false,tradeFlowsLoaded=false,tradeFlowsLoading=false;
// Stable fallback locations (capital/reference points) keep market markers available
// even when the optional World Bank context request is blocked or unavailable.
const MARKET_COORDINATES = Object.freeze({
 ARE:{lat:24.4539,lon:54.3773}, BRA:{lat:-15.7939,lon:-47.8828},
 CHN:{lat:39.9042,lon:116.4074}, DEU:{lat:52.5200,lon:13.4050},
 GBR:{lat:51.5072,lon:-0.1276}, IDN:{lat:-6.2088,lon:106.8456},
 IND:{lat:28.6139,lon:77.2090}, JPN:{lat:35.6762,lon:139.6503},
 KOR:{lat:37.5665,lon:126.9780}, NLD:{lat:52.3676,lon:4.9041},
 USA:{lat:38.9072,lon:-77.0369}
});
const fmtMoney=v=>v==null||!Number.isFinite(Number(v))?"—":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2}).format(Number(v));
const fmtPct=v=>v==null||!Number.isFinite(Number(v))?"—":(Number(v)>0?"+":"")+Number(v).toFixed(1)+"%";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num=v=>v==null||v===""||!Number.isFinite(Number(v))?null:Number(v);
function normalize(raw,marketContext=null){
 const rows=Array.isArray(raw)?raw:(raw.records||raw.items||raw.data||[]);
 const meta=raw.meta||raw.metadata||{};
 const contextCountries=marketContext&&marketContext.countries?marketContext.countries:{};
 return rows.map((r,i)=>{
  const product=r.product||{},market=r.market||{},trade=r.trade||{},assessment=r.assessment||{},evidence=r.evidence||{};
  const iso=String(market.country_iso3||r.market_iso3||"").trim().toUpperCase();
  const ctx=contextCountries[iso]||{};
  const fallback=MARKET_COORDINATES[iso]||{};
  return {...r,_id:r.id||[product.hs_code||r.product_code,iso,trade.period||r.latest_year,i].join("-"),
   _productName:product.name||r.product_name||"Unknown product",_hs:String(product.hs_code??r.product_code??r.hs_code??""),
   _country:market.country_name||r.market_name||ctx.name||"Unknown market",_iso:iso,
   _period:String(trade.period??r.latest_year??r.period??""),_value:num(trade.value_usd??r.latest_import_usd??r.value_usd??r.primaryValue),
   _growth:num(trade.yoy_growth_pct??r.yoy_growth_pct),_score:num(assessment.opportunity_score??r.opportunity_score),
   _source:evidence.source||r.source_name||r.source||"Unknown source",_sourceUrl:evidence.source_url||r.source_url||"",
   _status:evidence.data_status||r.data_mode||meta.mode||"unknown",
   _lat:num(market.latitude??market.lat??r.market_latitude??r.latitude??ctx.latitude??fallback.lat),_lon:num(market.longitude??market.lon??r.market_longitude??r.longitude??ctx.longitude??fallback.lon),
   _gdpPerCapita:num(ctx.gdp_per_capita_usd),_gdpPerCapitaYear:ctx.gdp_per_capita_year||null,
   _population:num(ctx.population),_populationYear:ctx.population_year||null,
   _quantity:num(trade.quantity??r.quantity),_cagr:num(trade.three_year_cagr_pct??r.cagr_pct),
   _series:Array.isArray(trade.series)?trade.series:(Array.isArray(r.series)?r.series:[]),_classification:r.classification||""};
 }).filter(r=>r._productName||r._hs);
}
function initMap(){
 if(!window.L){$("map").innerHTML='<div class="empty">Map library did not load. Check your connection.</div>';return;}
 map=L.map("map",{scrollWheelZoom:true}).setView([20,5],2);
 L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:18,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
 flowRenderer=L.svg({padding:.5}).addTo(map);
 flowLayer=L.layerGroup().addTo(map);
 flowNodes=L.layerGroup().addTo(map);
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
 if(mapMode==="signals")renderMarkers();
 else updateFlowStatus();
 if(selected&&!filtered.some(r=>r._id===selected._id))selected=null;if(selected&&filtered.some(r=>r._id===selected._id))showDetails(selected);
}
function renderMarkers(){
 if(!markers)return;markers.clearLayers();
 const byCountry=new Map();
 filtered.forEach(r=>{
  if(!r._iso||r._lat==null||r._lon==null||r._lat < -90||r._lat > 90||r._lon < -180||r._lon > 180)return;
  const x=byCountry.get(r._iso)||{lat:r._lat,lon:r._lon,rows:[]};
  x.rows.push(r);byCountry.set(r._iso,x);
 });
 byCountry.forEach((entry,iso)=>{
  const count=entry.rows.length;
  const marker=L.circleMarker([entry.lat,entry.lon],{radius:Math.min(14,5+Math.log2(count+1)),weight:1,color:"#fff",fillColor:"#168b7d",fillOpacity:.9});
  marker.bindTooltip(esc(entry.rows[0]._country)+" · "+count+" product signals");
  marker.bindPopup('<b>'+esc(entry.rows[0]._country)+'</b><br>'+count+' product signals<br><small>Approximate country reference point</small>');
  marker.on("click",()=>{
   const marketName=entry.rows[0]._country;
   const countrySelect=$("country");
   // The right-hand ranking uses this same country selector, so map clicks
   // become a real filter rather than only selecting the first record.
   if(countrySelect&&[...countrySelect.options].some(option=>option.value===marketName)){
    countrySelect.value=marketName;
    selected=null;
    applyFilters();
    const matching=filtered.find(row=>row._id===entry.rows[0]._id)||filtered.find(row=>row._iso===iso);
    if(matching)selectRecord(matching);
   }else{
    selectRecord(entry.rows[0]);
   }
  });
  marker.addTo(markers);
 });
 const mapStatus=$("mapStatus");
 const totalMarkets=new Set(filtered.map(r=>r._iso).filter(Boolean)).size;
 if(mapStatus){
  mapStatus.textContent=!filtered.length
   ?"No trade records match the current filters."
   :byCountry.size
    ?byCountry.size+" of "+totalMarkets+" reporting markets mapped"
    :"Market coordinates unavailable. Check market country codes and data.";
 }
 // Fit once when the first usable markers become available; don't repeatedly
 // zoom while the user types in search or changes filters.
 if(!mapHasAutoFit&&byCountry.size&&map&&window.L){
  // L.layerGroup does not implement getBounds(); build bounds from marker coordinates.
  const coordinates=[...byCountry.values()].map(entry=>[entry.lat,entry.lon]);
  const bounds=L.latLngBounds(coordinates);
  if(bounds.isValid()){map.fitBounds(bounds.pad(.18),{maxZoom:4});mapHasAutoFit=true;}
 }
}

function countryPoint(iso){
 const ctx=marketContextData&&marketContextData.countries?marketContextData.countries[iso]||{}:{};
 const fallback=MARKET_COORDINATES[iso]||{};
 const lat=num(ctx.latitude??fallback.lat),lon=num(ctx.longitude??fallback.lon);
 if(lat==null||lon==null||lat < -90||lat > 90||lon < -180||lon > 180)return null;
 return {lat,lon};
}
function valueOfFlow(flow){return num(flow.import_value_usd)??0;}
function tradeFlowProducts(flows,limit=6){
 return [...flows].sort((a,b)=>valueOfFlow(b)-valueOfFlow(a)).slice(0,limit).map(flow=>
  '<li><b>'+esc(flow.product_code||"HS")+'</b> · '+esc(flow.product_name||"Product")+
  '<span class="flow-value">'+esc(fmtMoney(valueOfFlow(flow)))+'</span></li>'
 ).join("");
}
function countryFlowPopup(iso){
 const related=tradeFlows.filter(flow=>flow.buyer_iso3===iso||flow.supplier_iso3===iso);
 if(!related.length)return '<div class="flow-popup"><b>No bilateral details</b><p>No partner-level product observations were returned for this country.</p></div>';
 const incoming=related.filter(flow=>flow.buyer_iso3===iso).sort((a,b)=>valueOfFlow(b)-valueOfFlow(a));
 const outgoing=related.filter(flow=>flow.supplier_iso3===iso).sort((a,b)=>valueOfFlow(b)-valueOfFlow(a));
 const name=(incoming[0]&&incoming[0].buyer_name)||(outgoing[0]&&outgoing[0].supplier_name)||iso;
 const suppliers=[...new Set(incoming.map(flow=>flow.supplier_iso3))].length;
 const buyers=[...new Set(outgoing.map(flow=>flow.buyer_iso3))].length;
 return '<div class="flow-popup"><h3>'+esc(name)+' ('+esc(iso)+')</h3>'+
  '<p>Based on selected UN Comtrade import reports; partners are declared origins, not named companies.</p>'+
  '<h4>Buys / reported imports <span>'+incoming.length+'</span></h4>'+
  (incoming.length?'<p class="flow-section-note">Partner countries reporting supply to '+esc(name)+' · '+suppliers+' origins</p><ul>'+tradeFlowProducts(incoming,5)+'</ul>':'<p>No selected import observations.</p>')+
  '<h4>Supplies / declared origins <span>'+outgoing.length+'</span></h4>'+
  (outgoing.length?'<p class="flow-section-note">Destinations reporting imports from '+esc(name)+' · '+buyers+' destinations</p><ul>'+tradeFlowProducts(outgoing,5)+'</ul>':'<p>No selected partner reports list this country as origin.</p>')+
  '</div>';
}
function connectionPopup(connection){
 const sum=connection.flows.reduce((total,flow)=>total+valueOfFlow(flow),0);
 return '<div class="flow-popup"><h3>'+esc(connection.supplierName)+' → '+esc(connection.buyerName)+'</h3>'+
  '<p>Declared origin / supplier → importing market / buyer</p>'+
  '<p>Dominant product group: <b>'+esc(connection.dominantSection?.label||"Other product groups")+'</b></p>'+
  '<p class="flow-total">Selected import value: <b>'+esc(fmtMoney(sum))+'</b></p>'+
  '<h4>Products reported</h4><ul>'+tradeFlowProducts(connection.flows,8)+'</ul>'+
  '<p class="flow-section-note">Values are reported imports for selected product codes, not retail sales or a verified company-to-company order.</p></div>';
}
function makeArcPoints(from,to){
 if(!map||!window.L)return [L.latLng(from.lat,from.lon),L.latLng(to.lat,to.lon)];
 const zoom=map.getZoom();
 const start=map.project([from.lat,from.lon],zoom);
 const end=map.project([to.lat,to.lon],zoom);
 const dx=end.x-start.x,dy=end.y-start.y,dist=Math.sqrt(dx*dx+dy*dy)||1;
 const bend=Math.min(90,Math.max(18,dist*.16));
 const side=((from.lon+to.lon)>=0)?-1:1;
 const control=L.point((start.x+end.x)/2+(-dy/dist)*bend*side,(start.y+end.y)/2+(dx/dist)*bend*side);
 const points=[];
 for(let i=0;i<=24;i++){
  const t=i/24,u=1-t;
  const point=L.point(u*u*start.x+2*u*t*control.x+t*t*end.x,u*u*start.y+2*u*t*control.y+t*t*end.y);
  points.push(map.unproject(point,zoom));
 }
 return points;
}
function addFlowArrow(point,previous,color){
 const a=map.latLngToLayerPoint(previous),b=map.latLngToLayerPoint(point);
 const angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;
 const icon=L.divIcon({
  className:"flow-arrow-icon",
  html:'<svg viewBox="0 0 16 16" aria-hidden="true" style="transform:rotate('+angle+'deg)"><path d="M2 2 L14 8 L2 14 L5 8 Z" fill="'+color+'" stroke="#ffffff" stroke-width="1"/></svg>',
  iconSize:[14,14],iconAnchor:[7,7]
 });
 L.marker(point,{icon,interactive:false,keyboard:false}).addTo(flowNodes);
}
const HS_SECTIONS=[
 {min:1,max:5,id:"animal",label:"Animal products",color:"#e76f51"},
 {min:6,max:14,id:"vegetable",label:"Vegetable products",color:"#2a9d8f"},
 {min:15,max:15,id:"fats",label:"Animal / vegetable fats",color:"#e9c46a"},
 {min:16,max:24,id:"prepared-food",label:"Prepared food & beverages",color:"#f4a261"},
 {min:25,max:27,id:"minerals",label:"Mineral products",color:"#e63946"},
 {min:28,max:38,id:"chemicals",label:"Chemicals",color:"#9b5de5"},
 {min:39,max:40,id:"plastics",label:"Plastics & rubber",color:"#f15bb5"},
 {min:41,max:43,id:"leather",label:"Leather & hides",color:"#bc6c25"},
 {min:44,max:49,id:"wood-paper",label:"Wood & paper",color:"#8d6e63"},
 {min:50,max:63,id:"textiles",label:"Textiles",color:"#4361ee"},
 {min:64,max:67,id:"footwear",label:"Footwear & headgear",color:"#7209b7"},
 {min:68,max:70,id:"stone-glass",label:"Stone, ceramic & glass",color:"#4d908e"},
 {min:71,max:71,id:"precious-metals",label:"Precious metals & gems",color:"#f8961e"},
 {min:72,max:83,id:"base-metals",label:"Base metals",color:"#277da1"},
 {min:84,max:85,id:"machinery",label:"Machinery & electronics",color:"#0077b6"},
 {min:86,max:89,id:"transport",label:"Transport equipment",color:"#f94144"},
 {min:90,max:92,id:"instruments",label:"Optical & medical instruments",color:"#577590"},
 {min:93,max:93,id:"arms",label:"Arms & ammunition",color:"#6c757d"},
 {min:94,max:96,id:"manufactures",label:"Miscellaneous manufactures",color:"#43aa8b"},
 {min:97,max:97,id:"art",label:"Art & antiques",color:"#bc6c25"}
];
const OTHER_FLOW_COLOR="#8793a2";
function hsSection(productCode){
 const chapter=Number(String(productCode||"").slice(0,2));
 return HS_SECTIONS.find(section=>chapter>=section.min&&chapter<=section.max)||{
  id:"other",label:"Other / unclassified",color:OTHER_FLOW_COLOR
 };
}
function assignFlowCategories(connections){
 const totals=new Map();
 connections.forEach(connection=>{
  const sectorValues=new Map();
  connection.flows.forEach(flow=>{
   const sector=hsSection(flow.product_code);
   sectorValues.set(sector.id,(sectorValues.get(sector.id)||0)+valueOfFlow(flow));
  });
  const dominantId=[...sectorValues.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||"other";
  const dominant=HS_SECTIONS.find(section=>section.id===dominantId)||{
   id:"other",label:"Other / unclassified",color:OTHER_FLOW_COLOR
  };
  connection.dominantSection=dominant;
  connection.dominantSectionValue=sectorValues.get(dominantId)||0;
  totals.set(dominantId,(totals.get(dominantId)||0)+connection.total);
 });
 const topIds=new Set([...totals.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(entry=>entry[0]));
 const legend=[...topIds].map(id=>{
  const section=HS_SECTIONS.find(item=>item.id===id)||{id:"other",label:"Other / unclassified",color:OTHER_FLOW_COLOR};
  return {...section,total:totals.get(id)||0};
 }).sort((a,b)=>b.total-a.total);
 const otherTotal=[...totals.entries()].filter(([id])=>!topIds.has(id)).reduce((sum,entry)=>sum+entry[1],0);
 if(otherTotal>0)legend.push({id:"other",label:"Other product groups",color:OTHER_FLOW_COLOR,total:otherTotal});
 connections.forEach(connection=>{
  connection.lineColor=topIds.has(connection.dominantSection.id)?connection.dominantSection.color:OTHER_FLOW_COLOR;
 });
 return legend;
}
function renderFlowLegend(legend){
 const target=$("mapLegend");
 if(!target)return;
 if(mapMode!=="flows"){target.hidden=true;target.innerHTML="";return;}
 target.hidden=false;
 const sectorItems=legend.map(item=>
  '<span class="map-legend-item"><i class="legend-swatch" style="--legend-color:'+item.color+'"></i><span>'+esc(item.label)+'</span></span>'
 ).join("");
 target.innerHTML=
  '<div class="legend-group"><b>Line colour · dominant product group (HS)</b><div class="legend-items">'+(sectorItems||'<span class="legend-muted">No mapped product categories.</span>')+'</div></div>'+
  '<div class="legend-group"><b>Country markers</b><div class="legend-items">'+
   '<span class="map-legend-item"><i class="legend-dot" style="--legend-color:#d97706"></i>Declared supplier</span>'+
   '<span class="map-legend-item"><i class="legend-dot" style="--legend-color:#0f8b82"></i>Importing buyer</span>'+
   '<span class="map-legend-item"><i class="legend-dot" style="--legend-color:#6750a4"></i>Both roles</span>'+
  '</div></div>'+
  '<div class="legend-group"><b>Direction & value</b><div class="legend-items">'+
   '<span class="map-legend-item"><i class="legend-arrow">➜</i>Origin → importer</span>'+
   '<span class="map-legend-item"><i class="legend-line legend-line-thin"></i>Lower value</span>'+
   '<span class="map-legend-item"><i class="legend-line legend-line-thick"></i>Higher value</span>'+
  '</div></div>'+
  '<p class="legend-footnote">Line colour uses the highest-value HS product group on each country pair. Grey lines represent other groups. Width reflects total selected import value on that link.</p>';
}
function updateFlowStatus(){
 const status=$("mapStatus"),note=$("mapNote");
 if(note)note.textContent="Arrow = declared origin → importer · colour = dominant HS product group · width = combined reported import value.";
 if(status){
  if(!tradeFlows.length){
   const state=String(tradeFlowMeta.status||"").toLowerCase();
   status.textContent=state==="awaiting-refresh"
    ?"Route data awaits the first bilateral refresh. Run GPIR CI and data refresh in GitHub Actions."
    :"No bilateral trade-flow records available. Check the trade-flow refresh status.";
  }else{
   const shown=collectConnections().length;
   status.textContent=shown+" supplier → buyer links · "+tradeFlows.length.toLocaleString()+" product-level observations";
  }
 }
}
function collectConnections(){
 const pairs=new Map();
 for(const flow of tradeFlows){
  const supplier=String(flow.supplier_iso3||"").toUpperCase(),buyer=String(flow.buyer_iso3||"").toUpperCase();
  if(!supplier||!buyer||supplier===buyer)continue;
  const from=countryPoint(supplier),to=countryPoint(buyer);
  if(!from||!to)continue;
  const key=supplier+"|"+buyer;
  let pair=pairs.get(key);
  if(!pair){pair={key,supplier,buyer,supplierName:flow.supplier_name||supplier,buyerName:flow.buyer_name||buyer,from,to,total:0,flows:[]};pairs.set(key,pair);}
  pair.total+=valueOfFlow(flow);pair.flows.push(flow);
 }
 return [...pairs.values()].sort((a,b)=>b.total-a.total).slice(0,90);
}
function filterRankingToCountry(iso){
 const countrySelect=$("country");
 const marketRecord=allRows.find(row=>row._iso===iso);
 if(!countrySelect||!marketRecord)return;
 const country=marketRecord._country;
 if(!country||![...countrySelect.options].some(option=>option.value===country))return;
 countrySelect.value=country;
 selected=null;
 applyFilters();
 const record=filtered.find(row=>row._iso===iso);
 if(record)selectRecord(record);
}
function renderFlowMap(){
 if(!flowLayer||!flowNodes||!markers)return;
 markers.clearLayers();flowLayer.clearLayers();flowNodes.clearLayers();
 const connections=collectConnections();
 const legend=assignFlowCategories(connections);
 renderFlowLegend(legend);
 const nodeMap=new Map();
 connections.forEach(connection=>{
  for(const [iso,name,point,role] of [
   [connection.supplier,connection.supplierName,connection.from,"supplier"],
   [connection.buyer,connection.buyerName,connection.to,"buyer"]
  ]){
   let node=nodeMap.get(iso);
   if(!node){node={iso,name,point,roles:new Set()};nodeMap.set(iso,node);}
   node.roles.add(role);
  }
 });
 connections.forEach(connection=>{
  const weight=Math.min(7,Math.max(1.5,1.25+Math.log10(Math.max(1,connection.total))*.43));
  const points=makeArcPoints(connection.from,connection.to);
  const color=connection.lineColor||OTHER_FLOW_COLOR;
  const line=L.polyline(points,{renderer:flowRenderer,color,weight,opacity:.78,lineCap:"round",lineJoin:"round",className:"trade-flow-path"});
  line.bindPopup(connectionPopup(connection),{maxWidth:340});
  line.on("mouseover",()=>line.setStyle({opacity:1,weight:Math.min(9,weight+1.5)}));
  line.on("mouseout",()=>line.setStyle({opacity:.78,weight}));
  flowLayer.addLayer(line);
  if(points.length>1)addFlowArrow(points[points.length-1],points[points.length-2],color);
 });
 nodeMap.forEach(node=>{
  const both=node.roles.has("buyer")&&node.roles.has("supplier");
  const marker=L.circleMarker([node.point.lat,node.point.lon],{
   radius:both?7:6,weight:2,color:"#ffffff",
   fillColor:both?"#6750a4":node.roles.has("supplier")?"#d97706":"#0f8b82",fillOpacity:.95
  });
  marker.bindPopup(countryFlowPopup(node.iso),{maxWidth:360});
  marker.bindTooltip(esc(node.name)+" ("+esc(node.iso)+")");
  marker.on("click",()=>filterRankingToCountry(node.iso));
  flowNodes.addLayer(marker);
 });
 if(!flowMapHasAutoFit&&connections.length){
  const bounds=L.latLngBounds([...nodeMap.values()].map(node=>[node.point.lat,node.point.lon]));
  if(bounds.isValid()){map.fitBounds(bounds.pad(.12),{maxZoom:4});flowMapHasAutoFit=true;}
 }
 updateFlowStatus();
}
function renderMapMode(){
 if(mapMode==="flows")renderFlowMap();
 else{
  if(flowLayer)flowLayer.clearLayers();
  if(flowNodes)flowNodes.clearLayers();
  renderMarkers();
 }
}
function setMapMode(mode){
 mapMode=mode==="flows"?"flows":"signals";
 const signals=$("mapModeSignals"),flows=$("mapModeFlows"),subtitle=$("mapSubtitle"),badge=$("mapPanelBadge"),note=$("mapNote");
 if(signals){signals.classList.toggle("active",mapMode==="signals");signals.setAttribute("aria-pressed",String(mapMode==="signals"));}
 if(flows){flows.classList.toggle("active",mapMode==="flows");flows.setAttribute("aria-pressed",String(mapMode==="flows"));}
 if(subtitle)subtitle.textContent=mapMode==="flows"?"Explore which countries report imports from other countries":"Select a marker to inspect a product–market signal";
 if(badge)badge.textContent=mapMode==="flows"?"BILATERAL IMPORT LINKS":"TRADE SIGNALS";
 if(note)note.textContent=mapMode==="flows"?"Lines show reported imports: declared origin → importing market. Thicker lines indicate larger value among selected products.":"Country markers show approximate reference locations; trade values are not retail sales.";
 if(mapMode==="flows"){
  markers.clearLayers();
  flowLayer.clearLayers();flowNodes.clearLayers();
  if(tradeFlowsLoaded)renderFlowMap();
  else{
   const status=$("mapStatus");
   if(status)status.textContent="Loading bilateral import relationships…";
   loadBilateralFlows();
  }
 }else{
  renderFlowLegend([]);
  renderMapMode();
 }
}
function toggleMapFullscreen(force){
 const panel=$("mapPanel"),button=$("mapFullscreenBtn");
 if(!panel)return;
 const shouldOpen=typeof force==="boolean"?force:!panel.classList.contains("map-panel-fullscreen");
 panel.classList.toggle("map-panel-fullscreen",shouldOpen);
 document.body.classList.toggle("map-fullscreen-open",shouldOpen);
 if(button){
  button.setAttribute("aria-pressed",String(shouldOpen));
  button.textContent=shouldOpen?"✕ Exit full screen":"⛶ Full screen";
  button.title=shouldOpen?"Exit full-screen map (Esc)":"Open map in full screen";
 }
 if(map)requestAnimationFrame(()=>map.invalidateSize({pan:false}));
}
function loadFullscreenKeyHandler(event){
 if(event.key==="Escape"&&$("mapPanel")?.classList.contains("map-panel-fullscreen"))toggleMapFullscreen(false);
}
async function loadBilateralFlows(){
 if(tradeFlowsLoaded){if(mapMode==="flows")renderFlowMap();return;}
 if(tradeFlowsLoading)return;
 tradeFlowsLoading=true;
 const status=$("mapStatus");
 if(status&&mapMode==="flows")status.textContent="Loading bilateral import relationships…";
 try{
  const response=await fetch("./data/trade_flows.json?t="+Date.now(),{cache:"no-store"});
  if(!response.ok)throw new Error("HTTP "+response.status);
  const payload=await response.json();
  tradeFlows=Array.isArray(payload.flows)?payload.flows:[];
  tradeFlowMeta=payload.meta||{};
  tradeFlowsLoaded=true;
 }catch(error){
  tradeFlows=[];tradeFlowMeta={status:"unavailable",error:error.message};tradeFlowsLoaded=false;
  console.warn("Bilateral trade-flow file unavailable",error);
 }finally{
  tradeFlowsLoading=false;
  if(mapMode==="flows")renderFlowMap();
 }
}

function selectRecord(r){if(!r)return;selected=r;showDetails(r);document.querySelectorAll("#rankBody tr").forEach(tr=>tr.style.background=tr.dataset.id===r._id?"#eaf2fc":"");}
function showDetails(r){
 $("evidencePill").textContent=(r._status||"unknown").replaceAll("_"," ").toUpperCase();
 const macro=[];
 if(r._gdpPerCapita!=null)macro.push('<div><span>GDP per capita · World Bank</span><b>'+fmtMoney(r._gdpPerCapita)+(r._gdpPerCapitaYear?' ('+esc(r._gdpPerCapitaYear)+')':'')+'</b></div>');
 if(r._population!=null)macro.push('<div><span>Population · World Bank</span><b>'+Number(r._population).toLocaleString()+(r._populationYear?' ('+esc(r._populationYear)+')':'')+'</b></div>');
 $("details").innerHTML='<h3>'+esc(r._productName)+'</h3><p>HS '+esc(r._hs)+' · '+esc(r._country)+' · observation '+esc(r._period||"unknown period")+'</p><div class="meta"><div><span>Reported trade value</span><b>'+fmtMoney(r._value)+'</b></div><div><span>Year-on-year growth</span><b>'+fmtPct(r._growth)+'</b></div><div><span>3-year CAGR</span><b>'+fmtPct(r._cagr)+'</b></div><div><span>Opportunity score</span><b>'+(score(r)==null?"Not available":score(r).toFixed(0)+"/100")+'</b></div><div><span>Source</span><b>'+esc(r._source)+'</b></div><div><span>Quantity</span><b>'+(r._quantity==null?"Not reported":r._quantity.toLocaleString())+'</b></div>'+macro.join("")+'</div>'+(r._sourceUrl?'<p><a href="'+esc(r._sourceUrl)+'" target="_blank" rel="noopener">Open source record ↗</a></p>':"")+'<p>Interpretation: import growth can indicate rising cross-border demand, but does not establish retail sales or profitability. World Bank indicators are country-level context only.</p>';
 if(r._lat!=null&&r._lon!=null&&map)map.setView([r._lat,r._lon],Math.max(map.getZoom(),3));
}
async function loadData(){
 $("dataNotice").textContent="Loading trade feed…";
 const contextPromise=window.GPIRMarketContext?window.GPIRMarketContext.load():Promise.resolve(null);
 let feedLoaded=false;
 try{
  const res=await fetch(DATA_URL+"?t="+Date.now(),{cache:"no-store"});if(!res.ok)throw new Error("HTTP "+res.status);
  const raw=await res.json();
  feedLoaded=true;
  // Share the already-loaded trade feed with the homepage SME Finder; avoid a second large JSON download.
  window.GPIRTradeItems=Array.isArray(raw.items)?raw.items:(Array.isArray(raw.records)?raw.records:(Array.isArray(raw.data)?raw.data:[]));
  window.dispatchEvent(new Event("gpir-trade-feed-ready"));
  allRows=normalize(raw,null);
  setupFilters();applyFilters();
  const meta=raw.meta||raw.metadata||{},status=String(meta.status||meta.data_status||meta.mode||"unknown");
  const isDemo=status.toLowerCase().includes("demo")||status.toLowerCase().includes("sample")||allRows.some(r=>r._status==="demo");
  const baseNotice=isDemo?"DEMO DATA — These are illustrative values, not verified statistics. Run the pipeline to replace them with fetched trade data.":allRows.length?("DATA STATUS: "+status.replaceAll("_"," ").toUpperCase()+" — Annual import data are trade statistics, not retail sales."): "NO DATA YET — Pipeline has not populated data/data.json. Run the GitHub Actions workflow or configure the UN Comtrade API key.";
  $("dataNotice").textContent=baseNotice+" Loading country context separately from the World Bank API…";
  $("dataNotice").style.background=isDemo?"#fff7e2":"#eef6ff";$("dataNotice").style.borderColor=isDemo?"#f1d998":"#c9ddf7";$("dataNotice").style.color=isDemo?"#694a08":"#204f82";
  $("updatedAt").textContent="Trade build: "+(raw.generated_at||meta.generated_at||"unknown")+" · Mode: "+status;
  // Keep the trade dashboard usable while public macro context loads in parallel.
  let context=null;
  try{context=await contextPromise;}catch(error){console.warn("World Bank context unavailable",error);}
  const contextCount=context&&context.countries?Object.keys(context.countries).length:0;
  marketContextData=context;
  if(contextCount){
   const selectedCountry=$("country").value;
   allRows=normalize(raw,context);setupFilters();
   if(selectedCountry&&[...$("country").options].some(o=>o.value===selectedCountry))$("country").value=selectedCountry;
   applyFilters();
  }
  const contextNote=contextCount
   ? " World Bank context loaded directly in this browser ("+contextCount+" country records; cached for 12 hours)."
   : " World Bank context unavailable; trade data still works without it.";
  $("dataNotice").textContent=baseNotice+contextNote;
  $("updatedAt").textContent="Trade build: "+(raw.generated_at||meta.generated_at||"unknown")+" · Mode: "+status+" · Context: "+(contextCount?"World Bank/browser":"unavailable");
 }catch(e){
  console.error("GPIR dashboard loading/rendering error",e);
  if(feedLoaded){
   // Do not report a fetched JSON feed as missing when a later UI step fails.
   $("dataNotice").textContent="Trade data loaded, but the dashboard could not finish rendering ("+e.message+"). Reload the page; the JSON feed was fetched successfully.";
  }else{
   allRows=[];filtered=[];
   try{render();}catch(renderError){console.error("Unable to render empty dashboard",renderError);}
   $("dataNotice").textContent="Could not load data/data.json ("+e.message+"). Check the network response and deployed file path.";
  }
  $("dataNotice").style.background="#feeceb";$("dataNotice").style.borderColor="#f1b8b5";$("dataNotice").style.color="#9a2424";
 }
}
$("search").addEventListener("input",applyFilters);$("country").addEventListener("change",applyFilters);$("category").addEventListener("change",applyFilters);$("reload").addEventListener("click",loadData);$("reset").addEventListener("click",()=>{$("search").value="";$("country").value="";$("category").value="";applyFilters()});
$("mapModeSignals").addEventListener("click",()=>setMapMode("signals"));
$("mapModeFlows").addEventListener("click",()=>setMapMode("flows"));
$("mapFullscreenBtn").addEventListener("click",()=>toggleMapFullscreen());
document.addEventListener("keydown",loadFullscreenKeyHandler);
window.addEventListener("resize",()=>{if(map)map.invalidateSize({pan:false});});
initMap();loadData();
})();