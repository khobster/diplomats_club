/* Diplomat’s Lounge — minimal UI + controllable faces + Lambda live flights + 2-player rooms */

/* ========= Lambda Gateway URL =========
   Your function should accept:  GET ?airport=IATA
   Return either:
   { A:{origin,dest,etaMinutes,callsign}, B:{...} }
   or (recommended)
   { A:{...pos:{lat,lng}}, B:{...pos:{lat,lng}}, destPos:{lat,lng} }
======================================= */
const LIVE_PROXY = "https://qw5l10c7a4.execute-api.us-east-1.amazonaws.com/flights";

/* =================== Multiplayer (Firestore) =================== */
let db = null, roomId = null, seat = "Solo";   // "K" | "C" | "Solo"
let roomRef = null, unsubRoom = null;

/* DOM helpers */
function byId(id){ return document.getElementById(id); }
const setLog = (t)=> byId("log").textContent = t;
function toast(t){ setLog(t); }

/* Buttons / header */
const seatPill = byId("seatPill"), seatName = byId("seatName");
const newRoomBtn = byId("newRoom"), copyBtn = byId("copyLink");

/* Helpers */
function randomCode(n=6){ const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from({length:n},()=>a[Math.floor(Math.random()*a.length)]).join(''); }
function currentUrlWithRoom(id){ const u=new URL(location.href); u.searchParams.set("room", id); return u.toString(); }
function setSeatLabel(s){ seatName.textContent = s==="K"?"Kessler":(s==="C"?"Cajun":"Solo"); }

/* -------- Firebase init (force long-poll + smoke test) -------- */
(function initFirebase(){
  try{
    const cfg = window.FIREBASE_CONFIG;
    if (!cfg || !cfg.projectId){
      console.warn("[DL] No FIREBASE_CONFIG; rooms disabled.");
      return;
    }
    if (!firebase.apps.length) firebase.initializeApp(cfg); // compat init

    // Force long-polling to avoid 400 Write/channel issues (ad blockers/VPN)
    const dbTmp = firebase.firestore();
    try {
      dbTmp.settings({ experimentalForceLongPolling: true, useFetchStreams: false });
      try { firebase.firestore.setLogLevel('error'); } catch {}
    } catch(e) {
      console.warn("[DL] db.settings warn (ok on some SDKs):", e);
    }
    db = dbTmp;
    console.log("[DL] Firebase connected:", firebase.app().options.projectId);

    // Smoke test write so button can warn immediately if blocked
    db.collection("_probe").doc("w").set({t: Date.now()})
      .then(()=>console.log("[DL] Firestore write probe: OK"))
      .catch(e=>{
        console.error("[DL] Firestore write probe FAILED", e);
        alert(
          "Firestore connection is being blocked (400 Write/channel).\n\n" +
          "Quick fixes:\n" +
          "1) Serve the site via http://localhost (not file://)\n" +
          "   e.g., `npx http-server -p 5500`\n" +
          "2) Disable ad-block/VPN for *.googleapis.com\n" +
          "3) Try a fresh Chrome profile or Incognito (no extensions)"
        );
      });
  }catch(e){
    console.error("[DL] Firebase init error:", e);
    db = null;
  }
})();

/* Room doc shape:
   rooms/{roomId} = {
     createdAt, seats:{K:"", C:""}, bank:{K:500,C:2000},
     airport:"JFK", bet:50, live:false, dealt:null, destPos:null,
     racing:false, turn:"K", chosen:null, roundSeed:null, lastWinner:null
   }
*/
async function ensureRoom(){
  if(!db) return null;
  const url = new URL(location.href);
  roomId = url.searchParams.get("room");
  if(!roomId) return null;

  roomRef = db.collection("rooms").doc(roomId);

  // Create if missing
  let snap = null;
  try { snap = await roomRef.get(); }
  catch(e){ console.error("room get failed:", e); }
  if(!snap || !snap.exists){
    try{
      await roomRef.set({
        createdAt: Date.now(),
        seats: {K:"", C:""},
        bank: {K:500, C:2000},
        airport:"JFK", bet:50, live:false,
        dealt:null, destPos:null,
        racing:false, turn:"K", chosen:null, roundSeed:null, lastWinner:null
      });
    }catch(e){ console.error("room create failed:", e); toast("Room create failed — check Firestore rules/network."); return null; }
  }

  // Claim a seat atomically
  const myId = "anon-"+Math.random().toString(36).slice(2,8);
  try{
    const claim = await db.runTransaction(async (tx)=>{
      const dSnap = await tx.get(roomRef); const d = dSnap.data()||{};
      let pick = (d.seats?.K) ? ((d.seats?.C) ? "Solo" : "C") : "K";
      if(pick !== "Solo"){
        const seats = {...(d.seats||{})}; seats[pick] = myId;
        tx.update(roomRef, {seats});
      }
      return pick;
    });
    seat = claim;
    setSeatLabel(seat);
    seatPill.title = roomId;
  }catch(e){
    console.error("seat claim failed:", e); toast("Seat claim failed — network?");
  }

  // Subscribe live
  if (unsubRoom) unsubRoom();
  unsubRoom = roomRef.onSnapshot((doc)=>{
    const D = doc.data(); if(!D) return;
    // Merge remote -> local
    S.bank = {...D.bank};
    S.airport = D.airport; S.bet = D.bet; S.live = D.live;
    S.dealt = D.dealt ? {...D.dealt} : null;
    S.destPos = D.destPos || null;
    S.racing = D.racing; S.turn = D.turn; S.chosen = D.chosen;
    S.roundSeed = D.roundSeed; S.lastWinner = D.lastWinner;
    updateHUD();
    if(S.dealt){ renderDealt(); }
    setLog(S.racing ? "Round in progress…" : (S.dealt ? "Pick A or B." : "Deal flights to start."));
  }, (err)=>{
    console.error("[DL] room snapshot error:", err);
    toast("Room listener error. Try reloading.");
  });

  return roomRef;
}

async function createRoom(){
  if(!db){ alert("Rooms need Firebase config. (Check window.FIREBASE_CONFIG.)"); return; }
  try{
    const id = randomCode(6);
    await db.collection("rooms").doc(id).set({
      createdAt: Date.now(),
      seats: {K:"", C:""},
      bank: {K:500, C:2000},
      airport:"JFK", bet:50, live:false,
      dealt:null, destPos:null,
      racing:false, turn:"K", chosen:null, roundSeed:null, lastWinner:null
    });
    history.replaceState(null, "", currentUrlWithRoom(id));
    toast("Room created: "+id);
    await ensureRoom();
  }catch(e){
    console.error("[DL] createRoom error:", e);
    alert("Couldn’t create the room — likely the Firestore stream is blocked.\nSee console for details and try the long-poll reset / ad-block tips.");
  }
}

async function copyInvite(){
  if(!roomId){ await createRoom(); }
  if(!roomId) return;
  const u = currentUrlWithRoom(roomId);
  try{ await navigator.clipboard.writeText(u); toast("Invite link copied"); }
  catch(e){ console.error("[DL] clipboard error:", e); prompt("Copy this link:", u); }
}

/* =================== UI/DOM refs =================== */
const lineA = byId("lineA"), lineB = byId("lineB"), etaA = byId("etaA"), etaB = byId("etaB");
const barA = byId("barA"), barB = byId("barB");
const mapA = byId("mapA"), mapB = byId("mapB");
const dealBtn = byId("deal"), resetBtn = byId("reset"), airportIn = byId("airport"), betIn = byId("betIn"), liveToggle = byId("liveToggle");
const bankK = byId("bankK"), bankC = byId("bankC");
const bubK = byId("bubK"), bubC = byId("bubC");

/* ===== Sofa face nodes ===== */
const K_eyeL = byId("K_eyeL"), K_eyeR = byId("K_eyeR"), K_mouth = byId("K_mouth");
const C_eyeL = byId("C_eyeL"), C_eyeR = byId("C_eyeR"), C_mouth = byId("C_mouth");

/* ===== Face default positions (safe starting point; overridden by localStorage) ===== */
const FACE_DEFAULT = { K:{x:388, y:258}, C:{x:862, y:272} };

/* =================== Core Config =================== */
const ROUND_MS = 6500, MIN_BET = 25;
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

/* =================== State =================== */
const S = {
  bank: {K:500, C:2000},
  airport: "JFK",
  bet: 50, live:false,
  dealt: null, destPos:null,
  maps: {A:null, B:null},
  racing:false, chosen:null, roundSeed:null, lastWinner:null,
  turn:"K"
};

/* =================== Utilities =================== */
const fmtSirig = (n)=>`${n.toLocaleString()} sirignanos`;
const clamp = (v,lo,hi)=> Math.max(lo, Math.min(hi, v));

/* =================== FACES ENGINE =================== */
function setFaceTransform(id, x, y){
  const g = document.getElementById(id);
  if(g) g.setAttribute('transform', `translate(${Math.round(x)}, ${Math.round(y)})`);
}
function applySavedFacePos(){
  ['K','C'].forEach(id=>{
    const s = localStorage.getItem('facePos_'+id);
    if(s){
      try{ const {x,y}=JSON.parse(s); setFaceTransform(id,x,y); }
      catch(_e){ /* ignore */ }
    }else{
      setFaceTransform(id, FACE_DEFAULT[id].x, FACE_DEFAULT[id].y);
    }
  });
}
function showBubble(which, text, ms=1400){
  const el = which==="K" ? bubK : bubC;
  el.textContent = text; el.classList.add("show");
  setTimeout(()=>el.classList.remove("show"), ms);
}
/* Blink loop */
function startBlinking(){
  const pairs = [[K_eyeL, K_eyeR],[C_eyeL, C_eyeR]];
  pairs.forEach(([l,r])=>{
    (function loop(){
      const delay = 1200 + Math.random()*2200;
      setTimeout(()=>{
        l.classList.add("blink"); r.classList.add("blink");
        setTimeout(()=>{ l.classList.remove("blink"); r.classList.remove("blink"); loop(); }, 120);
      }, delay);
    })();
  });
}
/* Look */
function eyes(which, dir="center"){
  const dx = dir==="left"? -6 : dir==="right" ? 6 : 0;
  const [L,R] = which==="K" ? [K_eyeL, K_eyeR] : [C_eyeL, C_eyeR];
  [L,R].forEach(e=> e.style.transform = `translate(${dx}px,0)`);
}
/* Talking on/off */
function talk(which, on=true){
  const M = which==="K" ? K_mouth : C_mouth;
  M.classList.toggle("talk", on);
}
/* Mouth shapes */
function setMouthShape(which, shape="flat"){
  const g = (which==="K") ? byId("K") : byId("C");
  const old = byId(which+"_mouth");
  if(!old) return;
  g.removeChild(old);
  if(shape==="flat"){
    const r = document.createElementNS("http://www.w3.org/2000/svg","rect");
    r.setAttribute("id", which+"_mouth");
    r.setAttribute("class","mouth");
    r.setAttribute("x","-22"); r.setAttribute("y","38");
    r.setAttribute("width","44"); r.setAttribute("height","14");
    r.setAttribute("rx","7"); r.setAttribute("fill","#1b2230");
    g.appendChild(r);
  }else{
    const p = document.createElementNS("http://www.w3.org/2000/svg","path");
    p.setAttribute("id", which+"_mouth");
    p.setAttribute("fill","none"); p.setAttribute("stroke","#1b2230"); p.setAttribute("stroke-width","10"); p.setAttribute("stroke-linecap","round");
    if(shape==="smile") p.setAttribute("d","M -26 44 Q 0 68 26 44");
    if(shape==="frown") p.setAttribute("d","M -26 64 Q 0 38 26 64");
    g.appendChild(p);
  }
  if(which==="K") window.K_mouth = byId("K_mouth"); else window.C_mouth = byId("C_mouth");
}
function reactWin(who){ setMouthShape(who,"smile"); talk(who,true); setTimeout(()=>{ talk(who,false); setMouthShape(who,"flat"); }, 1200); }
function reactLose(who){ setMouthShape(who,"frown"); talk(who,true); setTimeout(()=>{ talk(who,false); setMouthShape(who,"flat"); }, 1200); }

/* ===== Face calibration (Shift+D to toggle) ===== */
function enableFaceCal(){
  const svg = document.querySelector('.faces');
  if(!svg || svg.dataset.calOn==='1') return;
  svg.dataset.calOn = '1';
  const prevPE = svg.style.pointerEvents;
  svg.style.pointerEvents = 'auto';
  svg.style.outline = '2px dashed rgba(0,0,0,.15)';
  toast('Calibration ON — 1=Kessler, 2=Cajun, drag or arrows (Shift=5px). S=save, Esc=exit.');

  let selected = byId('K'); // default select K
  let drag=null, start=null, orig=null;

  function xyOf(g){
    const m=/translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(g.getAttribute('transform')||'translate(0,0)');
    return {x:parseFloat(m?.[1]||0), y:parseFloat(m?.[2]||0)};
  }
  function set(g,x,y){ g.setAttribute('transform', `translate(${Math.round(x)}, ${Math.round(y)})`); }

  function onDown(e){
    const g = e.target.closest('g#K, g#C'); if(!g) return;
    selected=g; drag=g; start={x:e.clientX,y:e.clientY}; orig=xyOf(g);
    svg.setPointerCapture(e.pointerId);
  }
  function onMove(e){
    if(!drag) return;
    const dx=e.clientX-start.x, dy=e.clientY-start.y;
    set(drag, orig.x+dx, orig.y+dy);
  }
  function onUp(e){
    if(!drag) return;
    save(drag); drag=null; svg.releasePointerCapture(e.pointerId);
  }
  function save(g){
    const {x,y}=xyOf(g);
    localStorage.setItem('facePos_'+g.id, JSON.stringify({x,y}));
    console.log(`Saved ${g.id}: translate(${x}, ${y})`);
  }
  function select(id){ const g=byId(id); if(g) selected=g; }

  function onKey(e){
    if(e.key==='Escape'){ exit(); return; }
    if(e.key==='1'){ select('K'); return; }
    if(e.key==='2'){ select('C'); return; }
    if(e.key.toLowerCase()==='s'){ if(selected) save(selected); return; }

    const step = e.shiftKey?5:1;
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
      const {x,y}=xyOf(selected);
      let nx=x, ny=y;
      if(e.key==='ArrowLeft') nx-=step;
      if(e.key==='ArrowRight') nx+=step;
      if(e.key==='ArrowUp') ny-=step;
      if(e.key==='ArrowDown') ny+=step;
      set(selected, nx, ny);
      e.preventDefault();
    }
  }

  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  document.addEventListener('keydown', onKey);

  function exit(){
    svg.removeEventListener('pointerdown', onDown);
    svg.removeEventListener('pointermove', onMove);
    svg.removeEventListener('pointerup', onUp);
    document.removeEventListener('keydown', onKey);
    svg.style.pointerEvents = prevPE;
    svg.style.outline = 'none';
    delete svg.dataset.calOn;
    toast('Calibration OFF.');
  }
}
document.addEventListener('keydown', e=>{
  if(e.shiftKey && e.key.toLowerCase()==='d') enableFaceCal();
});

/* =================== Maps =================== */
function ensureMap(which){
  if(S.maps[which]) return S.maps[which];
  const el = which==='A' ? mapA : mapB;
  const m = L.map(el, { zoomControl:false, attributionControl:false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 15 }).addTo(m);
  const plane = L.circleMarker([0,0], { radius:6, color:'#0077ff', fillColor:'#3ab8ff', fillOpacity:.9 }).addTo(m);
  const dest  = L.circleMarker([0,0], { radius:5, color:'#111827', fillColor:'#111827', fillOpacity:1 }).addTo(m);
  const line  = L.polyline([], { color:'#0ea5e9', weight:3, opacity:.9 }).addTo(m);
  const group = L.featureGroup([plane, dest, line]).addTo(m);
  S.maps[which] = { map:m, plane, dest, line, group };
  return S.maps[which];
}
function toLatLng(p){
  if(!p) return null;
  if(Array.isArray(p)) return [p[0], p[1]];
  if(typeof p === 'object' && 'lat' in p && ('lng' in p || 'lon' in p)){
    return [p.lat, ('lng' in p) ? p.lng : p.lon];
  }
  return null;
}
function fitAndRender(which, flight, destPos){
  const M = ensureMap(which);
  const pos = flight.pos ? toLatLng(flight.pos) : guessPos(flight);
  const dst = toLatLng(destPos) || (AIRPORTS[flight.dest] ? {lat:AIRPORTS[flight.dest][0], lng:AIRPORTS[flight.dest][1]} : null) ||
              (AIRPORTS[S.airport] ? {lat:AIRPORTS[S.airport][0], lng:AIRPORTS[S.airport][1]} : {lat:40.6413, lng:-73.7781});
  M.plane.setLatLng(pos);
  M.dest.setLatLng([dst.lat,dst.lng]);
  M.line.setLatLngs([pos, [dst.lat,dst.lng]]);
  const bounds = L.latLngBounds([pos, [dst.lat,dst.lng]]).pad(0.35);
  M.map.fitBounds(bounds, { animate:false });
  const distKm = L.latLng(pos[0],pos[1]).distanceTo(L.latLng(dst.lat,dst.lng))/1000;
  return Math.max(1, Math.round(distKm));
}
function guessPos(f){
  const o = AIRPORTS[f.origin], d = AIRPORTS[f.dest];
  if(!o || !d) return AIRPORTS[S.airport] || [40.6413,-73.7781];
  const frac = Math.max(.1, Math.min(.9, 1 - (f.etaMinutes/60)));
  const lat = o[0] + (d[0]-o[0]) * frac;
  const lng = o[1] + (d[1]-o[1]) * frac;
  return [lat, lng];
}

/* =================== Flight sources =================== */
function simFlights(iata){
  const cities=Object.keys(AIRPORTS);
  const r=(a,b)=>Math.floor(Math.random()*(b-a+1))+a;
  const p=()=>{ const origin=cities[r(0,cities.length-1)];
    return {origin, dest:iata, etaMinutes:r(3,14), callsign:`${iata}${r(100,999)}`};
  };
  let A=p(),B=p(); if(B.origin===A.origin) B.origin=cities[(cities.indexOf(A.origin)+3)%cities.length];
  const dp = AIRPORTS[iata] ? {lat:AIRPORTS[iata][0], lng:AIRPORTS[iata][1]} : null;
  return {A,B,destPos:dp};
}
async function liveFlights(iata){
  if(!LIVE_PROXY || LIVE_PROXY.includes("YOUR_API_GATEWAY_URL")) throw new Error("Live proxy not configured");
  const url = `${LIVE_PROXY}?airport=${encodeURIComponent(iata)}`;
  const r = await fetch(url, {cache:"no-store"});
  if(!r.ok) throw new Error("proxy failed");
  return await r.json();
}

/* =================== HUD / Update =================== */
function updateHUD(){
  bankK.textContent = fmtSirig(S.bank.K);
  bankC.textContent = fmtSirig(S.bank.C);
  betIn.value = S.bet;
  airportIn.value = S.airport;
  liveToggle.checked = S.live;
  dealBtn.disabled = !!(S.racing) || (seat!=="K" && seat!=="C");
}
function renderDealt(){
  const {A,B} = S.dealt;
  lineA.textContent = `A — ${A.origin} → ${A.dest} (${A.callsign})`;
  lineB.textContent = `B — ${B.origin} → ${B.dest} (${B.callsign})`;
  etaA.textContent = `ETA ~ ${A.etaMinutes} min`;
  etaB.textContent = `ETA ~ ${B.etaMinutes} min`;
  const da = fitAndRender('A', A, S.destPos);
  const db = fitAndRender('B', B, S.destPos);
  etaA.textContent += ` — ~${da} km`;
  etaB.textContent += ` — ~${db} km`;
}

/* =================== Round flow =================== */
async function deal(){
  if(S.racing) return;
  S.airport = (airportIn.value||"JFK").toUpperCase();
  barA.style.width="0%"; barB.style.width="0%";
  lineA.textContent="Dealing…"; lineB.textContent="Dealing…"; etaA.textContent=""; etaB.textContent="";

  showBubble("K","New action!"); showBubble("C","Name your flight!");
  talk("K",true); talk("C",true); setTimeout(()=>{talk("K",false); talk("C",false);}, 900);

  setLog(S.live? "Pulling two inbound real flights…" : "Drawing two simulated inbound flights…");
  let data;
  try{ data = S.live ? await liveFlights(S.airport) : simFlights(S.airport); }
  catch(e){ console.warn(e); data = simFlights(S.airport); setLog("Live unavailable—using simulated flights this round."); }

  const destPos = data.destPos || (AIRPORTS[S.airport] ? {lat:AIRPORTS[S.airport][0], lng:AIRPORTS[S.airport][1]} : null);
  S.dealt = { A:data.A, B:data.B }; S.destPos = destPos;
  S.racing=false; S.chosen=null; S.roundSeed = Math.floor(Math.random()*1e9);

  renderDealt();
  setLog("Click A or B to place your bet (winner takes all).");

  if(roomRef){
    await roomRef.update({
      airport:S.airport, bet:S.bet, live:S.live,
      dealt:S.dealt, destPos:S.destPos,
      racing:false, chosen:null, roundSeed:S.roundSeed, lastWinner:null
    }).catch(e=>console.warn("[DL] room update(deal) failed:", e));
  }
}

function start(choice){
  if(!S.dealt || S.racing) return;
  if(seat!=="K" && seat!=="C"){ showBubble("K","Join a seat to play!"); return; }
  if(S.turn!==seat){ showBubble(seat,"Hold—other turn"); return; }

  S.bet = clamp(Number(betIn.value||MIN_BET), MIN_BET, Math.min(S.bank.K, S.bank.C));
  S.chosen = choice; S.racing = true;

  setLog(`${seat==="K"?"Kessler":"Cajun"} bets ${fmtSirig(S.bet)} on Flight ${choice}.`);
  eyes(seat, "right"); setTimeout(()=>eyes(seat, "center"), 600);

  const {A,B} = S.dealt, a=A.etaMinutes, b=B.etaMinutes, total=ROUND_MS;
  const Ams = total * (a/(a+b)), Bms = total * (b/(a+b));
  const t0 = performance.now();
  (function step(now){
    const t = now - t0;
    barA.style.width = Math.min(100, (t/Ams)*100).toFixed(1)+"%";
    barB.style.width = Math.min(100, (t/Bms)*100).toFixed(1)+"%";
    if(t<Ams || t<Bms) requestAnimationFrame(step); else resolve();
  })(performance.now());
}

function resolve(){
  const {A,B}=S.dealt;
  const tie = (A.etaMinutes===B.etaMinutes);
  const winner = tie ? (S.roundSeed % 2 ? 'A' : 'B') : (A.etaMinutes<B.etaMinutes?'A':'B');

  const youPicked = S.chosen;
  const youWon = (youPicked===winner);

  const me = seat;
  const opp = seat==="K" ? "C" : "K";

  if(youWon){
    S.bank[me]+=S.bet; S.bank[opp]-=S.bet;
    setLog(`WIN! Flight ${winner} first — ${fmtSirig(S.bet)} to ${me==="K"?"Kessler":"Cajun"}.`);
    reactWin(me); reactLose(opp); showBubble(me,"YES!", 900);
  }else{
    S.bank[me]-=S.bet; S.bank[opp]+=S.bet;
    setLog(`Lost. Flight ${winner} beat your pick — ${fmtSirig(S.bet)} to ${opp==="K"?"Kessler":"Cajun"}.`);
    reactWin(opp); reactLose(me); showBubble(opp,"Ha!", 900);
  }

  bankK.textContent = fmtSirig(S.bank.K);
  bankC.textContent = fmtSirig(S.bank.C);
  S.racing=false; S.lastWinner = winner; S.turn = (S.turn==="K"?"C":"K");
  if(S.bank.K<=0) setLog("Kessler is busted!"); if(S.bank.C<=0) setLog("The Cajun is busted!");

  if(roomRef){
    roomRef.update({
      bank:S.bank, racing:false, chosen:null, lastWinner:winner, turn:S.turn
    }).catch(e=>console.warn("[DL] room update(resolve) failed:", e));
  }
}

/* =================== Events =================== */
byId("A").addEventListener("click", ()=> start('A'));
byId("B").addEventListener("click", ()=> start('B'));
dealBtn.addEventListener("click", deal);
resetBtn.addEventListener("click", async ()=>{
  S.bank={K:500,C:2000}; bankK.textContent=fmtSirig(S.bank.K); bankC.textContent=fmtSirig(S.bank.C);
  setLog("Bank reset.");
  if(roomRef){ await roomRef.update({bank:S.bank}).catch(e=>console.warn("[DL] room update(reset)", e)); }
});
airportIn.addEventListener("change", async ()=>{
  S.airport=airportIn.value.toUpperCase();
  if(roomRef) await roomRef.update({airport:S.airport}).catch(()=>{});
});
betIn.addEventListener("change", async ()=>{
  S.bet=clamp(Number(betIn.value||MIN_BET),MIN_BET,Math.min(S.bank.K,S.bank.C));
  if(roomRef) await roomRef.update({bet:S.bet}).catch(()=>{});
});
liveToggle.addEventListener("change", async e=>{
  S.live=e.target.checked; setLog(S.live?"LIVE mode ON (via Lambda)":"Simulated mode");
  if(roomRef) await roomRef.update({live:S.live}).catch(()=>{});
});
newRoomBtn.addEventListener("click", createRoom);
copyBtn.addEventListener("click", copyInvite);

/* =================== Init =================== */
(function init(){
  setSeatLabel(seat);
  applySavedFacePos();         // set good defaults / saved positions
  updateHUD();
  startBlinking();
  ensureRoom();                // auto-joins if ?room=...
  setLog("Welcome to the Diplomat’s Lounge. Deal flights to start.");
})();
