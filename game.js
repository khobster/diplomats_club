/* Diplomat's Lounge — Always-live + icao24 tracking + fractional ETAs + Δ smoothing + fair longshot payouts */

/* ========= Lambda Gateway URL ========= */
const LIVE_PROXY = "https://qw5l10c7a4.execute-api.us-east-1.amazonaws.com/flights";

/* =================== Multiplayer (Firestore) =================== */
let db = null, roomId = null, seat = "Solo";
let roomRef = null, unsubRoom = null;

/* -------- DOM helpers -------- */
function byId(id){ return document.getElementById(id); }
const setLog = (t)=> byId("log").textContent = t;
function toast(t){ setLog(t); }

/* Buttons / header */
const seatPill = byId("seatPill"), seatName = byId("seatName");
const newRoomBtn = byId("newRoom"), copyBtn = byId("copyLink");

/* Seat code → display name (left seat 'K' is Cajun; right seat 'C' is Kessler) */
const N = { K: "Cajun", C: "Kessler" };
const nameOf = (s) => N[s] || "Solo";
function setSeatLabel(s){ seatName.textContent = nameOf(s); }

/* ===== Error handling ===== */
function showError(msg){
  let b = document.querySelector(".error-banner");
  if(!b){
    b = document.createElement("div");
    b.className = "error-banner";
    document.body.appendChild(b);
  }
  b.textContent = msg;
  setTimeout(() => b.remove(), 5000);
}

/* -------- Firebase init -------- */
async function initFirebase(){
  let attempts = 0;
  while(!window.firebaseDb && attempts < 50) { await new Promise(r=>setTimeout(r,100)); attempts++; }
  if(!window.firebaseDb){ console.error("[DL] Firebase not loaded"); disableRooms("Firebase failed to load"); return false; }
  db = window.firebaseDb;

  try{
    const testDoc = window.firebaseDoc(db, "_probe", "test");
    await window.firebaseSetDoc(testDoc, { timestamp: Date.now() });
    return true;
  }catch(e){
    console.error("[DL] Firebase connection test failed:", e);
    showError(e.code==='permission-denied' ? "Firestore rules blocked access." : "Firebase connection failed.");
    disableRooms("Firebase connection blocked"); 
    return false;
  }
}
function disableRooms(reason){ newRoomBtn.disabled = true; copyBtn.disabled = true; console.warn("[DL] Rooms disabled:", reason); }

/* -------- Rooms -------- */
async function ensureRoom(){
  if(!db){ const ok = await initFirebase(); if(!ok) return null; }

  const url = new URL(location.href);
  roomId = url.searchParams.get("room");
  if(!roomId) return null;

  roomRef = window.firebaseDoc(db, "rooms", roomId);

  // Get or create
  let snap;
  try{ snap = await window.firebaseGetDoc(roomRef); } 
  catch(e){ console.error("[DL] room get failed:", e); showError("Failed to get room."); return null; }

  if(!snap || !snap.exists()){
    try{
      await window.firebaseSetDoc(roomRef, {
        createdAt: Date.now(),
        seats: {K:"", C:""},
        bank: {K:0, C:0},              // start even
        airport:"JFK", bet:50, live:true,
        dealt:null, destPos:null,
        racing:false, turn:"K", chosen:null, roundSeed:null, lastWinner:null,
        pickedBy: {A:null, B:null},
        odds: null
      });
    }catch(e){ console.error("[DL] room create failed:", e); showError("Failed to create room."); return null; }
  }

  // Claim a seat
  const myId = "anon-"+Math.random().toString(36).slice(2,8);
  try{
    const claim = await window.firebaseRunTransaction(db, async (tx)=>{
      const dSnap = await tx.get(roomRef);
      const d = dSnap.data() || {};
      let pick = (d.seats?.K) ? ((d.seats?.C) ? "Solo" : "C") : "K";
      if(pick !== "Solo"){ const seats = {...(d.seats||{})}; seats[pick] = myId; tx.update(roomRef, {seats}); }
      return pick;
    });
    seat = claim; setSeatLabel(seat); seatPill.title = `Room: ${roomId}`;
  }catch(e){ console.error("[DL] seat claim failed:", e); showError("Failed to claim seat."); }

  // Live listener
  if (unsubRoom) unsubRoom();
  unsubRoom = window.firebaseOnSnapshot(roomRef, (doc)=>{
    const D = doc.data(); if(!D) return;

    const wasRacing = S.racing, oldChosen = S.chosen;

    // Merge
    S.bank = {...D.bank};
    S.airport = D.airport;
    S.bet = D.bet;
    S.live = true;  // always live
    S.dealt = D.dealt ? {...D.dealt} : null;
    S.destPos = D.destPos || null;
    S.racing = D.racing;
    S.turn = D.turn;
    S.chosen = D.chosen;
    S.roundSeed = D.roundSeed;
    S.lastWinner = D.lastWinner;
    S.raceStartTime = D.raceStartTime || null;
    S.pickedBy = D.pickedBy || {A:null, B:null};
    S.odds = D.odds || null;

    updateHUD();
    if(S.dealt) renderDealt();

    if(S.racing && (!wasRacing || S.chosen !== oldChosen)){
      if (!S.etaBaselineTime) {
        S.etaBaseline = { A: S.dealt?.A?.etaMinutes ?? 0, B: S.dealt?.B?.etaMinutes ?? 0 };
        S.etaBaselineTime = S.raceStartTime || Date.now();
        S._stableLeader = null; S._leaderLockUntil = 0; S._lastBannerUpdate = 0;
      }
      const turnPlayer = nameOf(S.turn);
      const oppPlayer  = nameOf(S.turn === "K" ? "C" : "K");
      const oppChoice = S.chosen === 'A' ? 'B' : 'A';
      setLog(`${turnPlayer} picked Flight ${S.chosen}! ${oppPlayer} gets Flight ${oppChoice}. Racing for ${S.bet}${S.odds && S.odds[S.odds.long] ? ` (longshot pays ${S.odds.mult.toFixed(2)}×)` : ""}!`);
      startRaceAnimation();
    }else if(S.racing){
      if(S.raceStartTime) startRaceAnimation();
    }else if(S.dealt && !S.racing){
      if(S.turn === seat) setLog("Your turn! Pick flight A or B. Your opponent gets the other one.");
      else setLog(`Waiting for ${nameOf(S.turn)} to pick a flight...`);
    }else{
      setLog("Deal flights to start.");
    }
  }, (err)=>{ console.error("[DL] room snapshot error:", err); showError("Lost connection. Reload the page."); });

  return roomRef;
}

async function createRoom(){
  if(!db){ const ok = await initFirebase(); if(!ok){ alert("Cannot create room."); return; } }
  try{
    const id = randomCode(6);
    const newRoomRef = window.firebaseDoc(db, "rooms", id);
    await window.firebaseSetDoc(newRoomRef, {
      createdAt: Date.now(),
      seats: {K:"", C:""},
      bank: {K:0, C:0},            // start even
      airport:"JFK", bet:50, live:true,
      dealt:null, destPos:null,
      racing:false, turn:"K", chosen:null, roundSeed:null, lastWinner:null,
      pickedBy: {A:null, B:null},
      odds: null
    });
    history.replaceState(null, "", currentUrlWithRoom(id));
    toast(`Room created: ${id}`);
    await ensureRoom();
  }catch(e){ console.error("[DL] createRoom error:", e); showError("Failed to create room."); }
}

async function copyInvite(){
  if(!roomId) await createRoom();
  if(!roomId) return;
  const u = currentUrlWithRoom(roomId);
  try{ await navigator.clipboard.writeText(u); toast("Invite link copied!"); }
  catch(e){ console.error("[DL] clipboard error:", e); prompt("Copy this link:", u); }
}

/* =================== UI refs =================== */
const lineA = byId("lineA"), lineB = byId("lineB");
const etaA = byId("etaA"), etaB = byId("etaB");
const barA = byId("barA"), barB = byId("barB");
const mapA = byId("mapA"), mapB = byId("mapB");
const dealBtn = byId("deal"), resetBtn = byId("reset");
const airportIn = byId("airport"), betIn = byId("betIn");
const bankK = byId("bankK"), bankC = byId("bankC");
const nameKEl = byId("nameK"), nameCEl = byId("nameC");
const bubK = byId("bubK"), bubC = byId("bubC");

/* Face nodes */
const K_eyeL = byId("K_eyeL"), K_eyeR = byId("K_eyeR"), K_mouth = byId("K_mouth");
const C_eyeL = byId("C_eyeL"), C_eyeR = byId("C_eyeR"), C_mouth = byId("C_mouth");

/* =================== Config =================== */
const MIN_BET = 25;
const REAL_TIME_RACING = true;
const LIVE_UPDATE_INTERVAL = 3 * 60 * 1000; // 3 minutes (first ping after 60s)
const MIN_RACE_MINUTES = 15;
const AIRPORTS = {
  JFK:[40.6413,-73.7781], EWR:[40.6895,-74.1745], LGA:[40.7769,-73.8740],
  YYZ:[43.6777,-79.6248], YUL:[45.4706,-73.7408], YVR:[49.1951,-123.1779],
  BOS:[42.3656,-71.0096], PHL:[39.8729,-75.2437], PIT:[40.4915,-80.2329],
  BWI:[39.1774,-76.6684], DCA:[38.8521,-77.0377], IAD:[38.9531,-77.4565],
  ATL:[33.6407,-84.4277], MIA:[25.7959,-80.2870], FLL:[26.0726,-80.1527],
  ORD:[41.9742,-87.9073], MDW:[41.7868,-87.7522], DTW:[42.2124,-83.3534],
  CLT:[35.2144,-80.9473], RDU:[35.8801,-78.7880], BNA:[36.1263,-86.6774],
  DFW:[32.8998,-97.0403], DAL:[32.8471,-96.8517], IAH:[29.9902,-95.3368],
  DEN:[39.8561,-104.6737], SLC:[40.7899,-111.9791], LAS:[36.0840,-115.1537],
  LAX:[33.9416,-118.4085], SFO:[37.6213,-122.3790], SEA:[47.4502,-122.3088],
  PHX:[33.4342,-112.0116], MSP:[44.8848,-93.2223], STL:[38.7487,-90.3700]
};

/* =================== State =================== */
const S = {
  bank: {K:0, C:0},
  airport: "JFK",
  bet: 50, live: true,
  dealt: null, destPos:null,
  maps: {A:null, B:null},
  racing:false, chosen:null, roundSeed:null, lastWinner:null,
  turn:"K",
  raceStartTime: null,
  raceDuration: null,
  pickedBy: {A:null, B:null},
  odds: null,

  // Δ smoothing
  etaBaseline: { A: null, B: null },
  etaBaselineTime: null,
  _lastBannerUpdate: 0,
  _stableLeader: null,
  _leaderLockUntil: 0,

  // live update timing
  lastLiveUpdateAt: null,
  nextLiveUpdateAt: null
};

/* =================== Utilities =================== */
const fmtMoney = (n)=>{ const sign = n >= 0 ? '+' : ''; return `${sign}${Math.abs(n).toLocaleString()}`; };
const clamp = (v,lo,hi)=> Math.max(lo, Math.min(hi, v));
const fmtClock = (minF)=>{
  const minutes = Math.max(0, Math.floor(minF));
  const seconds = Math.max(0, Math.floor((minF - minutes) * 60));
  return `${minutes}:${seconds.toString().padStart(2,'0')}`;
};

/* =================== Live Flight Updates =================== */
async function updateLivePositions() {
  if(!S.racing || !S.dealt || !S.live) return;

  // If these are simulated flights (no icao24), skip live ping
  const ida = S.dealt?.A?.icao24 || "";
  const idb = S.dealt?.B?.icao24 || "";
  if (!ida && !idb) return;

  try{
    // Request updates for THESE exact two flights by icao24
    const track = [ida, idb].filter(Boolean).join(",");
    const url = `${LIVE_PROXY}?airport=${encodeURIComponent(S.airport)}${track ? `&track=${encodeURIComponent(track)}` : ""}`;

    const r = await fetch(url, {cache:"no-store"});
    if(!r.ok) throw new Error("Live update failed");
    const data = await r.json();

    // capture server timestamp for "next update in"
    if (typeof data.updatedAt === "number") {
      S.lastLiveUpdateAt = data.updatedAt;
    } else {
      S.lastLiveUpdateAt = Date.now();
    }
    S.nextLiveUpdateAt = S.lastLiveUpdateAt + LIVE_UPDATE_INTERVAL;

    const flightA = S.dealt.A;
    const flightB = S.dealt.B;

    let updatedA = null, updatedB = null;

    if (Array.isArray(data.tracked)) {
      updatedA = data.tracked.find(f =>
        (flightA.icao24 && f.icao24 && f.icao24.toLowerCase() === flightA.icao24.toLowerCase()) ||
        (f.callsign === flightA.callsign)
      );
      updatedB = data.tracked.find(f =>
        (flightB.icao24 && f.icao24 && f.icao24.toLowerCase() === flightB.icao24.toLowerCase()) ||
        (f.callsign === flightB.callsign)
      );
    } else {
      // legacy fallback if backend returns {A,B}
      if (data.A && (data.A.icao24 === flightA.icao24 || data.A.callsign === flightA.callsign)) updatedA = data.A;
      if (data.B && (data.B.icao24 === flightB.icao24 || data.B.callsign === flightB.callsign)) updatedB = data.B;
    }

    let updated=false;
    if(updatedA?.pos){
      S.dealt.A.pos = updatedA.pos;
      if (Number.isFinite(updatedA.etaMinutes)) S.dealt.A.etaMinutes = updatedA.etaMinutes; // fractional
      updated = true;
      showBubble("K", `Flight A: ${Math.round(S.dealt.A.etaMinutes)} min!`, 2000);
    }
    if(updatedB?.pos){
      S.dealt.B.pos = updatedB.pos;
      if (Number.isFinite(updatedB.etaMinutes)) S.dealt.B.etaMinutes = updatedB.etaMinutes; // fractional
      updated = true;
      showBubble("C", `Flight B: ${Math.round(S.dealt.B.etaMinutes)} min!`, 2000);
    }

    if(updated){
      // Reset countdown baseline to newest ETAs (keep fractional)
      S.etaBaseline = { A: S.dealt.A.etaMinutes, B: S.dealt.B.etaMinutes };
      S.etaBaselineTime = Date.now();

      renderDealt();
      if(roomRef){ await window.firebaseUpdateDoc(roomRef, { dealt: S.dealt }).catch(()=>{}); }
    }
  }catch(e){ console.warn("[DL] Live position update failed:", e); }
}

/* =================== Race Animation with Live Updates =================== */
function startRaceAnimation(){
  if(!S.dealt || !S.racing) return;

  const {A,B} = S.dealt;
  let raceMs;

  if(REAL_TIME_RACING){
    raceMs = Math.min(A.etaMinutes, B.etaMinutes) * 60 * 1000;
    setLog(`LIVE RACE! Updates every 3 min. First to land wins!`);
  }else{
    raceMs = 6500;
  }

  if (!S.raceStartTime) S.raceStartTime = Date.now();
  S.raceDuration = raceMs;

  if (!S.etaBaselineTime) {
    S.etaBaseline = { A: S.dealt.A.etaMinutes, B: S.dealt.B.etaMinutes }; // fractional
    S.etaBaselineTime = S.raceStartTime;
    S._stableLeader = null; S._leaderLockUntil = 0; S._lastBannerUpdate = 0;
  }

  let updateInterval=null;
  if(REAL_TIME_RACING && S.live){
    setTimeout(()=>updateLivePositions(), 60000);                     // first ping after 60s
    updateInterval = setInterval(()=>updateLivePositions(), LIVE_UPDATE_INTERVAL); // then every 3 min
    S.nextLiveUpdateAt = (S.lastLiveUpdateAt || S.raceStartTime) + 60000;
  }

  const timerEl = byId("log");

  (function step(){
    if(!S.racing){ if(updateInterval) clearInterval(updateInterval); return; }

    const elapsed = Date.now() - S.raceStartTime;
    const currentA = S.dealt.A.etaMinutes;
    const currentB = S.dealt.B.etaMinutes;

    const progressA = Math.min(100, (elapsed / (currentA * 60 * 1000)) * 100);
    const progressB = Math.min(100, (elapsed / (currentB * 60 * 1000)) * 100);
    barA.style.width = progressA.toFixed(1)+"%";
    barB.style.width = progressB.toFixed(1)+"%";

    if(S.maps.A && S.maps.B){
      if(S.dealt.A.pos){ const p=S.dealt.A.pos; S.maps.A.plane.setLatLng([p.lat, p.lng||p.lon]); } else { updatePlanePosition('A', progressA/100); }
      if(S.dealt.B.pos){ const p=S.dealt.B.pos; S.maps.B.plane.setLatLng([p.lat, p.lng||p.lon]); } else { updatePlanePosition('B', progressB/100); }
    }

    // Banner (1 Hz; baseline; hysteresis) with "next update in"
    if (REAL_TIME_RACING && S.racing) {
      const now = Date.now();
      if (now - S._lastBannerUpdate >= 1000) {
        const baseTime = S.etaBaselineTime || S.raceStartTime || now;
        const elapsedMinSinceBase = Math.max(0, (now - baseTime) / 60000);

        const remA = Math.max(0, (S.etaBaseline.A ?? S.dealt.A.etaMinutes) - elapsedMinSinceBase);
        const remB = Math.max(0, (S.etaBaseline.B ?? S.dealt.B.etaMinutes) - elapsedMinSinceBase);

        const rawLeader = remA < remB ? 'A' : 'B';

        const HYSTERESIS_MS = 2000;
        if (S._stableLeader == null) {
          S._stableLeader = rawLeader;
          S._leaderLockUntil = now + HYSTERESIS_MS;
        } else if (rawLeader !== S._stableLeader) {
          if (now >= S._leaderLockUntil) {
            S._stableLeader = rawLeader;
            S._leaderLockUntil = now + HYSTERESIS_MS;
          }
        }

        const lead = S._stableLeader;
        const lag  = lead === 'A' ? 'B' : 'A';
        const leadRem = lead === 'A' ? remA : remB;
        const lagRem  = lead === 'A' ? remB : remA;
        const gap = Math.max(0, lagRem - leadRem);

        const nextAt = S.nextLiveUpdateAt || (S.raceStartTime + 60000); // first update at +60s
        const msToNext = Math.max(0, nextAt - now);
        const secToNext = Math.ceil(msToNext/1000);
        const mm = Math.floor(secToNext/60), ss = (secToNext%60).toString().padStart(2,'0');

        timerEl.textContent =
          `LIVE RACE - Flight ${lead} leads - ETA ${fmtClock(leadRem)} ` +
          `(${lag} ${fmtClock(lagRem)}, Δ${fmtClock(gap)}) · next update in ${mm}:${ss}`;

        S._lastBannerUpdate = now;
      }
    }

    if(progressA >= 100 || progressB >= 100){
      if(updateInterval) clearInterval(updateInterval);
      if(seat === S.turn) resolve();
    }else{
      requestAnimationFrame(step);
    }
  })();
}

function updatePlanePosition(which, progress){
  const M = S.maps[which]; if(!M) return;
  const flight = S.dealt[which];
  let startPos;

  if(flight.pos?.lat && (flight.pos.lng || flight.pos.lon)){
    const lng = flight.pos.lng || flight.pos.lon; startPos = [flight.pos.lat, lng];
  }else{
    startPos = guessPos(flight);
  }

  let destPos;
  if(S.destPos?.lat && (S.destPos.lng || S.destPos.lon)){
    const lng = S.destPos.lng || S.destPos.lon; destPos = [S.destPos.lat, lng];
  }else if(AIRPORTS[flight.dest]){
    destPos = AIRPORTS[flight.dest];
  }else{
    destPos = [40.6413,-73.7781];
  }

  const currentLat = startPos[0] + (destPos[0] - startPos[0]) * progress;
  const currentLng = startPos[1] + (destPos[1] - startPos[1]) * progress;
  M.plane.setLatLng([currentLat, currentLng]);
}
function showBubble(which, text, ms=1400){ const el = which==="K" ? bubK : bubC; if(!el) return; el.textContent = text; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"), ms); }

function talk(which, on=true){ const M = which==="K" ? K_mouth : C_mouth; if(M) M.classList.toggle("talk", on); }
function eyes(which, dir="center"){ const dx = dir==="left"? -6 : dir==="right" ? 6 : 0; const [L,R] = which==="K" ? [K_eyeL, K_eyeR] : [C_eyeL, C_eyeR]; if(L&&R){ L.style.transform=`translate(${dx}px,0)`; R.style.transform=`translate(${dx}px,0)`; } }
function startBlinking(){
  if(!K_eyeL||!K_eyeR||!C_eyeL||!C_eyeR) return;
  [[K_eyeL,K_eyeR],[C_eyeL,C_eyeR]].forEach(([l,r])=>{
    (function loop(){
      const delay = 1200 + Math.random()*2200;
      setTimeout(()=>{ if(l&&r){ l.classList.add("blink"); r.classList.add("blink"); setTimeout(()=>{ l.classList.remove("blink"); r.classList.remove("blink"); loop(); },120);} }, delay);
    })();
  });
}

/* =================== Maps =================== */
function ensureMap(which){
  if(S.maps[which]) return S.maps[which];
  const el = which==='A' ? mapA : mapB;
  try{
    const m = L.map(el, { zoomControl:false, attributionControl:false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 15 }).addTo(m);
    const plane = L.circleMarker([0,0], { radius:6, color:'#0077ff', fillColor:'#3ab8ff', fillOpacity:.9 }).addTo(m);
    const dest = L.circleMarker([0,0], { radius:5, color:'#111827', fillColor:'#111827', fillOpacity:1 }).addTo(m);
    const line = L.polyline([], { color:'#0ea5e9', weight:3, opacity:.9 }).addTo(m);
    const group = L.featureGroup([plane, dest, line]).addTo(m);
    S.maps[which] = { map:m, plane, dest, line, group };
    return S.maps[which];
  }catch(e){ console.error("[DL] Map init failed:", e); return null; }
}
function fitAndRender(which, flight, destPos){
  const M = ensureMap(which); if(!M) return 100;
  let pos;
  if(flight.pos?.lat && (flight.pos.lng || flight.pos.lon)){ const lng = flight.pos.lng || flight.pos.lon; pos = [flight.pos.lat, lng]; }
  else { pos = guessPos(flight); }

  let dst;
  if(destPos?.lat && (destPos.lng || destPos.lon)){ const lng = destPos.lng || destPos.lon; dst=[destPos.lat, lng]; }
  else if(AIRPORTS[flight.dest]){ dst = AIRPORTS[flight.dest]; }
  else if(AIRPORTS[S.airport]){ dst = AIRPORTS[S.airport]; }
  else { dst = [40.6413,-73.7781]; }

  M.plane.setLatLng(pos); M.dest.setLatLng(dst); M.line.setLatLngs([pos, dst]);
  const bounds = L.latLngBounds([pos, dst]).pad(0.35);
  M.map.fitBounds(bounds, { animate:false });

  const distKm = L.latLng(pos[0],pos[1]).distanceTo(L.latLng(dst[0],dst[1]))/1000;
  return Math.max(1, Math.round(distKm));
}
function guessPos(f){
  if(f.pos?.lat && (f.pos.lng || f.pos.lon)){ const lng = f.pos.lng || f.pos.lon; return [f.pos.lat, lng]; }
  const o = AIRPORTS[f.origin], d = AIRPORTS[f.dest];
  if(!o || !d){
    if(d){ const offsetLat = d[0] + (Math.random()-0.5)*0.9; const offsetLng = d[1] + (Math.random()-0.5)*0.9; return [offsetLat, offsetLng]; }
    return AIRPORTS[S.airport] || [40.6413,-73.7781];
  }
  const frac = Math.max(0.1, Math.min(0.9, 1 - (f.etaMinutes/60)));
  const lat = o[0] + (d[0]-o[0]) * frac;
  const lng = o[1] + (d[1]-o[1]) * frac;
  return [lat, lng];
}

/* =================== Flight sources =================== */
function simFlights(iata){
  const cities=Object.keys(AIRPORTS);
  const r=(a,b)=>Math.floor(Math.random()*(b-a+1))+a;
  const p=()=>{ 
    const origin=cities[r(0,cities.length-1)];
    // add a small fractional part so seconds differ in sim mode too
    const eta = r(3,14) + Math.random();
    return { icao24:"", origin, dest:iata, etaMinutes:eta, callsign:`${iata}${r(100,999)}` };
  };
  let A=p(),B=p();
  if(B.origin===A.origin) B.origin=cities[(cities.indexOf(A.origin)+3)%cities.length];
  const dp = AIRPORTS[iata] || null;
  return {A,B,destPos:dp};
}
async function liveFlights(iata){
  if(!LIVE_PROXY) throw new Error("Live proxy not configured");
  const url = `${LIVE_PROXY}?airport=${encodeURIComponent(iata)}`;
  const r = await fetch(url, {cache:"no-store"});
  if(!r.ok) throw new Error("proxy failed");
  return await r.json();
}

/* =================== HUD / Update =================== */
function updateHUD(){
  if(nameKEl) nameKEl.textContent = nameOf('K');
  if(nameCEl) nameCEl.textContent = nameOf('C');

  const kEl = bankK, cEl = bankC;
  kEl.textContent = fmtMoney(S.bank.K);
  cEl.textContent = fmtMoney(S.bank.C);
  kEl.className = S.bank.K > 0 ? "you" : S.bank.K < 0 ? "opp" : "zero";
  cEl.className = S.bank.C > 0 ? "you" : S.bank.C < 0 ? "opp" : "zero";

  betIn.value = S.bet;
  airportIn.value = S.airport;

  if(S.bank.K >= 5000 && S.bank.C <= -5000) setLog(`🎉 ${nameOf('K').toUpperCase()} WINS THE GAME! +$5,000 vs -$5,000!`);
  else if(S.bank.C >= 5000 && S.bank.K <= -5000) setLog(`🎉 ${nameOf('C').toUpperCase()} WINS THE GAME! +$5,000 vs -$5,000!`);
}

function renderDealt(){
  const {A,B} = S.dealt;
  const originA = A.origin !== "—" ? A.origin : "???";
  const originB = B.origin !== "—" ? B.origin : "???";
  lineA.textContent = `A — ${originA} → ${A.dest} (${A.callsign})`;
  lineB.textContent = `B — ${originB} → ${B.dest} (${B.callsign})`;
  // round on cards for cleanliness; keep fractional internally for banner
  etaA.textContent = `ETA ~ ${Math.round(A.etaMinutes)} min`;
  etaB.textContent = `ETA ~ ${Math.round(B.etaMinutes)} min`;

  const cardA = byId("A"), cardB = byId("B");
  cardA.querySelectorAll('.picker-badge').forEach(b => b.remove());
  cardB.querySelectorAll('.picker-badge').forEach(b => b.remove());
  cardA.className = "card"; cardB.className = "card";

  if(S.pickedBy.A){
    cardA.classList.add(`picked-${S.pickedBy.A.toLowerCase()}`);
    const badge = document.createElement('div');
    badge.className = `picker-badge ${S.pickedBy.A.toLowerCase()}`;
    badge.textContent = `${nameOf(S.pickedBy.A)}'s`;
    cardA.appendChild(badge);
  }
  if(S.pickedBy.B){
    cardB.classList.add(`picked-${S.pickedBy.B.toLowerCase()}`);
    const badge = document.createElement('div');
    badge.className = `picker-badge ${S.pickedBy.B.toLowerCase()}`;
    badge.textContent = `${nameOf(S.pickedBy.B)}'s`;
    cardB.appendChild(badge);
  }

  try{ const da = fitAndRender('A', A, S.destPos); etaA.textContent += ` — ~${da} km`; }catch(e){ console.warn("[DL] Map A render error:", e); }
  try{ const db = fitAndRender('B', B, S.destPos); etaB.textContent += ` — ~${db} km`; }catch(e){ console.warn("[DL] Map B render error:", e); }
}

/* =================== Round flow =================== */
async function deal(){
  if(S.racing) return;
  if(seat!=="K" && seat!=="C"){ showBubble("K","Join a seat to play!"); return; }

  S.airport = (airportIn.value||"JFK").toUpperCase();
  S.bet = clamp(Number(betIn.value||MIN_BET), MIN_BET, 1e9);
  S.live = true;

  barA.style.width="0%"; barB.style.width="0%";
  lineA.textContent="Dealing…"; lineB.textContent="Dealing…";
  etaA.textContent=""; etaB.textContent="";

  showBubble("K","New round!"); showBubble("C","Let's go!");
  talk("K",true); talk("C",true); setTimeout(()=>{talk("K",false); talk("C",false);}, 900);

  setLog("Finding real flights (preferring 15+ min ETAs for drama)…");

  let data;
  try{
    const url = `${LIVE_PROXY}?airport=${encodeURIComponent(S.airport)}&minETA=${MIN_RACE_MINUTES}`;
    const r = await fetch(url, {cache:"no-store"});
    if(!r.ok) throw new Error("proxy failed");
    data = await r.json();

    if(data.A && data.B){
      const minETA = Math.min(data.A.etaMinutes, data.B.etaMinutes);
      if(minETA < 10){
        data = simFlights(S.airport);
        data.A.etaMinutes = 15 + Math.random()*30;
        data.B.etaMinutes = 20 + Math.random()*35;
        setLog("Live flights too close—using simulated flights for a longer race.");
      }
    }
  }catch(e){
    console.warn("[DL] Flight fetch error:", e);
    data = simFlights(S.airport);
    data.A.etaMinutes = 15 + Math.random()*30;
    data.B.etaMinutes = 20 + Math.random()*35;
    setLog("Live unavailable—using simulated flights.");
  }

  const destPos = data.destPos || AIRPORTS[S.airport] || null;
  S.dealt = { A:data.A, B:data.B };     // includes icao24 when live
  S.destPos = destPos;
  S.racing = false;
  S.chosen = null;
  S.roundSeed = Math.floor(Math.random()*1e9);
  S.pickedBy = {A:null, B:null};
  S.odds = null;

  S.etaBaseline = {A:null, B:null};
  S.etaBaselineTime = null;

  renderDealt();

  if(S.turn === seat){ setLog("Your turn! Pick flight A or B. Your opponent gets the other one."); showBubble(S.turn, "My pick!"); }
  else { setLog(`Waiting for ${nameOf(S.turn)} to pick a flight...`); }

  if(roomRef){
    try{
      await window.firebaseUpdateDoc(roomRef, {
        airport:S.airport, bet:S.bet, live:true,
        dealt:S.dealt, destPos:S.destPos,
        racing:false, chosen:null, roundSeed:S.roundSeed, lastWinner:null,
        pickedBy:{A:null, B:null}, odds:null
      });
    }catch(e){ console.warn("[DL] room update(deal) failed:", e); }
  }
}

async function start(choice){
  if(!S.dealt || S.racing) return;
  if(seat!=="K" && seat!=="C"){ showBubble("K","Join a seat to play!"); return; }
  if(S.turn!==seat){ return; }

  const {A,B} = S.dealt;
  const etaShort = Math.min(A.etaMinutes, B.etaMinutes);
  const etaLong  = Math.max(A.etaMinutes, B.etaMinutes);
  const longFlight = A.etaMinutes > B.etaMinutes ? 'A' : 'B';
  const multRaw = etaLong / etaShort;
  const mult = clamp(multRaw, 1.1, 2.5);  // pragmatic cap

  S.odds = {A:1, B:1, long:longFlight, mult};
  S.odds[longFlight] = mult;

  S.chosen = choice;
  S.racing = true;
  S.raceStartTime = Date.now();

  // Baseline ETAs (fractional)
  S.etaBaseline = { A: S.dealt.A.etaMinutes, B: S.dealt.B.etaMinutes };
  S.etaBaselineTime = S.raceStartTime;
  S._stableLeader = null; S._leaderLockUntil = 0; S._lastBannerUpdate = 0;

  S.pickedBy.A = choice === 'A' ? S.turn : (S.turn === "K" ? "C" : "K");
  S.pickedBy.B = choice === 'B' ? S.turn : (S.turn === "K" ? "C" : "K");

  const myChoice = choice, oppChoice = choice === 'A' ? 'B' : 'A';
  const turnPlayer = nameOf(S.turn);
  const oppPlayer  = nameOf(S.turn === "K" ? "C" : "K");

  if(choice === longFlight){ showBubble(S.turn, `Longshot pays ${mult.toFixed(2)}×`, 1600); }

  setLog(`${turnPlayer} picks Flight ${myChoice}! ${oppPlayer} gets Flight ${oppChoice}. Racing for ${S.bet}${choice===longFlight?` (longshot pays ${mult.toFixed(2)}×)`:''}!`);

  eyes(S.turn, choice==='A'?"left":"right"); talk(S.turn,true); byId(S.turn+"_mouth").classList.add("smile");
  setTimeout(()=>{ eyes(S.turn,"center"); talk(S.turn,false); byId(S.turn+"_mouth").classList.remove("smile"); }, 1200);

  if(roomRef){
    try{
      await window.firebaseUpdateDoc(roomRef, {
        racing:true, chosen:choice, bet:S.bet,
        raceStartTime:S.raceStartTime, pickedBy:S.pickedBy, odds:S.odds
      });
    }catch(e){ console.warn("[DL] room update(start) failed:", e); }
  }

  renderDealt();
  startRaceAnimation();
}

async function resolve(){
  const now = Date.now();
  const baseTime = S.etaBaselineTime || S.raceStartTime || now;
  const elapsedMinSinceBase = Math.max(0, (now - baseTime) / 60000);
  const remA = Math.max(0, (S.etaBaseline.A ?? S.dealt.A.etaMinutes) - elapsedMinSinceBase);
  const remB = Math.max(0, (S.etaBaseline.B ?? S.dealt.B.etaMinutes) - elapsedMinSinceBase);

  const tie = Math.abs(remA - remB) < 0.01;
  const winner = tie ? (S.roundSeed % 2 ? 'A' : 'B') : (remA < remB ? 'A' : 'B');

  const turnPlayer = S.turn;
  const oppPlayer  = S.turn === "K" ? "C" : "K";
  const turnChoice = S.chosen;

  const turnWon = (turnChoice === winner);
  const winnerPlayer = turnWon ? turnPlayer : oppPlayer;
  const loserPlayer  = turnWon ? oppPlayer  : turnPlayer;

  const long = S.odds?.long;
  const mult = S.odds?.mult || 1;
  const payout = Math.round((winner === long ? S.bet * mult : S.bet));

  S.bank[winnerPlayer] += payout;
  S.bank[loserPlayer]  -= payout;

  const winnerName = nameOf(winnerPlayer);
  const loserName  = nameOf(loserPlayer);
  const bonusText  = winner === long ? ` (longshot ${mult.toFixed(2)}×)` : "";

  setLog(`Flight ${winner} wins! ${winnerName} takes ${payout.toLocaleString()} from ${loserName}${bonusText}.`);

  showBubble(winnerPlayer, "YES! Got it!", 1500);
  showBubble(loserPlayer, "Damn!", 1200);
  talk(winnerPlayer,true); byId(winnerPlayer+"_mouth").classList.add("smile");
  setTimeout(()=>{ talk(winnerPlayer,false); byId(winnerPlayer+"_mouth").classList.remove("smile"); },1500);
  byId(loserPlayer+"_mouth").classList.add("frown"); eyes(loserPlayer,"left");
  setTimeout(()=>{ eyes(loserPlayer,"center"); byId(loserPlayer+"_mouth").classList.remove("frown"); },1200);

  updateHUD();
  S.racing=false;
  S.lastWinner = winner;
  S.turn = (S.turn==="K"?"C":"K");
  S.pickedBy = {A:null, B:null};

  if(S.bank.K >= 5000 && S.bank.C <= -5000){
    setLog(`🎉 ${nameOf('K').toUpperCase()} WINS THE GAME! +$5,000 vs -$5,000! 🎉`);
    showBubble("K","I'm the champion!",3000); showBubble("C","Good game!",3000);
  }else if(S.bank.C >= 5000 && S.bank.K <= -5000){
    setLog(`🎉 ${nameOf('C').toUpperCase()} WINS THE GAME! +$5,000 vs -$5,000! 🎉`);
    showBubble("C","Victory is mine!",3000); showBubble("K","Well played!",3000);
  }

  if(roomRef){
    try{
      await window.firebaseUpdateDoc(roomRef, {
        bank:S.bank, racing:false, chosen:null, lastWinner:winner, 
        turn:S.turn, pickedBy:{A:null, B:null}, odds:S.odds
      });
    }catch(e){ console.warn("[DL] room update(resolve) failed:", e); }
  }
}

/* =================== Events =================== */
byId("A").addEventListener("click", ()=> start('A'));
byId("B").addEventListener("click", ()=> start('B'));
dealBtn.addEventListener("click", deal);

resetBtn.addEventListener("click", async ()=>{
  S.bank={K:0,C:0}; updateHUD();
  setLog("Bank reset. First to +$5,000 (with opponent at -$5,000) wins!");
  if(roomRef){ try{ await window.firebaseUpdateDoc(roomRef, {bank:S.bank}); }catch(e){ console.warn("[DL] room update(reset)", e); } }
});
airportIn.addEventListener("change", async ()=>{
  S.airport=airportIn.value.toUpperCase();
  if(roomRef){ try{ await window.firebaseUpdateDoc(roomRef, {airport:S.airport}); }catch(e){ console.warn("[DL] airport update failed:", e); } }
});
betIn.addEventListener("change", async ()=>{
  S.bet=clamp(Number(betIn.value||MIN_BET),MIN_BET,1e9);
  if(roomRef){ try{ await window.firebaseUpdateDoc(roomRef, {bet:S.bet}); }catch(e){ console.warn("[DL] bet update failed:", e); } }
});
newRoomBtn.addEventListener("click", createRoom);
copyBtn.addEventListener("click", copyInvite);

/* =================== Init =================== */
function randomCode(n=6){ 
  const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; 
  return Array.from({length:n},()=>a[Math.floor(Math.random()*a.length)]).join(''); 
}
function currentUrlWithRoom(id){ const u=new URL(location.href); u.searchParams.set("room", id); return u.toString(); }

(async function init(){
  if(nameKEl) nameKEl.textContent = nameOf('K');
  if(nameCEl) nameCEl.textContent = nameOf('C');

  setSeatLabel(seat);
  updateHUD();
  startBlinking();

  const img = new Image();
  img.onload = function(){
    const stage = byId("stage");
    const placeholder = stage.querySelector(".stage-placeholder");
    if(placeholder) placeholder.remove();
    const actualImg = document.createElement("img");
    actualImg.src = "./sofawithkesslerandcajun.png";
    actualImg.alt = "Cajun and Kessler on a sofa";
    stage.insertBefore(actualImg, stage.firstChild);
    const faceSvg = stage.querySelector(".faces");
    if(faceSvg) faceSvg.style.display = "block";
  };
  img.onerror = function(){ console.warn("[DL] Could not load sofa image, using placeholder"); };
  img.src = "./sofawithkesslerandcajun.png";

  await initFirebase();
  await ensureRoom();

  setLog("Welcome to the Diplomat's Lounge. Deal flights to start.");
})();
