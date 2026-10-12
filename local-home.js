(function(){
"use strict";
const $=id=>document.getElementById(id),CATALOG_URL="./data/opportunity_catalog.json",TOURISM_URL="./data/tourism_places.json";
const POI_TTL=6*60*60*1000,GEOCODE_TTL=30*24*60*60*1000;
const colors={tourism:"#db2777",retail:"#2563eb",market:"#d97706",food_buyer:"#b45309",supplier:"#7c3aed",maker:"#7c3aed",service:"#0891b2",institution:"#059669",other:"#64748b"};
let catalog=[],tourismSnapshot=[],map=null,markers=null,lines=null,userMarker=null,radiusCircle=null,areaRectangle=null,coords=null,placeLabel="",placeBounds=null,points=[],activeIdea=null,lastRequest=0;
const esc=v=>String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num=v=>v==null||v===""||!Number.isFinite(Number(v))?null:Number(v);
const money=v=>v==null?"—":new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(v);
function cacheRead(key,ttl){for(const getStore of [()=>sessionStorage,()=>localStorage]){try{const store=getStore(),o=JSON.parse(store.getItem(key)||"null");if(o&&o.savedAt&&Date.now()-o.savedAt<ttl)return o.data;}catch(_){}}return null;}
function cacheWrite(key,data){const s=JSON.stringify({savedAt:Date.now(),data});try{sessionStorage.setItem(key,s);}catch(_){}if(key.startsWith("gpir:geocode:"))try{localStorage.setItem(key,s);}catch(_){}}
function labelType(t){return t==="grow"?"Tanam / budidaya":t==="service"?"Usaha jasa":"Jual produk / olahan";}
function classify(el){const t=el.tags||{},shop=String(t.shop||"").toLowerCase(),a=String(t.amenity||"").toLowerCase(),craft=String(t.craft||"").toLowerCase(),office=String(t.office||"").toLowerCase(),land=String(t.landuse||"").toLowerCase(),tourism=String(t.tourism||"").toLowerCase(),historic=String(t.historic||"").toLowerCase(),natural=String(t.natural||"").toLowerCase(),leisure=String(t.leisure||"").toLowerCase();
 if(["attraction","museum","gallery","viewpoint","theme_park","zoo","aquarium","artwork","picnic_site"].includes(tourism)||["monument","memorial","ruins","castle","archaeological_site"].includes(historic)||["beach","waterfall","hot_spring","cave_entrance"].includes(natural)||["park","garden"].includes(leisure))return "tourism";
 if(a==="marketplace")return "market";
 if(["restaurant","cafe","fast_food","food_court","bakery","ice_cream"].includes(a))return "food_buyer";
 if(["car_repair","motorcycle_repair","bicycle_repair","tailor","electronics_repair","shoemaker"].includes(craft)||["car_repair","bicycle","motorcycle"].includes(shop)||["car_repair","repair"].includes(a))return "service";
 if(["farmland","orchard","plant_nursery"].includes(land)||["agrarian","farm"].includes(shop)||shop==="wholesale"||office==="wholesale")return "supplier";
 if(craft||["company","commercial"].includes(office))return "maker";if(shop)return "retail";
 if(["school","hospital","clinic","community_centre","hotel","guest_house"].includes(a))return "institution";return "other";}
function poiLabel(cat){return ({tourism:"Atraksi wisata / budaya",retail:"Toko / retail",market:"Pasar / marketplace",food_buyer:"Usaha kuliner",supplier:"Pemasok / pertanian",maker:"Pengrajin / usaha",service:"Jasa / bengkel",institution:"Institusi / fasilitas",other:"Titik usaha/fasilitas"})[cat]||cat;}
function km(a,b,c,d){const r=x=>x*Math.PI/180,dl=r(c-a),dn=r(d-b),x=Math.sin(dl/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(dn/2)**2;return 6371*2*Math.asin(Math.sqrt(x));}
function kmLabel(n){return n==null?"jarak tidak tersedia":n<1?Math.round(n*1000)+" m":n.toFixed(1)+" km";}
function nearbyTourismAttractions(limitKm=Infinity){
 if(!coords)return[];const rows=[];
 points.filter(p=>p.cat==="tourism"&&num(p.lat)!=null&&num(p.lon)!=null).forEach(p=>{const dist=km(coords.lat,coords.lon,Number(p.lat),Number(p.lon));if(dist<=limitKm)rows.push({...p,dist,source:"OpenStreetMap"});});
 tourismSnapshot.filter(p=>p&&p.kind==="tourist_attraction"&&num(p.lat)!=null&&num(p.lon)!=null).forEach(p=>{const dist=km(coords.lat,coords.lon,Number(p.lat),Number(p.lon));if(dist<=limitKm)rows.push({key:"snapshot:"+p.id,name:p.name||"Unnamed attraction",cat:"tourism",lat:Number(p.lat),lon:Number(p.lon),dist,source:p.source||"Tourism snapshot",url:p.url||""});});
 const unique=[];rows.sort((a,b)=>a.dist-b.dist).forEach(p=>{if(!unique.some(q=>String(q.name).toLowerCase()===String(p.name).toLowerCase()&&Math.abs(q.dist-p.dist)<.12))unique.push(p);});
 return unique.filter(p=>p.dist<=limitKm);
}
function updateTourismStatus(){
 const el=$("homeTourismStatus");if(!el)return;const lang=window.GPIRi18n&&window.GPIRi18n.getLanguage?window.GPIRi18n.getLanguage():"id";
 const words={id:{wait:"Wisata ≤3 km: belum dicek",very:"Wisata sangat dekat",near:"Dekat destinasi wisata",none:"Tidak ada atraksi terpetakan ≤3 km; data mungkin tidak lengkap",nearest:"Wisata terdekat terpetakan",outside:"di luar zona dekat (>3 km)"},en:{wait:"Tourism ≤3 km: not checked",very:"Very close attraction",near:"Near a tourist attraction",none:"No mapped attraction ≤3 km; coverage may be incomplete",nearest:"Nearest mapped attraction",outside:"outside the nearby zone (>3 km)"},es:{wait:"Turismo ≤3 km: sin comprobar",very:"Atracción muy cercana",near:"Cerca de una atracción",none:"No hay atracción cartografiada ≤3 km; la cobertura puede ser incompleta",nearest:"Atracción más cercana cartografiada",outside:"fuera de la zona cercana (>3 km)"},fr:{wait:"Tourisme ≤3 km : non vérifié",very:"Attraction très proche",near:"Près d’une attraction",none:"Aucune attraction cartographiée ≤3 km ; couverture possiblement incomplète",nearest:"Attraction cartographiée la plus proche",outside:"hors de la zone proche (>3 km)"},ar:{wait:"السياحة ≤3 كم: لم يتم التحقق",very:"معلم قريب جداً",near:"بالقرب من معلم سياحي",none:"لا يوجد معلم مسجل ≤3 كم؛ قد تكون التغطية غير مكتملة",nearest:"أقرب معلم مسجل",outside:"خارج نطاق القرب (>3 كم)"},zh:{wait:"3 公里内旅游景点：尚未检查",very:"附近有旅游景点",near:"靠近旅游景点",none:"3 公里内无地图景点；覆盖可能不完整",nearest:"最近的地图景点",outside:"超出附近范围（>3 公里）"},ru:{wait:"Туризм ≤3 км: не проверено",very:"Очень близкая достопримечательность",near:"Рядом с достопримечательностью",none:"Нет отмеченных достопримечательностей ≤3 км; покрытие может быть неполным",nearest:"Ближайшая отмеченная достопримечательность",outside:"за пределами ближней зоны (>3 км)"}}[lang]||{wait:"Tourism ≤3 km: not checked",very:"Very close attraction",near:"Near a tourist attraction",none:"No mapped attraction ≤3 km; coverage may be incomplete",nearest:"Nearest mapped attraction",outside:"outside the nearby zone (>3 km)"};
 if(!coords){el.textContent=words.wait;el.className="pill gray";return;}
 const close=nearbyTourismAttractions(3),nearest=nearbyTourismAttractions()[0];
 if(close.length){const p=close[0];el.textContent=(p.dist<=1?words.very:words.near)+": "+p.name+" · "+kmLabel(p.dist);el.className="pill green";}
 else if(nearest&&nearest.dist>3){el.textContent=words.nearest+": "+nearest.name+" · "+kmLabel(nearest.dist)+" — "+words.outside;el.className="pill gray";}
 else{el.textContent=words.none;el.className="pill gray";}
}
function initMap(){if(!window.L){$("homeLocalMap").innerHTML='<div class="empty">Peta gagal dimuat. Rekomendasi usaha tetap tersedia.</div>';return;}
 map=L.map("homeLocalMap",{scrollWheelZoom:false}).setView([-2.5,118],4);
 L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:18,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
 markers=L.layerGroup().addTo(map);lines=L.layerGroup().addTo(map);}
function validBounds(b){return !!b&&[b.south,b.west,b.north,b.east].every(Number.isFinite)&&b.south<b.north&&b.west<b.east&&(b.north-b.south)*(b.east-b.west)<=1.2;}
function parseBounds(raw){if(!Array.isArray(raw)||raw.length<4)return null;const b={south:Number(raw[0]),north:Number(raw[1]),west:Number(raw[2]),east:Number(raw[3])};return validBounds(b)?b:null;}
function updateMap(){if(!map||!coords)return;const radius=Number($("homeRadius").value||3000);if(userMarker)map.removeLayer(userMarker);if(radiusCircle)map.removeLayer(radiusCircle);if(areaRectangle)map.removeLayer(areaRectangle);
 userMarker=L.circleMarker([coords.lat,coords.lon],{radius:8,color:"#fff",weight:2,fillColor:"#dc2626",fillOpacity:1}).bindPopup("<b>Lokasi aktif</b><br>"+esc(placeLabel)).addTo(map);
 if($("homeCoverage").value==="area"&&validBounds(placeBounds)){areaRectangle=L.rectangle([[placeBounds.south,placeBounds.west],[placeBounds.north,placeBounds.east]],{color:"#2563eb",weight:2,dashArray:"6 4",fillColor:"#60a5fa",fillOpacity:.04}).addTo(map);map.fitBounds(areaRectangle.getBounds(),{padding:[12,12],maxZoom:11});}
 else{radiusCircle=L.circle([coords.lat,coords.lon],{radius,color:"#dc2626",weight:1,dashArray:"5 5",fillColor:"#dc2626",fillOpacity:.035}).addTo(map);map.setView([coords.lat,coords.lon],radius<=1000?14:radius<=3000?13:radius<=10000?11:10);}}
function finderUrl(type){const u=new URL("./enterprise.html",window.location.href);if(coords){u.searchParams.set("lat",coords.lat);u.searchParams.set("lon",coords.lon);u.searchParams.set("location",placeLabel);}u.searchParams.set("radius",$("homeRadius").value||"3000");u.searchParams.set("scope",$("homeCoverage").value||"nearby");if(placeBounds)u.searchParams.set("bounds",[placeBounds.south,placeBounds.north,placeBounds.west,placeBounds.east].join(","));u.searchParams.set("type",type||$("homeTypeFilter").value||"all");return u.pathname+u.search;}
function updateLocation(lat,lon,label,bounds=null){coords={lat,lon};placeLabel=label||"Lokasi terpilih";placeBounds=validBounds(bounds)?bounds:null;$("homeLocationName").textContent=placeLabel;updateMap();updateTourismStatus();renderRecommendations();}
function ideaType(o){return o.business_type||(o.id==="local-aggregation"||o.id==="textile-craft-micro"?"service":"sell");}
function typeFilter(){return $("homeTypeFilter").value||"all";}
function selectedIdea(){return catalog.find(o=>o.id===activeIdea)||null;}
function relevantCategories(){const o=selectedIdea();return new Set(o&&o.map_categories||[]);}
function renderPoints(elements){if(!coords)return;const unique=new Map();(elements||[]).forEach(el=>{const t=el.tags||{},lat=num(el.lat!=null?el.lat:el.center&&el.center.lat),lon=num(el.lon!=null?el.lon:el.center&&el.center.lon),cat=classify(el),key=el.type+"/"+el.id;unique.set(key,{raw:el,key,name:t.name||t.brand||t.operator||"Lokasi tanpa nama",cat,lat,lon,dist:lat==null||lon==null?null:km(coords.lat,coords.lon,lat,lon)});});
 points=[...unique.values()].sort((a,b)=>(a.dist??9999)-(b.dist??9999));drawPoints();updateTourismStatus();renderRecommendations();}
function drawPoints(){if(!map||!markers||!lines||!coords)return;markers.clearLayers();lines.clearLayers();const cats=relevantCategories();
 const mapPoints=points.length<=350?points:points.filter((p,i)=>i%Math.ceil(points.length/350)===0).slice(0,350);mapPoints.forEach((p,i)=>{if(p.lat==null||p.lon==null)return;const rel=cats.has(p.cat);
  if(i<35)L.polyline([[coords.lat,coords.lon],[p.lat,p.lon]],{color:rel?"#0d9488":(colors[p.cat]||colors.other),weight:rel?2:1,opacity:rel?.65:.25,dashArray:rel?"":"4 5"}).addTo(lines);
  L.circleMarker([p.lat,p.lon],{radius:rel?7:5,color:"#fff",weight:1,fillColor:colors[p.cat]||colors.other,fillOpacity:.9}).bindPopup("<b>"+esc(p.name)+"</b><br>"+esc(poiLabel(p.cat))+"<br>"+esc(kmLabel(p.dist))).addTo(markers);
 });
 updateMap();$("homePoiCount").textContent=points.length+" titik";
}
function renderRecommendations(){if(!catalog.length)return;const filter=typeFilter();const tourismCount=nearbyTourismAttractions(3).length;const scored=catalog.map(o=>{const localCount=points.filter(p=>(o.map_categories||[]).includes(p.cat)&&(p.cat!=="tourism"||(p.dist!=null&&p.dist<=3))).length;const tourismBonus=tourismCount>0?(o.tourism_fit==="high"?6:o.tourism_fit==="medium"?3:0):0;return {...o,business_type:ideaType(o),localCount,tourismNearbyCount:tourismCount,tourismBonus,rankingScore:localCount+tourismBonus};});
 let display;
 if(filter==="all"){display=["sell","grow","service"].map(t=>scored.filter(o=>o.business_type===t).sort((a,b)=>b.rankingScore-a.rankingScore)[0]).filter(Boolean);}
 else display=scored.filter(o=>o.business_type===filter).sort((a,b)=>b.rankingScore-a.rankingScore).slice(0,3);
 if(!coords)$("homeLocationStatus").textContent="Contoh ide ditampilkan. Deteksi lokasi atau cari lokasi pilihan untuk memetakan tempat sekitar.";
 $("homeRecommendations").innerHTML=display.map(o=>{const t=o.business_type,tag=t==="grow"?"grow":t==="service"?"service":"sell",title=o.title,prod=(o.products||[]).slice(0,3).join(" · ");
  const buy=(o.buy_from||["Pemasok yang dapat diverifikasi"]).slice(0,2).join(" · "),buyers=(o.sell_to||["Wawancarai calon pembeli"]).slice(0,2).join(" · ");
  const supplierQ=[o.local_input_search||"pemasok bahan",placeLabel].filter(Boolean).join(" "),buyerQ=[o.local_buyer_search||(o.sell_to||["calon pembeli"]).slice(0,2).join(" "),placeLabel].filter(Boolean).join(" ");
  const onlineQ=o.online_input_search||prod,foreignQ=o.international_search||prod+" importer";
  const searchMaps="https://www.google.com/maps/search/?api=1&query=";
  const relationButton='<button class="primary" data-home-idea="'+esc(o.id)+'">Lihat hubungan →</button>';
  return '<article class="home-rec-card '+(activeIdea===o.id?"home-selected":"")+'"><span class="home-rec-tag '+tag+'">'+esc(labelType(t))+'</span><h3>'+esc(title)+'</h3><p class="home-rec-action-summary">'+esc(o.action_summary||o.rationale||"Uji dulu dengan calon pembeli.")+'</p><p><b>Produk / jasa:</b> '+esc(prod)+'</p><p><b>Modal awal indikatif:</b> '+esc(money(o.capital_min_idr))+'–'+esc(money(o.capital_max_idr))+'</p><p><b>Perlu disiapkan:</b> '+esc(buy)+'</p><p><b>Calon pembeli:</b> '+esc(buyers)+'</p><p><b>Tempat sekitar:</b> '+esc(coords?o.localCount+" titik berkategori terkait":"Pilih lokasi untuk mencari titik")+'</p><div class="home-rec-actions"><a href="'+esc(searchMaps+encodeURIComponent(supplierQ))+'" target="_blank" rel="noopener noreferrer">Cari pemasok ↗</a><a href="'+esc(searchMaps+encodeURIComponent(buyerQ))+'" target="_blank" rel="noopener noreferrer">Cari calon pembeli ↗</a><a href="'+esc("https://www.tokopedia.com/search?st=product&q="+encodeURIComponent(onlineQ))+'" target="_blank" rel="noopener noreferrer">Beli bahan ↗</a><a href="'+esc("https://www.google.com/search?q="+encodeURIComponent(foreignQ+" supplier"))+'" target="_blank" rel="noopener noreferrer">Cari pemasok luar ↗</a></div><div class="home-rec-actions">'+relationButton+'<a class="primary" href="'+esc(finderUrl(t))+'">Rencana lengkap →</a></div></article>';
 }).join("");
 $("homeRecommendations").querySelectorAll("[data-home-idea]").forEach(b=>b.addEventListener("click",()=>{activeIdea=b.dataset.homeIdea;renderRecommendations();renderRelationship();drawPoints();}));
 $("homeOpenFinder").href=finderUrl(filter);renderRelationship();}
function renderRelationship(){const o=selectedIdea();if(!o){$("homeRelationship").innerHTML='<div class="empty">Pilih satu ide.</div>';return;}
 const relevant=points.filter(p=>(o.map_categories||[]).includes(p.cat)).slice(0,2),nearText=relevant.length?relevant.map(p=>p.name+" ("+kmLabel(p.dist)+")").join(" · "):"Belum ada titik kategori terkait";
 const nodes=[
 ["INPUT / LOKASI",placeLabel||"Lokasi belum dipilih","Sumber daya dan keterampilan masih perlu dikonfirmasi"],
 [labelType(ideaType(o)),(o.products||[]).slice(0,2).join(" · "),o.action_summary||o.rationale],
 ["CALON PEMBELI",(o.sell_to||[]).slice(0,2).join(" · "),"Segmen untuk diwawancarai, bukan buyer terkonfirmasi"],
 ["TITIK SEKITAR",nearText,"Data peta hanya memberi petunjuk tempat"],
 ["PASAR LUAR",o.international_search||"Riset buyer sesuai produk","Pencarian bukan daftar order; impor bukan retail sales"]
 ];
 $("homeRelationshipTitle").textContent="Rantai peluang · "+o.title;
 $("homeRelationship").innerHTML=nodes.map((n,i)=>'<div class="home-flow-step '+(i===1?"is-active":"")+(o.id===activeIdea?" home-selected":"")+'"><b>'+esc(n[0])+'</b><strong>'+esc(n[1])+'</strong><small>'+esc(n[2])+'</small></div>').join("");}
async function searchNearby(){if(!coords)return;const radius=Number($("homeRadius").value||3000),lat=coords.lat,lon=coords.lon,areaMode=$("homeCoverage").value==="area";if(areaMode&&!validBounds(placeBounds)){$("homeLocationStatus").textContent="Untuk peta satu kota penuh, cari nama kota/area administratif terlebih dahulu, misalnya Jakarta, Indonesia.";$("homeLocationQuery").focus();return;}const scopeKey=areaMode?"area:"+[placeBounds.south,placeBounds.west,placeBounds.north,placeBounds.east].map(v=>v.toFixed(3)).join(","):"nearby:"+radius,key="gpir:overpass:v3:"+scopeKey+":"+lat.toFixed(3)+":"+lon.toFixed(3);
 const cached=cacheRead(key,POI_TTL);if(Array.isArray(cached)){renderPoints(cached);$("homeLocationStatus").textContent="Titik sekitar dimuat dari cache; pastikan tempat masih aktif.";return;}
 if(Date.now()-lastRequest<1500){$("homeLocationStatus").textContent="Tunggu sebentar sebelum mencari lagi.";return;}lastRequest=Date.now();
 $("homeLocationStatus").textContent="Mencari titik pasar, toko, pemasok dan jasa…";$("homePoiCount").textContent="Mencari…";
 const shape=areaMode?'nwr('+placeBounds.south+','+placeBounds.west+','+placeBounds.north+','+placeBounds.east+')':'nwr(around:'+radius+','+lat+','+lon+')';
 const q='[out:json][timeout:35];('+shape+'["shop"];'+shape+'["amenity"~"marketplace|restaurant|cafe|fast_food|food_court|bakery|ice_cream|community_centre|school|hospital|clinic|car_repair|fuel"];'+shape+'["craft"];'+shape+'["office"~"company|commercial|wholesale"];'+shape+'["landuse"~"farmland|orchard|plant_nursery"];);out center tags;';
 try{const r=await fetch("https://overpass-api.de/api/interpreter?data="+encodeURIComponent(q),{headers:{"Accept":"application/json"}});if(!r.ok)throw new Error("HTTP "+r.status);
  const j=await r.json(),u=new Map();(j.elements||[]).forEach(el=>u.set(el.type+"/"+el.id,el));const rows=[...u.values()];cacheWrite(key,rows);renderPoints(rows);
  $("homeLocationStatus").textContent=points.length+" titik ditemukan dalam radius "+(radius/1000)+" km. Verifikasi sebelum membeli/menjual.";
 }catch(e){$("homeLocationStatus").textContent="Layanan peta tidak tersedia saat ini. Ide usaha umum masih bisa digunakan.";$("homePoiCount").textContent="Titik tidak tersedia";}}
async function searchLocation(){const q=$("homeLocationQuery").value.trim();if(q.length<3){$("homeLocationStatus").textContent="Masukkan nama kecamatan/kota yang lebih lengkap.";return;}
 const key="gpir:geocode:search:"+q.toLowerCase();let item=cacheRead(key,GEOCODE_TTL);
 if(!item){$("homeSearchLocation").disabled=true;$("homeLocationStatus").textContent="Mencari lokasi pilihan…";
  try{const r=await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q="+encodeURIComponent(q),{headers:{"Accept":"application/json"}});if(!r.ok)throw new Error("HTTP "+r.status);
   const rows=await r.json();if(!rows.length)throw new Error("Lokasi tidak ditemukan; tambahkan kabupaten/provinsi.");item=rows[0];cacheWrite(key,item);
  }catch(e){$("homeLocationStatus").textContent="Pencarian lokasi gagal: "+e.message;$("homeSearchLocation").disabled=false;return;}}
 $("homeSearchLocation").disabled=false;const lat=num(item.lat),lon=num(item.lon);if(lat==null||lon==null)return;
 const bounds=parseBounds(item.boundingbox);updateLocation(lat,lon,item.display_name||q,bounds);if($("homeCoverage").value==="area"&&!bounds){$("homeLocationStatus").textContent="Batas wilayah tidak tersedia. Coba cari nama kota/kabupaten yang lebih luas.";return;}await searchNearby();}
function detectLocation(automatic){if(!navigator.geolocation){$("homeLocationStatus").textContent="Browser tidak mendukung lokasi. Cari lokasi secara manual.";return;}
 $("homeDetectLocation").disabled=true;$("homeDetectLocation").textContent="Meminta izin lokasi…";
 navigator.geolocation.getCurrentPosition(async p=>{$("homeDetectLocation").disabled=false;$("homeDetectLocation").textContent="◎ Deteksi lokasi saya";updateLocation(p.coords.latitude,p.coords.longitude,"Lokasi perangkat ("+p.coords.latitude.toFixed(3)+", "+p.coords.longitude.toFixed(3)+")");await searchNearby();},
 e=>{$("homeDetectLocation").disabled=false;$("homeDetectLocation").textContent="◎ Deteksi lokasi saya";const msg=e.code===1?"izin lokasi belum diberikan":e.code===2?"posisi tidak tersedia":"permintaan lokasi terlalu lama";$("homeLocationStatus").textContent=automatic?"Lokasi otomatis tidak tersedia ("+msg+"). Cari lokasi pilihan atau tekan Deteksi lokasi saya.":"Lokasi tidak dapat diakses ("+msg+"). Cari lokasi secara manual.";},
 {enableHighAccuracy:false,timeout:12000,maximumAge:300000});}
async function init(){try{const r=await fetch(CATALOG_URL,{cache:"no-store"});if(!r.ok)throw new Error("HTTP "+r.status);const j=await r.json();catalog=Array.isArray(j.opportunities)?j.opportunities:[];}
 catch(e){$("homeRecommendations").innerHTML='<div class="empty">Katalog ide belum bisa dimuat; coba muat ulang.</div>';return;}
 catalog=catalog.map(o=>({...o,business_type:o.business_type||(o.id==="local-aggregation"||o.id==="textile-craft-micro"?"service":"sell")}));
 initMap();renderRecommendations();
 $("homeSearchLocation").addEventListener("click",searchLocation);
 $("homeLocationQuery").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();searchLocation();}});
 $("homeDetectLocation").addEventListener("click",()=>detectLocation(false));
 $("homeRadius").addEventListener("change",()=>{if(coords&&$("homeCoverage").value==="nearby")searchNearby();});
 $("homeCoverage").addEventListener("change",()=>{if(coords)searchNearby();});
 $("homeTypeFilter").addEventListener("change",()=>{activeIdea=null;renderRecommendations();drawPoints();});
 detectLocation(true);}
init();
})();