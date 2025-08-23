/* Diplomat's Lounge — 100% live flights, continuity-preserving tracking */

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

/* Seat names */
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

/* ===== Identity (PID in URL, localStorage fallback) ===== */
let MY_ID = null;
function getPlayerId(){
  if (MY_ID) return MY_ID;

  const url = new URL(location.href);
  let pid = url.searchParams.get('pid');

  // Fallback to localStorage if no pid in URL
  if (!pid) {
    try { pid = localStorage.getItem('diplomatPlayerId') || ""; } catch {}
  }

  // Generate if still missing
  if (!pid) {
    pid = "player-" + Math.random().toString(36).slice(2,10) + Date.now().toString(36);
    try { localStorage.setItem('diplomatPlayerId', pid); } catch {}
  }

  // Persist PID into URL if not present
  if (!url.searchParams.get('pid')) {
    url.searchParams.set('pid', pid);
    history.replaceState(null, "", url.toString());
  }

  MY_ID = pid;
  return pid;
}
const isValidPlayerId = (s)=> typeof s === "string" && s.startsWith("player-");

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
function randomCode(n=6){ 
  const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; 
  return Array.from({length:n},()=>a[Math.floor(Math.random()*a.length)]).join(''); 
}
function currentUrlWithRoom(id){ const u=new URL(location.href); u.searchParams.set("room", id); return u.toString(); }

async function ensureRoom(){
  if(!db){ const ok = await initFirebase(); if(!ok) return null; }

  const url = new URL(location.href);
  roomId = url.searchParams.get("room");
  if(!roomId) return null;

  roomRef = window.firebaseDoc(db, "rooms", roomId);

  // Get persistent player ID + any seat hint from URL
  const myId = getPlayerId();
  const seatHint = url.searchParams.get('seat'); // 'K' | 'C' | null

  // Get or create
  let snap;
  try{ snap = await window.firebaseGetDoc(roomRef); } 
  catch(e){ console.error("[DL] room get failed:", e); showError("Failed to get room."); return null; }

  if(!snap || !snap.exists()){
    try{
      await window.firebaseSetDoc(roomRef, {
        createdAt: Date.now(),
        seats: {K:"", C:""},
        bank: {K:0, C:0},
        airport:"JFK", bet:50, live:true,
        dealt:null, destPos:null,
        racing:false, turn:"K", chosen:null, roundSeed:null, lastWinner:null,
        pickedBy: {A:null, B:null},
        odds: null
      });
    }catch(e){ console.error("[DL] room create failed:", e); showError("Failed to create room."); return null; }
  }

  // Claim a seat (PID-aware, with seat-hint)
  try{
    const claim = await window.firebaseRunTransaction(db, async (tx)=>{
      const dSnap = await tx.get(roomRef);
      const d = dSnap.data() || {};
      const seats = d.seats || {K:"", C:""};

      // If we already own a seat, keep it
      if (seats.K === myId) return "K";
      if (seats.C === myId) return "C";

      // Try seat hint first if valid and free/invalid
      if (seatHint === "K" && !isValidPlayerId(seats.K)) { seats.K = myId; tx.update(roomRef, {seats}); return "K"; }
      if (seatHint === "C" && !isValidPlayerId(seats.C)) { seats.C = myId; tx.update(roomRef, {seats}); return "C"; }

      // Otherwise take first available/invalid seat
      if (!isValidPlayerId(seats.K)) { seats.K = myId; tx.update(roomRef, {seats}); return "K"; }
      if (!isValidPlayerId(seats.C)) { seats.C = myId; tx.update(roomRef, {seats}); return "C"; }

      // Both are occupied by valid players
      return "Solo";
    });
    seat = claim; setSeatLabel(seat); seatPill.title = `Room: ${roomId}`;
    console.log(`[DL] Seat=${seat} myId=${myId}`);
  }catch(e){ console.error("[DL] seat claim failed:", e); showError("Failed to claim seat."); }

  // Live listener
  if (unsubRoom) unsubRoom();
  unsubRoom = window.firebaseOnSnapshot(roomRef, (doc)=>{
    const D = doc.data(); if(!D) return;

    // Detect if we lost our seat (another PID took it)
    const currentSeats = D.seats || {};
    const myIdNow = getPlayerId();
    if (seat === "K" && currentSeats.K !== myIdNow) { seat = "Solo"; setSeatLabel(seat); }
    if (seat === "C" && currentSeats.C !== myIdNow) { seat = "Solo"; setSeatLabel(seat); }

    const wasRacing = S.racing;
    const oldChosen = S.chosen;
    const oldRaceStartTime = S.raceStartTime;

    // Merge
    S.bank = {...D.bank};
    S.airport = D.airport;
    S.bet = D.bet;
    S.live = true;
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

    // Detect cross-client race starts / choice flips
    const raceJustStarted = S.racing && (!wasRacing || S.raceStartTime !== oldRaceStartTime);
    const choiceChanged = S.racing && S.chosen !== oldChosen;
    
    if(raceJustStarted || choiceChanged){
      // Reset animation state for a fresh start
      S.etaBaseline = { A: S.dealt?.A?.etaMinutes ?? 0, B: S.dealt?.B?.etaMinutes ?? 0 };
      S.etaBaselineTime = S.raceStartTime || Date.now();
      S._stableLeader = null; 
      S._leaderLockUntil = 0; 
      S._lastBannerUpdate = 0;
      S._landed = {A:false, B:false};
      S._animationRunning = false;

      // Initialize segments with current positions
      ['A','B'].forEach(k=>{
        const f = S.dealt[k];
        if(f){
          let startPos;
          if (f?.pos?.lat != null && (f.pos.lng ?? f.pos.lon) != null){
            startPos = [f.pos.lat, (f.pos.lng ?? f.pos.lon)];
          } else {
            startPos = guessPos(f);
          }
          anchorSegment(k, startPos, f.etaMinutes, S.raceStartTime || Date.now());
        }
      });
      
      const turnPlayer = nameOf(S.turn);
      const oppPlayer  = nameOf(S.turn === "K" ? "C" : "K");
      const oppChoice = S.chosen === 'A' ? 'B' : 'A';
      setLog(`${turnPlayer} picked Flight ${S.chosen}! ${oppPlayer} gets Flight ${oppChoice}. Racing for $${S.bet}${S.odds && S.odds[S.odds.long] ? ` (longshot pays ${S.odds.mult.toFixed(2)}×)` : ""}!`);
      startRaceAnimation();
    }else if(S.racing && wasRacing){
      // Ensure animation is running, but don't duplicate
      if(!S._animationRunning){
        startRaceAnimation();
      }
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
      bank: {K:0, C:0},
      airport:"JFK", bet:50, live:true,
      dealt:null, destPos:null,
      racing:false, turn:"K", chosen:null, roundSeed:null, lastWinner:null,
      pickedBy: {A:null, B:null},
      odds: null
    });
    history.replaceState(null, "", currentUrlWithRoom(id)); // preserves pid/seat params
    toast(`Room created: ${id}`);
    await ensureRoom();
  }catch(e){ console.error("[DL] createRoom error:", e); showError("Failed to create room."); }
}

async function copyInvite(){
  if(!roomId) await createRoom();
  if(!roomId) return;

  // Build invite URL that includes the room, a seat hint for the GUEST,
  // and explicitly strips *your* pid so they generate their own.
  const u = new URL(currentUrlWithRoom(roomId));
  u.searchParams.delete('pid');
  const hint = (seat === "K" ? "C" : "K"); // invitee should be the opposite seat
  u.searchParams.set('seat', hint);

  try{ await navigator.clipboard.writeText(u.toString()); toast("Invite link copied!"); }
  catch(e){ console.error("[DL] clipboard error:", e); prompt("Copy this link:", u.toString()); }
}

/* =================== UI refs =================== */
const lineA = byId("lineA"), lineB = byId("lineB");
const etaA = byId("etaA"), etaB = byId("etaB");
const barA = byId("barA"), barB = byId("barB");
const mapA = byId("mapA"), mapB = byId("mapB");
const dealBtn = byId("deal"), resetBtn = byId("reset");
const betIn = byId("betIn");
const bankK = byId("bankK"), bankC = byId("bankC");
const bubK = byId("bubK"), bubC = byId("bubC");
const autoAirportPill = byId("autoAirport");

/* Face nodes */
const K_eyeL = byId("K_eyeL"), K_eyeR = byId("K_eyeR"), K_mouth = byId("K_mouth");
const C_eyeL = byId("C_eyeL"), C_eyeR = byId("C_eyeR"), C_mouth = byId("C_mouth");

/* =================== Config =================== */
const MIN_BET = 25;
const REAL_TIME_RACING = true;
const FIRST_PING_DELAY = 60 * 1000;         // 60s
const LIVE_UPDATE_INTERVAL = 3 * 60 * 1000; // 3 minutes
const MIN_RACE_MINUTES = 12;                // target race length
const LANDING_MI_THRESHOLD = 3;             // counts as landed at ≤ 3 miles
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
  PHX:[33.4342,-112.0116], MSP:[44.8848,-93.2223], STL:[38.7487,-90.3700],
  MCO:[28.4312,-81.3081], SAN:[32.7338,-117.1933], PDX:[45.5898,-122.5951]
};

/* =================== State =================== */
const S = {
  bank: {K:0, C:0},
  airport: null,
  bet: 50, live: true,
  dealt: null, destPos:null,
  maps: {A:null, B:null},
  racing:false, chosen:null, roundSeed:null, lastWinner:null,
  turn:"K",
  raceStartTime: null,
  raceDuration: null,
  pickedBy: {A:null, B:null},
  odds: null,

  // Baseline for banner countdown (anchored at race start; only moved downward)
  etaBaseline: { A: null, B: null },
  etaBaselineTime: null,
  _lastBannerUpdate: 0,
  _stableLeader: null,
  _leaderLockUntil: 0,
  _resolving: false,
  _animationRunning: false,  // Track if animation is running

  // live update timing
  lastLiveUpdateAt: null,
  nextLiveUpdateAt: null,
  _liveIntervalId: null,
  _liveTimeoutId: null,  // Track the first ping timeout
  _liveFetchInFlight: false,  // Prevent overlapping fetches

  // segment anchors + landed flags
  seg: {
    A: { startPos: null, startTime: 0, etaAtStart: 0 },
    B: { startPos: null, startTime: 0, etaAtStart: 0 }
  },
  _landed: { A:false, B:false }
};

/* =================== Utilities =================== */
const fmtMoney = (n)=>{ const sign = n >= 0 ? '+' : ''; return `${sign}${Math.abs(n).toLocaleString()}`; };
const fmtUSD   = (n)=> `$${Math.round(n).toLocaleString()}`;
const clamp = (v,lo,hi)=> Math.max(lo, Math.min(hi, v));
const fmtClock = (minF)=>{
  const m = Math.max(0, Math.floor(minF));
  const s = Math.max(0, Math.floor((minF - m) * 60));
  return `${m}:${s.toString().padStart(2,'0')}`;
};
const kmToMi = (km)=> Math.round(km * 0.621371);
const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));

function lerp(a,b,t){ return [ a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t ]; }
function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function milesBetween(lat1, lon1, lat2, lon2){
  const Rk=6371, toRad=Math.PI/180;
  const dLat=(lat2-lat1)*toRad, dLon=(lon2-lon1)*toRad;
  const s1=Math.sin(dLat/2), s2=Math.sin(dLon/2);
  const c=2*Math.asin(Math.sqrt(s1*s1 + Math.cos(lat1*toRad)*Math.cos(lat2*toRad)*s2*s2));
  return Math.round(Rk*c*0.621371);
}
function destLatLng(){
  const d = S.destPos || {};
  const lng = d.lng ?? d.lon ?? -73.7781;
  const lat = d.lat ?? 40.6413;
  return [lat, lng];
}
function anchorSegment(which, startPosLatLng, etaMinutes, when=Date.now()){
  S.seg[which] = {
    startPos: startPosLatLng,
    startTime: when,
    etaAtStart: Math.max(0.01, Number(etaMinutes) || 0.01)
  };
}
function segRemaining(which, now=Date.now()){
  const seg = S.seg[which];
  if (!seg || !seg.startPos) return { t:0, rem: S.dealt?.[which]?.etaMinutes ?? 0 };
  const elapsedMin = Math.max(0, (now - seg.startTime)/60000);
  const rem = Math.max(0, seg.etaAtStart - elapsedMin);
  const t = seg.etaAtStart <= 0 ? 1 : clamp01(1 - (rem / seg.etaAtStart));
  return { t, rem };
}
function segPos(which, now=Date.now()){
  const seg = S.seg[which];
  const dst = destLatLng();
  if (!seg || !seg.startPos) return dst;
  const { t, rem } = segRemaining(which, now);
  if (t >= 0.999 || rem <= 0.01) return dst;
  return lerp(seg.startPos, dst, t);
}

// fetch with timeout
async function fetchJSON(url, timeoutMs=9000){
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), timeoutMs);
  try{
    const r = await fetch(url, { cache:"no-store", signal: ctrl.signal });
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/* =================== Kapow overlays =================== */
function showKapow(title, opts={}){
  const {
    subtitle = "",
    palette = ["#3EB7C2","#EAC54F","#E11D48","#34D399"],
    ms = 1600
  } = opts;

  const root = document.createElement("div");
  root.className = "kapow";
  root.innerHTML = `
  <svg viewBox="0 0 1200 800" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g class="burst">
      <polygon fill="${palette[0]}" points="600,20 690,150 870,130 770,250 920,340 740,350 800,520 620,420 600,610 580,420 400,520 460,350 280,340 430,250 330,130 510,150"/>
      <polygon fill="${palette[1]}" opacity=".95" points="600,90 665,185 800,175 720,255 820,320 700,325 740,460 620,390 600,510 580,390 460,460 500,325 380,320 480,255 400,175 535,185"/>
      <polygon fill="${palette[2]}" opacity=".92" points="600,180 650,235 720,228 670,268 725,305 660,308 682,380 620,340 600,410 580,340 518,380 540,308 475,305 530,268 480,228 550,235"/>
      <rect x="365" y="300" rx="20" ry="20" width="470" height="180" fill="${palette[3]}"/>
      <text class="word" x="600" y="385" font-size="92" text-anchor="middle">${title}</text>
      ${subtitle ? `<text class="sub" x="600" y="430" font-size="28" text-anchor="middle">${subtitle}</text>` : ""}
    </g>
  </svg>`;
  document.body.appendChild(root);
  setTimeout(()=> root.remove(), ms);
}

/* =================== Connection Status =================== */
let connectionFailures = 0;
function updateConnectionStatus(success) {
  let el = document.getElementById('connection-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'connection-status';
    el.style.cssText = `
      position: fixed; top: 10px; right: 10px; padding: 6px 12px;
      background: rgba(255,255,255,0.9); border-radius: 20px; font-size: 12px; font-weight: 700;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1); z-index: 1000;`;
    el.innerHTML = ' Live';
    document.body.appendChild(el);
  }
  if (success) {
    connectionFailures = 0;
    el.innerHTML = ' Live';
    el.style.background = 'rgba(255,255,255,0.9)';
  } else {
    connectionFailures++;
    if (connectionFailures >= 2) {
      el.innerHTML = ' Interpolating';
      el.style.background = 'rgba(255,240,240,0.9)';
    }
  }
}

/* =================== Live Flight Updates =================== */
async function updateLivePositions() {
  if(!S.racing || !S.dealt || !S.live || !S.airport) return;
  if(S._liveFetchInFlight) { console.log("[DL] Live fetch already in flight, skipping"); return; }

  S._liveFetchInFlight = true;
  S.lastLiveUpdateAt = Date.now();
  S.nextLiveUpdateAt = S.lastLiveUpdateAt + LIVE_UPDATE_INTERVAL;

  const ida = S.dealt?.A?.icao24 || "";
  const idb = S.dealt?.B?.icao24 || "";
  const hex = /^[0-9a-f]{6}$/i;
  const trackList = [ida, idb].filter(id => id && hex.test(id));
  if (trackList.length === 0) { S._liveFetchInFlight = false; return; }

  let attempts = 0;
  const maxAttempts = 3;
  while (attempts < maxAttempts) {
    try {
      const url = `${LIVE_PROXY}?airport=${encodeURIComponent(S.airport)}&track=${encodeURIComponent(trackList.join(','))}`;
      console.log(`[DL] Fetching live updates (attempt ${attempts + 1})...`);
      const data = await fetchJSON(url, 9000 + (attempts * 2000));

      if (typeof data.updatedAt === "number") {
        S.lastLiveUpdateAt = data.updatedAt;
        S.nextLiveUpdateAt = S.lastLiveUpdateAt + LIVE_UPDATE_INTERVAL;
      }

      let updatedA = null, updatedB = null;
      if (Array.isArray(data.tracked)) {
        updatedA = data.tracked.find(f => ida && f.icao24 && f.icao24.toLowerCase() === ida.toLowerCase());
        updatedB = data.tracked.find(f => idb && f.icao24 && f.icao24.toLowerCase() === idb.toLowerCase());
        console.log("[DL] Tracked results:", { foundA: !!updatedA, foundB: !!updatedB });
      }

      let changed = false;

      // continuity-preserving rebase that keeps CURRENT SCREEN POSITION constant
      function rebase(which, updated){
        const f = S.dealt[which];
        const now = Date.now();

        // Current on-screen point (do not move this)
        const P = segPos(which, now);

        // Live anchor (recorded but not forced visually)
        const hasLive = !!(updated.pos && Number.isFinite(updated.pos.lat) && Number.isFinite(updated.pos.lng));
        if (hasLive) f.pos = { lat: updated.pos.lat, lng: updated.pos.lng };

        // New ETA from API (minutes from *now* to landing)
        let apiETA = Number.isFinite(updated.etaMinutes) ? updated.etaMinutes : f.etaMinutes;

        // Prevent "time being added": clamp to baseline-minus-elapsed (+tiny wiggle)
        const raceStart = S.raceStartTime || now;
        theElapsed = (now - raceStart) / 60000; // minutes
        const elapsedSinceRaceStart = theElapsed < 0 ? 0 : theElapsed;
        const originalETA = S.etaBaseline[which] ?? f.etaMinutes; // baseline at start
        const expectedRemaining = Math.max(0, originalETA - elapsedSinceRaceStart);
        const MAX_UP_MIN = 2;
        const adjustedETA = Math.min(apiETA, expectedRemaining + MAX_UP_MIN);

        // Re-anchor segment at current on-screen P with adjusted remaining ETA
        S.seg[which] = { startPos: [P[0], P[1]], startTime: now, etaAtStart: Math.max(0.01, adjustedETA) };

        // Update stored ETA
        f.etaMinutes = adjustedETA;

        // Move baseline only downward so banner clock can't add time
        if (S.etaBaselineTime == null) S.etaBaselineTime = raceStart;
        const delta = expectedRemaining - adjustedETA; // positive if we shortened
        if (delta > 0) {
          S.etaBaseline[which] = (S.etaBaseline[which] ?? originalETA) - delta;
        }

        changed = true;
      }

      if (updatedA) rebase('A', updatedA);
      if (updatedB) rebase('B', updatedB);

      if(changed) {
        renderDealt();
      }
      
      updateConnectionStatus(true);
      S._liveFetchInFlight = false;
      break; // success
      
    } catch(e) {
      attempts++;
      console.warn(`[DL] Live update attempt ${attempts} failed:`, e.message || e);
      if (attempts >= maxAttempts) {
        console.warn("[DL] All live update attempts failed, continuing with interpolation");
        updateConnectionStatus(false);
        S._liveFetchInFlight = false;
      } else {
        await new Promise(res => setTimeout(res, 1000 * attempts));
      }
    }
  }
  S._liveFetchInFlight = false;
}

/* =================== Race Animation with Live Updates =================== */
function startRaceAnimation(){
  if(!S.dealt || !S.racing) return;
  if(S._animationRunning) { console.log("[DL] Animation already running, skipping duplicate start"); return; }
  S._animationRunning = true;

  const {A,B} = S.dealt;
  let raceMs;

  if(REAL_TIME_RACING){
    raceMs = Math.min(A.etaMinutes, B.etaMinutes) * 60 * 1000;
    setLog(`LIVE RACE at ${S.airport}! Updates every 3 min. First to land wins!`);
  }else{
    raceMs = 6500;
  }

  // Ensure anchors exist (e.g., joined mid-race)
  ['A','B'].forEach(k=>{
    if (!S.seg[k]?.startPos) {
      const f = S.dealt[k];
      let start;
      if (f?.pos?.lat != null && (f.pos.lng ?? f.pos.lon) != null){
        start = [f.pos.lat, (f.pos.lng ?? f.pos.lon)];
      } else {
        const g = guessPos(f);
        start = [g[0], g[1]];
      }
      anchorSegment(k, start, f.etaMinutes, S.raceStartTime || Date.now());
    }
  });

  if (!S.raceStartTime) S.raceStartTime = Date.now();
  S.raceDuration = raceMs;

  if (!S.etaBaselineTime) {
    S.etaBaseline = { A: S.dealt.A.etaMinutes, B: S.dealt.B.etaMinutes };
    S.etaBaselineTime = S.raceStartTime;
    S._stableLeader = null; S._leaderLockUntil = 0; S._lastBannerUpdate = 0;
  }

  // Clear any existing timers to prevent duplicates
  if (S._liveTimeoutId) { clearTimeout(S._liveTimeoutId); S._liveTimeoutId = null; }
  if (S._liveIntervalId) { clearInterval(S._liveIntervalId); S._liveIntervalId = null; }
  
  // Set up new timers
  S._liveTimeoutId = setTimeout(()=>{ 
    S._liveTimeoutId = null;
    if(S.racing) updateLivePositions(); 
  }, FIRST_PING_DELAY);
  
  S.nextLiveUpdateAt = (S.lastLiveUpdateAt || S.raceStartTime) + FIRST_PING_DELAY;
  S._liveIntervalId = setInterval(()=>{ 
    if(S.racing) updateLivePositions(); 
  }, LIVE_UPDATE_INTERVAL);

  const timerEl = byId("log");
  (function step(){
    if(!S.racing){ 
      S._animationRunning = false;
      if (S._liveTimeoutId) { clearTimeout(S._liveTimeoutId); S._liveTimeoutId = null; }
      if (S._liveIntervalId) { clearInterval(S._liveIntervalId); S._liveIntervalId = null; }
      return; 
    }

    const now = Date.now();

    // Progress bars via segments
    const { t: tA, rem: remSegA } = segRemaining('A', now);
    const { t: tB, rem: remSegB } = segRemaining('B', now);
    barA.style.width = (tA*100).toFixed(1)+"%";
    barB.style.width = (tB*100).toFixed(1)+"%";

    // Plane positions (don't move already-landed markers)
    if(S.maps.A && S.maps.B){
      const dst = destLatLng();
      if (!S._landed.A) {
        const pA = segPos('A', now);
        S.maps.A.plane.setLatLng(pA);
        S.maps.A.line.setLatLngs([pA, dst]);
      }
      if (!S._landed.B) {
        const pB = segPos('B', now);
        S.maps.B.plane.setLatLng(pB);
        S.maps.B.line.setLatLngs([pB, dst]);
      }
    }

    // --- 1 Hz banner + ETA/miles (tied to segment progress) ---
    if (REAL_TIME_RACING && S.racing) {
      if (now - S._lastBannerUpdate >= 1000) {
        const baseTime = S.etaBaselineTime || S.raceStartTime || now;
        const elapsedMinSinceBase = Math.max(0, (now - baseTime) / 60000);

        // Baseline countdown from live clock
        const clockA = Math.max(0, (S.etaBaseline.A ?? 0) - elapsedMinSinceBase);
        const clockB = Math.max(0, (S.etaBaseline.B ?? 0) - elapsedMinSinceBase);

        // Segment-based remaining from the animation anchors
        const segA = segRemaining('A', now);
        const segB = segRemaining('B', now);

        // What we *show* = can't beat the dot's progress
        const showA = Math.max(segA.rem, clockA);
        const showB = Math.max(segB.rem, clockB);

        // Current positions and distances to dest
        const [dlat, dlng] = destLatLng();
        const [alat, alng] = segPos('A', now);
        const [blat, blng] = segPos('B', now);
        const distA = milesBetween(alat, alng, dlat, dlng);
        const distB = milesBetween(blat, blng, dlat, dlng);

        // --- Implied ground speed (mph), based on distance / remaining time ---
        const mphA = showA > 0 ? Math.round((distA / showA) * 60) : 0;
        const mphB = showB > 0 ? Math.round((distB / showB) * 60) : 0;

        // Update card text (show "Landed" only when truly landed)
        if (S.chosen) {
          const landedA_and = (segA.t >= 0.999) && (distA <= LANDING_MI_THRESHOLD);
          const landedB_and = (segB.t >= 0.999) && (distB <= LANDING_MI_THRESHOLD);
          
          etaA.textContent = landedA_and
            ? "Landed"
            : `ETA ${fmtClock(showA)} — ~${distA} mi · ~${mphA} mph`;

          etaB.textContent = landedB_and
            ? "Landed"
            : `ETA ${fmtClock(showB)} — ~${distB} mi · ~${mphB} mph`;
        }

        // Stabilized leader based on displayed remaining
        const rawLeader = showA < showB ? 'A' : 'B';
        const HYSTERESIS_MS = 2000;
        if (S._stableLeader == null) {
          S._stableLeader = rawLeader;
          S._leaderLockUntil = now + HYSTERESIS_MS;
        } else if (rawLeader !== S._stableLeader && now >= S._leaderLockUntil) {
          S._stableLeader = rawLeader;
          S._leaderLockUntil = now + HYSTERESIS_MS;
        }

        const lead = S._stableLeader;
        const lag  = lead === 'A' ? 'B' : 'A';
        const leadRem = lead === 'A' ? showA : showB;
        const lagRem  = lead === 'A' ? showB : showA;
        const gap = Math.max(0, lagRem - leadRem);

        const nextAt = S.nextLiveUpdateAt || (S.raceStartTime + FIRST_PING_DELAY);
        const secToNext = Math.ceil(Math.max(0, nextAt - now) / 1000);
        const mm = Math.floor(secToNext/60), ss = String(secToNext%60).padStart(2,'0');

        timerEl.textContent =
          `LIVE RACE @ ${S.airport} — Flight ${lead} leads — ETA ${fmtClock(leadRem)} ` +
          `(${lag} ${fmtClock(lagRem)}, Δ${fmtClock(gap)}) · next update in ${mm}:${ss}`;

        S._lastBannerUpdate = now;

        // Landing detection: ONLY when interpolation finished AND within threshold
        const landedA = (segA.t >= 0.999) && (distA <= LANDING_MI_THRESHOLD);
        const landedB = (segB.t >= 0.999) && (distB <= LANDING_MI_THRESHOLD);

        if (!S._landed.A && landedA) {
          S._landed.A = true;
          if (S.maps.A) {
            S.maps.A.plane.setLatLng([dlat, dlng]);
            S.maps.A.line.setLatLngs([[dlat, dlng], [dlat, dlng]]);
          }
          S.seg.A.startPos = [dlat, dlng];
          S.seg.A.startTime = now;
          S.seg.A.etaAtStart = 0;
          showKapow("LANDED", { palette: ["#40BAC6","#F2CF59","#EF2B59","#34D399"] });
          if (S.pickedBy.A) showBubble(S.pickedBy.A, "Landed!", 1500);
        }
        if (!S._landed.B && landedB) {
          S._landed.B = true;
          if (S.maps.B) {
            S.maps.B.plane.setLatLng([dlat, dlng]);
            S.maps.B.line.setLatLngs([[dlat, dlng], [dlat, dlng]]);
          }
          S.seg.B.startPos = [dlat, dlng];
          S.seg.B.startTime = now;
          S.seg.B.etaAtStart = 0;
          showKapow("LANDED", { palette: ["#40BAC6","#F2CF59","#EF2B59","#34D399"] });
          if (S.pickedBy.B) showBubble(S.pickedBy.B, "Landed!", 1500);
        }

        // Finish only when someone truly landed
        if (landedA || landedB) {
          if (S._liveTimeoutId) { clearTimeout(S._liveTimeoutId); S._liveTimeoutId = null; }
          if (S._liveIntervalId) { clearInterval(S._liveIntervalId); S._liveIntervalId = null; }
          if (seat === S.turn && !S._resolving) resolve();
          return;
        }
      }
    }

    requestAnimationFrame(step);
  })();
}

/* =================== FACES ENGINE =================== */
function showBubble(which, text, ms=1400){ 
  const el = which==="K" ? bubK : bubC; 
  if(!el) return; 
  el.textContent = text; 
  el.classList.add("show"); 
  setTimeout(()=>el.classList.remove("show"), ms); 
}
function talk(which, on=true){ 
  const M = which==="K" ? K_mouth : C_mouth; 
  if(M) M.classList.toggle("talk", on); 
}
function eyes(which, dir="center"){ 
  const dx = dir==="left"? -6 : dir==="right" ? 6 : 0; 
  const [L,R] = which==="K" ? [K_eyeL, K_eyeR] : [C_eyeL, C_eyeR]; 
  if(L&&R){ 
    L.style.transform=`translate(${dx}px,0)`; 
    R.style.transform=`translate(${dx}px,0)`; 
  } 
}
function startBlinking(){
  if(!K_eyeL||!K_eyeR||!C_eyeL||!C_eyeR) return;
  [[K_eyeL,K_eyeR],[C_eyeL,C_eyeR]].forEach(([l,r])=>{
    (function loop(){
      const delay = 1200 + Math.random()*2200;
      setTimeout(()=>{ 
        if(l&&r){ 
          l.classList.add("blink"); 
          r.classList.add("blink"); 
          setTimeout(()=>{ 
            l.classList.remove("blink"); 
            r.classList.remove("blink"); 
            loop(); 
          },120);
        } 
      }, delay);
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
  const M = ensureMap(which); if(!M) return 1;
  let pos;
  if(flight.pos?.lat != null && (flight.pos.lng ?? flight.pos.lon) != null){ 
    const lng = flight.pos.lng ?? flight.pos.lon; 
    pos = [flight.pos.lat, lng]; 
  } else { 
    pos = guessPos(flight); 
  }

  let dst;
  if(destPos?.lat != null && (destPos.lng ?? destPos.lon) != null){ 
    const lng = destPos.lng ?? destPos.lon; 
    dst=[destPos.lat, lng]; 
  } else if (AIRPORTS[flight.dest]){ 
    dst = AIRPORTS[flight.dest]; 
  } else { 
    dst = [40.6413,-73.7781]; 
  }

  M.plane.setLatLng(pos); 
  M.dest.setLatLng(dst); 
  M.line.setLatLngs([pos, dst]);
  const bounds = L.latLngBounds([pos, dst]).pad(0.35);
  M.map.fitBounds(bounds, { animate:false });

  const distKm = L.latLng(pos[0],pos[1]).distanceTo(L.latLng(dst[0],dst[1]))/1000;
  return kmToMi(distKm);
}

function guessPos(f){
  if(f.pos?.lat != null && (f.pos.lng ?? f.pos.lon) != null){ 
    const lng = f.pos.lng ?? f.pos.lon; 
    return [f.pos.lat, lng]; 
  }
  const d = AIRPORTS[f.dest] || [40.6413,-73.7781];
  const offsetLat = d[0] + (Math.random()-0.5)*0.6; 
  const offsetLng = d[1] + (Math.random()-0.5)*0.6; 
  return [offsetLat, offsetLng];
}

/* =================== Flight sources =================== */
async function liveFlights(iata){
  const url = `${LIVE_PROXY}?airport=${encodeURIComponent(iata)}&minETA=${MIN_RACE_MINUTES}`;
  const data = await fetchJSON(url, 12000);
  return data;
}

function shuffle(arr){
  const a = arr.slice();
  for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

async function findAirportAndFlights(){
  const candidates = shuffle(Object.keys(AIRPORTS));
  let lastErr = null;

  for (let i=0; i<candidates.length; i++){
    const iata = candidates[i];
    setLog(`Scanning ${iata} for two live arrivals… (${i+1}/${candidates.length})`);
    try{
      const data = await liveFlights(iata);
      // refuse any simulated response defensively
      const looksSim = data?.A?.icao24?.startsWith?.('sim') || data?.B?.icao24?.startsWith?.('sim') || data?.simulated;
      if (!looksSim && data?.A && data?.B){
        return { airport: iata, data };
      }
      await sleep(900);
    }catch(e){
      lastErr = e;
      if (/HTTP 503/.test(e.message)) {
        await sleep(1100);
      } else {
        await sleep(800);
      }
    }
  }
  throw lastErr || new Error("No airports returned two live arrivals.");
}

/* =================== HUD / Update =================== */
function updateHUD(){
  const kEl = bankK, cEl = bankC;
  kEl.textContent = fmtMoney(S.bank.K);
  cEl.textContent = fmtMoney(S.bank.C);
  kEl.className = S.bank.K > 0 ? "you" : S.bank.K < 0 ? "opp" : "zero";
  cEl.className = S.bank.C > 0 ? "you" : S.bank.C < 0 ? "opp" : "zero";

  betIn.value = S.bet;

  const strong = autoAirportPill?.querySelector("strong");
  if (strong) strong.textContent = S.airport || "—";

  if(S.bank.K >= 5000 && S.bank.C <= -5000) setLog(` ${nameOf('K').toUpperCase()} WINS THE GAME! +$5,000 vs -$5,000!`);
  else if(S.bank.C >= 5000 && S.bank.K <= -5000) setLog(` ${nameOf('C').toUpperCase()} WINS THE GAME! +$5,000 vs -$5,000!`);
}

function renderDealt(){
  const {A,B} = S.dealt;
  const originA = A.origin && A.origin !== "—" ? A.origin : "???";
  const originB = B.origin && B.origin !== "—" ? B.origin : "???";
  lineA.textContent = `A — ${originA} → ${A.dest} (${A.callsign || A.icao24 || "—"})`;
  lineB.textContent = `B — ${originB} → ${B.dest} (${B.callsign || B.icao24 || "—"})`;

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

  try{ const miA = fitAndRender('A', A, S.destPos); etaA.dataset.mi = miA; }catch(e){ console.warn("[DL] Map A render error:", e); }
  try{ const miB = fitAndRender('B', B, S.destPos); etaB.dataset.mi = miB; }catch(e){ console.warn("[DL] Map B render error:", e); }

  if (!S.chosen) {
    etaA.textContent = "ETA — (hidden until pick)";
    etaB.textContent = "ETA — (hidden until pick)";
  } else {
    // Show mph after pick using current distance / minutes
    const miA = Number(etaA.dataset.mi || 0);
    const miB = Number(etaB.dataset.mi || 0);
    const mphA = A.etaMinutes > 0 ? Math.round((miA / A.etaMinutes) * 60) : 0;
    const mphB = B.etaMinutes > 0 ? Math.round((miB / B.etaMinutes) * 60) : 0;

    etaA.textContent = `ETA ~ ${Math.round(A.etaMinutes)} min — ~${miA} mi · ~${mphA} mph`;
    etaB.textContent = `ETA ~ ${Math.round(B.etaMinutes)} min — ~${miB} mi · ~${mphB} mph`;
  }
}

/* =================== Round flow =================== */
async function deal(){
  if(S.racing) return;
  if(seat!=="K" && seat!=="C"){ showBubble("K","Join a seat to play!"); return; }

  S.bet = clamp(Number(betIn.value||MIN_BET), MIN_BET, 1e9);
  S.live = true;

  barA.style.width="0%"; barB.style.width="0%";
  lineA.textContent="Dealing…"; lineB.textContent="Dealing…";
  etaA.textContent=""; etaB.textContent="";

  showBubble("K","New round!"); showBubble("C","Let's go!");
  talk("K",true); talk("C",true); setTimeout(()=>{talk("K",false); talk("C",false);}, 900);

  setLog("Scanning airports for two live arrivals…");

  let pickedAirport, data;
  try{
    const res = await findAirportAndFlights();
    pickedAirport = res.airport;
    data = res.data;
  }catch(e){
    console.warn("[DL] Flight fetch error:", e);
    showError("No live arrivals found right now. Try again in a moment.");
    return;
  }

  S.airport = pickedAirport;
  S.destPos = data.destPos || AIRPORTS[pickedAirport] || null;

  // Strictly live
  const looksSim = data?.A?.icao24?.startsWith?.('sim') || data?.B?.icao24?.startsWith?.('sim') || data?.simulated;
  if (looksSim) { showError("Only live flights allowed; retrying another airport."); return; }

  S.dealt = { A:data.A, B:data.B };
  S.racing = false;
  S.chosen = null;
  S.roundSeed = Math.floor(Math.random()*1e9);
  S.pickedBy = {A:null, B:null};
  S.odds = null;

  S.etaBaseline = {A:null, B:null};
  S.etaBaselineTime = null;

  S._resolving = false;
  S._landed = {A:false, B:false};
  S._animationRunning = false;

  ['A','B'].forEach(k=>{
    const f = S.dealt[k];
    if (f?.pos?.lat != null && (f.pos.lng ?? f.pos.lon) != null){
      anchorSegment(k, [f.pos.lat, (f.pos.lng ?? f.pos.lon)], f.etaMinutes, Date.now());
    } else {
      const g = guessPos(f);
      anchorSegment(k, [g[0], g[1]], f.etaMinutes, Date.now());
    }
  });

  updateHUD();
  renderDealt();
  const strong = autoAirportPill?.querySelector("strong");
  if (strong) strong.textContent = S.airport;

  setLog(`Found a race at ${S.airport}. Your turn! Pick flight A or B. Opponent gets the other one.`);
  showBubble(S.turn, "My pick!");

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
  const mult = clamp(multRaw, 1.1, 2.5);

  S.odds = {A:1, B:1, long:longFlight, mult};
  S.odds[longFlight] = mult;

  S.chosen = choice;
  S.racing = true;
  S.raceStartTime = Date.now();

  S.etaBaseline = { A: S.dealt.A.etaMinutes, B: S.dealt.B.etaMinutes };
  S.etaBaselineTime = S.raceStartTime;
  S._stableLeader = null; S._leaderLockUntil = 0; S._lastBannerUpdate = 0;

  S.pickedBy.A = choice === 'A' ? S.turn : (S.turn === "K" ? "C" : "K");
  S.pickedBy.B = choice === 'B' ? S.turn : (S.turn === "K" ? "C" : "K");

  const myChoice = choice, oppChoice = choice === 'A' ? 'B' : 'A';
  const turnPlayer = nameOf(S.turn);
  const oppPlayer  = nameOf(S.turn === "K" ? "C" : "K");

  if(choice === longFlight){ showBubble(S.turn, `Longshot pays ${mult.toFixed(2)}×`, 1600); }

  setLog(`${turnPlayer} picks Flight ${myChoice}! ${oppPlayer} gets Flight ${oppChoice}. Racing for ${S.bet}${choice===longFlight ? ` (longshot pays ${mult.toFixed(2)}×)` : ""}!`);

  if(roomRef){
    try {
      await window.firebaseUpdateDoc(roomRef, {
        racing: true,
        chosen: choice,
        bet: S.bet,
        raceStartTime: S.raceStartTime,
        pickedBy: S.pickedBy,
        odds: S.odds
      });
    } catch(e) {
      console.warn("[DL] room update(start) failed:", e);
    }
  }

  renderDealt(); 
  startRaceAnimation();
}

async function resolve(){
  if (S._resolving) return;
  S._resolving = true;

  const now = Date.now();
  const baseTime = S.etaBaselineTime || S.raceStartTime || now;
  const elapsedMinSinceBase = Math.max(0, (now - baseTime) / 60000);

  // Prefer physical landing status to decide winner
  const aLanded = !!S._landed.A;
  const bLanded = !!S._landed.B;

  let winner;
  if (aLanded && !bLanded) winner = 'A';
  else if (bLanded && !aLanded) winner = 'B';
  else {
    // Fall back to displayed remaining
    const remA = Math.max(0, (S.etaBaseline.A ?? 0) - elapsedMinSinceBase);
    const remB = Math.max(0, (S.etaBaseline.B ?? 0) - elapsedMinSinceBase);
    winner = remA <= remB ? 'A' : 'B';
  }

  const turnPlayer = S.turn;
  const oppPlayer = S.turn === "K" ? "C" : "K";
  const turnChoice = S.chosen;
  const oppChoice = turnChoice === 'A' ? 'B' : 'A';

  const turnWon = (turnChoice === winner);
  const winnerSeat = turnWon ? turnPlayer : oppPlayer;
  const loserSeat  = turnWon ? oppPlayer  : turnPlayer;

  const isLongshotWin = S.odds && S.odds.long === winner &&
                        ((turnWon && turnChoice === S.odds.long) || (!turnWon && oppChoice === S.odds.long));
  const payout = Math.round(S.bet * (isLongshotWin ? (S.odds.mult || 1) : 1));

  S.bank[winnerSeat] += payout;
  S.bank[loserSeat]  -= payout;

  const winnerName = nameOf(winnerSeat);
  const loserName  = nameOf(loserSeat);
  const bonusText  = isLongshotWin ? ` (longshot ×${(S.odds.mult||1).toFixed(2)})` : "";
  setLog(`Flight ${winner} wins! ${winnerName} takes ${payout}${bonusText} from ${loserName}.`);

  // WINNER Kapow
  showKapow("WINNER!", {
    subtitle: `${winnerName} +${fmtUSD(payout)}${isLongshotWin ? " · Longshot!" : ""}`,
    palette: ["#2563EB","#FBBF24","#EF4444","#22C55E"]
  });

  try { showBubble(winnerSeat, "YES! Got it!", 1500); } catch {}
  try { showBubble(loserSeat, "Damn!", 1200); } catch {}

  try { talk(winnerSeat, true); byId(winnerSeat + "_mouth")?.classList.add("smile"); } catch {}
  setTimeout(() => {
    try { talk(winnerSeat, false); byId(winnerSeat + "_mouth")?.classList.remove("smile"); } catch {}
  }, 1500);

  try { byId(loserSeat + "_mouth")?.classList.add("frown"); eyes(loserSeat, "left"); } catch {}
  setTimeout(() => {
    try { eyes(loserSeat, "center"); byId(loserSeat + "_mouth")?.classList.remove("frown"); } catch {}
  }, 1200);

  updateHUD();
  S.racing=false;
  S.lastWinner = winner;
  S.turn = (S.turn==="K"?"C":"K");
  S.pickedBy = {A:null, B:null};
  if (S._liveTimeoutId) { clearTimeout(S._liveTimeoutId); S._liveTimeoutId = null; }
  if (S._liveIntervalId) { clearInterval(S._liveIntervalId); S._liveIntervalId = null; }
  S._animationRunning = false;

  // CHAMPION Kapow (match victory)
  const kChampion = S.bank.K >= 5000 && S.bank.C <= -5000;
  const cChampion = S.bank.C >= 5000 && S.bank.K <= -5000;
  if (kChampion || cChampion){
    const champSeat = kChampion ? "K" : "C";
    const champName = nameOf(champSeat);
    showKapow("CHAMPION!", {
      subtitle: `${champName} wins the match`,
      palette: ["#F59E0B","#FDE047","#F97316","#84CC16"],
      ms: 2000
    });
  }

  if(roomRef){
    try {
      await window.firebaseUpdateDoc(roomRef, {
        bank:S.bank, racing:false, chosen:null, lastWinner:winner, 
        turn:S.turn, pickedBy:{A:null, B:null}, odds: null
      });
    } catch(e) {
      console.warn("[DL] room update(resolve) failed:", e);
    }
  }
}

/* =================== Events =================== */
byId("A").addEventListener("click", ()=> start('A'));
byId("B").addEventListener("click", ()=> start('B'));
dealBtn.addEventListener("click", deal);

resetBtn.addEventListener("click", async ()=>{
  S.bank={K:0,C:0};
  updateHUD();
  setLog("Bank reset. First to +$5,000 (with opponent at -$5,000) wins!");
  if(roomRef){
    try {
      await window.firebaseUpdateDoc(roomRef, {bank:S.bank});
    } catch(e) {
      console.warn("[DL] room update(reset)", e);
    }
  }
});

newRoomBtn.addEventListener("click", createRoom);
copyBtn.addEventListener("click", copyInvite);

/* =================== Init =================== */
(async function init(){
  setSeatLabel(seat);
  updateHUD();
  startBlinking();

  // Load sofa art if present
  const img = new Image();
  img.onload = function() {
    const stage = byId("stage");
    const placeholder = stage?.querySelector(".stage-placeholder");
    if (placeholder) placeholder.remove();
    
    const actualImg = document.createElement("img");
    actualImg.src = "./sofawithkesslerandcajun.png";
    actualImg.alt = "Kessler and the Cajun on a sofa";
    stage?.insertBefore(actualImg, stage.firstChild);
    
    const faceSvg = stage?.querySelector(".faces");
    if(faceSvg) faceSvg.style.display = "block";
  };
  img.onerror = function() { console.warn("[DL] Could not load sofa image, using placeholder"); };
  img.src = "./sofawithkesslerandcajun.png";

  await initFirebase();
  await ensureRoom();

  setLog("Welcome to the Diplomat's Lounge. Deal flights to start.");
})();
