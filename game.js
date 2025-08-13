/* Diplomat’s Club — NYT-ish UI, SVG heads that “flip-talk”, mini maps, sirignanos, H2H scaffold */

/* ========= Configure this after you deploy your Lambda =========
   Your Lambda is expected to return either:
   (A) Simple mode (no positions):
       { A:{origin,dest,etaMinutes,callsign}, B:{...} }
   (B) Map mode (recommended):
       { A:{origin,dest,etaMinutes,callsign,pos:{lat,lon}},
         B:{...}, destPos:{lat,lon} }
=================================================================*/
const LIVE_PROXY = "YOUR_API_GATEWAY_URL";

/* ========= (Optional) Multiplayer via Firebase ================
   To enable, paste your Firebase config in FIREBASE_CONFIG.
   Then create a room with “New Match” (we expose create/join helpers),
   and share the URL with ?room=ROOMID
=================================================================*/
const FIREBASE_CONFIG = null; // { apiKey: "...", authDomain:"...", projectId:"...", ... }

/* ---------------- Core Config ---------------- */
const START_YOU = 500;
const START_TEXAN = 2000;
const ROUND_MS = 6500;
const MIN_BET = 25;

/* Airport coordinates (fallback for maps when Lambda doesn’t provide pos) */
const AIRPORTS = {
  JFK:[40.6413,-73.7781], EWR:[40.6895,-74.1745], LGA:[40.7769,-73.8740],
  YYZ:[43.6777,-79.6248], YUL:[45.4706,-73.7408], YVR:[49.1951,-123.1779],
  BOS:[42.3656,-71.0096], PHL:[39.8729,-75.2437], PIT:[40.4915,-80.2329],
  BWI:[39.1774,-76.6684], DCA:[38.8521,-77.0377], IAD:[38.9531,-77.4565],
  ATL:[33.6407,-84.4277], MIA:[25.7959,-80.2870], FLL:[26.0726,-80.1527],
  ORD:[41.9742,-87.9073], MDW:[41.7868,-87.7522], DTW:[42.2124,-83.3534],
  CLT:[35.2144,-80.9473], RDU:[35.8801,-78.7880], BNA:[36.1263,-86.6774],
  DFW:[32.8998,-97.0403], DAL:[32.8471,-96.8517], IAH:[29.9902,-95.3368], HOU:[29.6454,-95.2789],
  DEN:[39.8561,-104.6737], SLC:[40.7899,-111.9791], LAS:[36.0840,-115.1537],
  LAX:[33.9416,-118.4085], SFO:[37.6213,-122.3790], OAK:[37.7126,-122.2197],
  SEA:[47.4502,-122.3088], SAN:[32.7338,-117.1933], PHX:[33.4342,-112.0116],
  MSP:[44.8848,-93.2223], STL:[38.7487,-90.3700], CMH:[39.9980,-82.8919], CLE:[41.4117,-81.8494], MCI:[39.2976,-94.7139]
};

/* --------------- State --------------- */
const S = {
  you: START_YOU, opp: START_TEXAN,
  bet: 50, airport: "JFK",
  dealt: null, racing: false, chosen: null, live:false,
  maps: { A:null, B:null }
};

/* --------------- DOM --------------- */
const $ = s => document.querySelector(s);
const youCash=$("#youCash"), oppCash=$("#oppCash"), log=$("#log");
const lineA=$("#lineA"), lineB=$("#lineB"), etaA=$("#etaA"), etaB=$("#etaB");
const barA=$("#barA"), barB=$("#barB");
const dealBtn=$("#deal"), resetBtn=$("#reset"), airport=$("#airport"), betIn=$("#betIn");
const cardA=$("#A"), cardB=$("#B"), liveToggle=$("#liveToggle");
const charK=$("#charK"), charT=$("#charT"); const bubbleK=$("#bubbleK"), bubbleT=$("#bubbleT");
const mapA=$("#mapA"), mapB=$("#mapB");

/* --------------- Utils --------------- */
const fmtSirig = n => `${n.toLocaleString()} sirignanos`;
const clamp = (v,lo,hi)=> Math.max(lo, Math.min(hi, v));
const setLog = t => log.textContent = t;

/* Head flip / reactions */
function flipTalk(on=true){
  [charK, charT].forEach(el=> el.classList.toggle("talk", on));
  if(on) setTimeout(()=>flipTalk(false), 900);
}
function leanOn(){ charK.classList.add("lean"); charT.classList.add("lean"); }
function leanOff(){ charK.classList.remove("lean"); charT.classList.remove("lean"); }
function pump(el){ el.classList.add("pump"); setTimeout(()=>el.classList.remove("pump"), 1100); }
function slump(el){ el.classList.add("slump"); setTimeout(()=>el.classList.remove("slump"), 900); }
function speak(el, text, ms=1500){
  el.textContent = text; el.classList.add("show");
  const id = setTimeout(()=>el.classList.remove("show"), ms);
  return ()=>clearTimeout(id);
}

function updateHUD(){
  youCash.textContent = fmtSirig(S.you);
  oppCash.textContent = fmtSirig(S.opp);
  betIn.value = S.bet;
  airport.value = S.airport;
  dealBtn.disabled = (S.you<=0 || S.opp<=0);
}

/* --------------- Mapping helpers --------------- */
function ensureMap(which){
  if(S.maps[which]) return S.maps[which];
  const el = which==='A' ? mapA : mapB;
  const m = L.map(el, { zoomControl:false, attributionControl:false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 15 }).addTo(m);
  const plane = L.circleMarker([0,0], { radius:6, color:'#0077ff', fillColor:'#3ab8ff', fillOpacity:.9 }).addTo(m);
  const dest = L.circleMarker([0,0], { radius:5, color:'#111827', fillColor:'#111827', fillOpacity:1 }).addTo(m);
  const line = L.polyline([], { color:'#0ea5e9', weight:3, opacity:.9 }).addTo(m);
  const group = L.featureGroup([plane, dest, line]).addTo(m);
  S.maps[which] = { map:m, plane, dest, line, group };
  return S.maps[which];
}

function fitAndRender(which, flight, destPos){
  const m = ensureMap(which);
  const pos = flight.pos ? [flight.pos.lat, flight.pos.lon] : guessPos(flight);
  const dst = destPos || AIRPORTS[flight.dest] || AIRPORTS[S.airport] || [40.6413,-73.7781];
  m.plane.setLatLng(pos); m.dest.setLatLng(dst);
  m.line.setLatLngs([pos, dst]);
  const bounds = L.latLngBounds([pos, dst]).pad(0.35);
  m.map.fitBounds(bounds, { animate:false });
  const distKm = L.latLng(pos[0],pos[1]).distanceTo(L.latLng(dst[0],dst[1]))/1000;
  return Math.max(1, Math.round(distKm));
}

function guessPos(f){
  // Roughly place the plane on a segment towards the dest based on ETA.
  const o = AIRPORTS[f.origin], d = AIRPORTS[f.dest];
  if(!o || !d) return AIRPORTS[S.airport] || [40.6413,-73.7781];
  // fraction from origin to dest (~closer when ETA small)
  const frac = Math.max(.1, Math.min(.9, 1 - (f.etaMinutes/60)));
  const lat = o[0] + (d[0]-o[0]) * frac;
  const lon = o[1] + (d[1]-o[1]) * frac;
  return [lat, lon];
}

/* --------------- Flight sources --------------- */
function simFlights(iata){
  const cities=Object.keys(AIRPORTS);
  const r=(a,b)=>Math.floor(Math.random()*(b-a+1))+a;
  const p=()=>{ const origin=cities[r(0,cities.length-1)];
    return {origin, dest:iata, etaMinutes:r(3,14), callsign:`${iata}${r(100,999)}`};
  };
  let A=p(),B=p(); if(B.origin===A.origin) B.origin=cities[(cities.indexOf(A.origin)+3)%cities.length];
  return {A,B, destPos: { lat:(AIRPORTS[iata]||[40.64,-73.77])[0], lon:(AIRPORTS[iata]||[40.64,-73.77])[1] } };
}
async function liveFlights(iata){
  if(!LIVE_PROXY || LIVE_PROXY.includes("YOUR_API_GATEWAY_URL")) throw new Error("Live proxy not configured");
  const url = `${LIVE_PROXY}?airport=${encodeURIComponent(iata)}`;
  const r = await fetch(url, {cache:"no-store"});
  if(!r.ok) throw new Error("proxy failed");
  return await r.json();
}

/* --------------- Round flow --------------- */
async function deal(){
  if(S.racing) return;
  S.airport = (airport.value||"JFK").toUpperCase();
  [lineA,lineB].forEach(el=>el.textContent="Dealing…"); [etaA,etaB].forEach(el=>el.textContent="");
  barA.style.width="0%"; barB.style.width="0%";
  setLog(S.live? "Pulling two inbound real flights…" : "Drawing two simulated inbound flights…");
  let data;
  try{ data = S.live ? await liveFlights(S.airport) : simFlights(S.airport); }
  catch(e){ console.warn(e); data = simFlights(S.airport); setLog("Live unavailable—using simulated flights this round."); }

  // Normalize expected shape
  const destPos = data.destPos || (AIRPORTS[S.airport] ? {lat:AIRPORTS[S.airport][0], lon:AIRPORTS[S.airport][1]} : null);
  S.dealt = { A:data.A, B:data.B, destPos };

  // UI
  const {A,B} = S.dealt;
  lineA.textContent = `A — ${A.origin} → ${A.dest} (${A.callsign})`;
  lineB.textContent = `B — ${B.origin} → ${B.dest} (${B.callsign})`;
  etaA.textContent = `ETA ~ ${A.etaMinutes} min`; etaB.textContent = `ETA ~ ${B.etaMinutes} min`;

  // Little talk flip + speech
  flipTalk(true);
  speak(bubbleK, "New action!");
  speak(bubbleT, "Name your flight!");

  // Render maps
  const distA = fitAndRender('A', A, destPos);
  const distB = fitAndRender('B', B, destPos);
  etaA.textContent += ` — ~${distA} km`;
  etaB.textContent += ` — ~${distB} km`;

  setLog("Click A or B to place your bet (winner takes all, sirignanos).");
  updateHUD();
}

function start(choice){
  if(!S.dealt||S.racing) return;
  S.bet = clamp(Number(betIn.value||MIN_BET), MIN_BET, Math.min(S.you,S.opp));
  S.chosen = choice; S.racing = true;
  setLog(`You bet ${fmtSirig(S.bet)} on Flight ${choice}.`);
  leanOn();

  const {A,B} = S.dealt, a=A.etaMinutes, b=B.etaMinutes, total=ROUND_MS;
  const t0 = performance.now();
  const Ams = total * (a/(a+b)), Bms = total * (b/(a+b));

  function step(now){
    const t = now - t0;
    barA.style.width = Math.min(100, (t/Ams)*100).toFixed(1)+"%";
    barB.style.width = Math.min(100, (t/Bms)*100).toFixed(1)+"%";
    if(t<Ams || t<Bms) requestAnimationFrame(step); else resolve();
  }
  requestAnimationFrame(step);
}

function resolve(){
  const {A,B}=S.dealt;
  const winner = (A.etaMinutes===B.etaMinutes) ? (Math.random()<.5?'A':'B') : (A.etaMinutes<B.etaMinutes?'A':'B');
  const youWon = (S.chosen===winner);
  leanOff();

  if(youWon){
    S.you+=S.bet; S.opp-=S.bet;
    setLog(`WIN! Flight ${winner} first — ${fmtSirig(S.bet)} to you.`);
    pump(charK); slump(charT);
    speak(bubbleK, "YES!", 900); speak(bubbleT, "Dang.", 900);
  }else{
    S.you-=S.bet; S.opp+=S.bet;
    setLog(`Lost. Flight ${winner} beat your pick — ${fmtSirig(S.bet)} to the Cajun.`);
    pump(charT); slump(charK);
    speak(bubbleT, "HA!", 900); speak(bubbleK, "Nooo!", 900);
  }
  S.bet = clamp(S.bet, MIN_BET, Math.min(S.you,S.opp));
  S.racing=false; updateHUD();

  if(S.you<=0){ setLog("Busted! Refresh to try again."); }
  if(S.opp<=0){ setLog("You cleaned him out! The Cajun tips his hat."); }
}

/* --------------- (Optional) Online H2H scaffold --------------- */
/* If you paste FIREBASE_CONFIG, you can wire createRoom/joinRoom to buttons.
   For now we expose placeholders so the UI stays simple. */
async function initRealtime(){ if(!FIREBASE_CONFIG) return null; /* add Firebase SDK here if you want */ return null; }

/* --------------- Events --------------- */
$("#A").addEventListener("click", ()=> start('A'));
$("#B").addEventListener("click", ()=> start('B'));
dealBtn.addEventListener("click", deal);
resetBtn.addEventListener("click", ()=>{ Object.assign(S,{you:START_YOU,opp:START_TEXAN,bet:50}); updateHUD(); setLog("Bank reset."); });
airport.addEventListener("change", ()=> S.airport=airport.value.toUpperCase());
betIn.addEventListener("change", ()=> S.bet=clamp(Number(betIn.value||MIN_BET),MIN_BET,Math.min(S.you,S.opp)));
liveToggle.addEventListener("change", e=>{ S.live=e.target.checked; setLog(S.live?"LIVE mode ON (via Lambda)":"Simulated mode"); });

/* --------------- Init --------------- */
updateHUD();
setLog("Welcome to the Diplomat’s Club. Deal flights to start.");
