async function resolve(){
  const {A,B}=S.dealt;
  const tie = (A.etaMinutes===B.etaMinutes);
  const winner = tie ? (S.roundSeed % 2 ? 'A' : 'B') : (A.etaMinutes/* Diplomat's Lounge — Fixed version with proper Firebase integration */

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

/* Helpers */
function randomCode(n=6){ 
  const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; 
  return Array.from({length:n},()=>a[Math.floor(Math.random()*a.length)]).join(''); 
}

function currentUrlWithRoom(id){ 
  const u=new URL(location.href); 
  u.searchParams.set("room", id); 
  return u.toString(); 
}

function setSeatLabel(s){ 
  seatName.textContent = s==="K"?"Kessler":(s==="C"?"Cajun":"Solo"); 
}

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
  // Wait for Firebase to be loaded
  let attempts = 0;
  while(!window.firebaseDb && attempts < 50) {
    await new Promise(resolve => setTimeout(resolve, 100));
    attempts++;
  }
  
  if(!window.firebaseDb) {
    console.error("[DL] Firebase not loaded after 5 seconds");
    disableRooms("Firebase failed to load. Check your connection.");
    return false;
  }
  
  db = window.firebaseDb;
  console.log("[DL] Firebase initialized successfully");
  
  // Test connection
  try {
    const testDoc = window.firebaseDoc(db, "_probe", "test");
    await window.firebaseSetDoc(testDoc, { timestamp: Date.now() });
    console.log("[DL] Firebase connection test successful");
    return true;
  } catch(e) {
    console.error("[DL] Firebase connection test failed:", e);
    if(e.code === 'permission-denied') {
      showError("Firebase permission denied. Check Firestore rules.");
    } else {
      showError("Firebase connection failed. Try disabling ad-blockers.");
    }
    disableRooms("Firebase connection blocked");
    return false;
  }
}

function disableRooms(reason){
  newRoomBtn.disabled = true;
  copyBtn.disabled = true;
  console.warn("[DL] Rooms disabled:", reason);
}

/* -------- Rooms -------- */
async function ensureRoom(){
  if(!db) {
    const initialized = await initFirebase();
    if(!initialized) return null;
  }
  
  const url = new URL(location.href);
  roomId = url.searchParams.get("room");
  if(!roomId) return null;

  roomRef = window.firebaseDoc(db, "rooms", roomId);

  // Check if room exists
  let snap = null;
  try { 
    snap = await window.firebaseGetDoc(roomRef); 
  } catch(e) { 
    console.error("[DL] room get failed:", e); 
    showError("Failed to get room. Check your connection.");
    return null;
  }
  
  // Create room if it doesn't exist
  if(!snap || !snap.exists()){
    try{
      await window.firebaseSetDoc(roomRef, {
        createdAt: Date.now(),
        seats: {K:"", C:""},
        bank: {K:0, C:0},  // Start at 0
        airport:"JFK", bet:50, live:false,
        dealt:null, destPos:null,
        racing:false, turn:"K", chosen:null, roundSeed:null, lastWinner:null,
        pickedBy: {A:null, B:null}
      });
      console.log("[DL] Room created:", roomId);
    } catch(e) { 
      console.error("[DL] room create failed:", e); 
      showError("Failed to create room. Check Firestore permissions.");
      return null;
    }
  }

  // Claim a seat
  const myId = "anon-"+Math.random().toString(36).slice(2,8);
  try {
    const claim = await window.firebaseRunTransaction(db, async (tx) => {
      const dSnap = await tx.get(roomRef);
      const d = dSnap.data() || {};
      let pick = (d.seats?.K) ? ((d.seats?.C) ? "Solo" : "C") : "K";
      if(pick !== "Solo"){
        const seats = {...(d.seats||{})};
        seats[pick] = myId;
        tx.update(roomRef, {seats});
      }
      return pick;
    });
    seat = claim;
    setSeatLabel(seat);
    seatPill.title = `Room: ${roomId}`;
    console.log("[DL] Claimed seat:", seat);
  } catch(e) {
    console.error("[DL] seat claim failed:", e);
    showError("Failed to claim seat. Try again.");
  }

  // Set up live listener
  if (unsubRoom) unsubRoom();
  unsubRoom = window.firebaseOnSnapshot(roomRef, (doc) => {
    const D = doc.data();
    if(!D) return;
    
    const wasRacing = S.racing;
    const oldChosen = S.chosen;
    
    // Merge remote state to local
    S.bank = {...D.bank};
    S.airport = D.airport;
    S.bet = D.bet;
    S.live = D.live;
    S.dealt = D.dealt ? {...D.dealt} : null;
    S.destPos = D.destPos || null;
    S.racing = D.racing;
    S.turn = D.turn;
    S.chosen = D.chosen;
    S.roundSeed = D.roundSeed;
    S.lastWinner = D.lastWinner;
    S.raceStartTime = D.raceStartTime || null;
    S.pickedBy = D.pickedBy || {A:null, B:null};
    
    updateHUD();
    if(S.dealt) renderDealt();
    
    // If racing just started (racing is true, wasn't before, and chosen is set)
    if(S.racing && (!wasRacing || S.chosen !== oldChosen)) {
      const turnPlayer = S.turn === "K" ? "Kessler" : "Cajun";
      const oppPlayer = S.turn === "K" ? "Cajun" : "Kessler";
      const oppChoice = S.chosen === 'A' ? 'B' : 'A';
      
      // Show who picked what
      if(seat === S.turn) {
        setLog(`You picked Flight ${S.chosen}! ${oppPlayer} gets Flight ${oppChoice}. Racing for ${S.bet}!`);
      } else {
        setLog(`${turnPlayer} picked Flight ${S.chosen}! You get Flight ${oppChoice}. Racing for ${S.bet}!`);
      }
      
      // Start the race animation for everyone
      startRaceAnimation();
      
    } else if(S.racing) {
      // Race already in progress, maybe we reconnected
      if(S.raceStartTime) {
        // Resume the animation from where it should be
        startRaceAnimation();
      }
    } else if(S.dealt && !S.racing) {
      // Flights dealt, waiting for pick
      if(S.turn === seat) {
        setLog(`Your turn! Pick flight A or B. Your opponent gets the other one.`);
      } else {
        const turnPlayer = S.turn === "K" ? "Kessler" : "Cajun";
        setLog(`Waiting for ${turnPlayer} to pick a flight...`);
      }
    } else if(!S.dealt) {
      setLog("Deal flights to start.");
    }
  }, (err) => {
    console.error("[DL] room snapshot error:", err);
    showError("Lost connection to room. Try reloading.");
  });

  return roomRef;
}

async function createRoom(){
  if(!db) {
    const initialized = await initFirebase();
    if(!initialized) {
      alert("Cannot create room. Firebase is not available.");
      return;
    }
  }
  
  try {
    const id = randomCode(6);
    const newRoomRef = window.firebaseDoc(db, "rooms", id);
    
    await window.firebaseSetDoc(newRoomRef, {
      createdAt: Date.now(),
      seats: {K:"", C:""},
      bank: {K:500, C:2000},
      airport:"JFK", bet:50, live:false,
      dealt:null, destPos:null,
      racing:false, turn:"K", chosen:null, roundSeed:null, lastWinner:null
    });
    
    history.replaceState(null, "", currentUrlWithRoom(id));
    toast(`Room created: ${id}`);
    console.log("[DL] New room created:", id);
    await ensureRoom();
  } catch(e) {
    console.error("[DL] createRoom error:", e);
    showError("Failed to create room. Check your connection.");
  }
}

async function copyInvite(){
  if(!roomId) await createRoom();
  if(!roomId) return;
  
  const u = currentUrlWithRoom(roomId);
  try {
    await navigator.clipboard.writeText(u);
    toast("Invite link copied!");
  } catch(e) {
    console.error("[DL] clipboard error:", e);
    prompt("Copy this link:", u);
  }
}

/* =================== UI/DOM refs =================== */
const lineA = byId("lineA"), lineB = byId("lineB");
const etaA = byId("etaA"), etaB = byId("etaB");
const barA = byId("barA"), barB = byId("barB");
const mapA = byId("mapA"), mapB = byId("mapB");
const dealBtn = byId("deal"), resetBtn = byId("reset");
const airportIn = byId("airport"), betIn = byId("betIn"), liveToggle = byId("liveToggle");
const bankK = byId("bankK"), bankC = byId("bankC");
const bubK = byId("bubK"), bubC = byId("bubC");

/* ===== Sofa face nodes ===== */
const K_eyeL = byId("K_eyeL"), K_eyeR = byId("K_eyeR"), K_mouth = byId("K_mouth");
const C_eyeL = byId("C_eyeL"), C_eyeR = byId("C_eyeR"), C_mouth = byId("C_mouth");

/* =================== Core Config =================== */
const MIN_BET = 25;
// REAL-TIME RACING with live updates!
const REAL_TIME_RACING = true; 
const LIVE_UPDATE_INTERVAL = 3 * 60 * 1000; // Update every 3 minutes (conservative for API limits)
const MIN_RACE_MINUTES = 15; // Prefer flights at least 15 minutes out for better drama
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
  bank: {K:0, C:0},  // Start at 0 for both players
  airport: "JFK",
  bet: 50, live:false,
  dealt: null, destPos:null,
  maps: {A:null, B:null},
  racing:false, chosen:null, roundSeed:null, lastWinner:null,
  turn:"K",
  raceStartTime: null,
  raceDuration: null,
  pickedBy: {A:null, B:null}  // Track who picked which flight
};

/* =================== Utilities =================== */
const fmtMoney = (n)=> {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${Math.abs(n).toLocaleString()}`;
};
const clamp = (v,lo,hi)=> Math.max(lo, Math.min(hi, v));

/* =================== Live Flight Updates =================== */
async function updateLivePositions() {
  if(!S.racing || !S.dealt || !S.live) return;
  
  console.log("[DL] Fetching live position updates...");
  
  try {
    // Call Lambda to get current positions
    const url = `${LIVE_PROXY}?airport=${encodeURIComponent(S.airport)}&tracking=true`;
    const r = await fetch(url, {cache:"no-store"});
    if(!r.ok) throw new Error("Live update failed");
    const data = await r.json();
    
    // Try to match our flights with updated positions
    const flightA = S.dealt.A;
    const flightB = S.dealt.B;
    
    // Look for our flights in the new data by callsign
    let updatedA = null, updatedB = null;
    
    // Check if response has tracking data
    if(data.tracked) {
      updatedA = data.tracked.find(f => f.callsign === flightA.callsign);
      updatedB = data.tracked.find(f => f.callsign === flightB.callsign);
    } else {
      // Fallback: check regular A/B if tracking endpoint isn't working
      if(data.A && data.A.callsign === flightA.callsign) updatedA = data.A;
      if(data.B && data.B.callsign === flightB.callsign) updatedB = data.B;
    }
    
    // Update positions and ETAs if we found the flights
    let updated = false;
    if(updatedA && updatedA.pos) {
      S.dealt.A.pos = updatedA.pos;
      S.dealt.A.etaMinutes = updatedA.etaMinutes;
      console.log(`[DL] Flight A updated: ETA ${updatedA.etaMinutes} min`);
      updated = true;
      
      // Show a notification about the update
      showBubble("K", `Flight A: ${updatedA.etaMinutes} min!`, 2000);
    }
    
    if(updatedB && updatedB.pos) {
      S.dealt.B.pos = updatedB.pos;
      S.dealt.B.etaMinutes = updatedB.etaMinutes;
      console.log(`[DL] Flight B updated: ETA ${updatedB.etaMinutes} min`);
      updated = true;
      
      showBubble("C", `Flight B: ${updatedB.etaMinutes} min!`, 2000);
    }
    
    if(updated) {
      // Re-render the flight info
      renderDealt();
      
      // Update Firebase with new positions
      if(roomRef) {
        await window.firebaseUpdateDoc(roomRef, {
          dealt: S.dealt
        }).catch(e => console.warn("[DL] Failed to sync live updates:", e));
      }
    }
    
  } catch(e) {
    console.warn("[DL] Live position update failed:", e);
    // Continue with interpolated positions
  }
}

/* =================== Race Animation with Live Updates =================== */
function startRaceAnimation() {
  if(!S.dealt || !S.racing) return;
  
  const {A,B} = S.dealt;
  let a = A.etaMinutes, b = B.etaMinutes;
  
  // Calculate initial race duration
  let raceMs;
  if(REAL_TIME_RACING) {
    const winnerMinutes = Math.min(a, b);
    raceMs = winnerMinutes * 60 * 1000;
    setLog(`LIVE RACE! Updates every 3 min. First to land wins!`);
  } else {
    raceMs = 6500; // Quick mode for testing
  }
  
  S.raceStartTime = Date.now();
  S.raceDuration = raceMs;
  
  // Set up live position updates if in real-time mode
  let updateInterval = null;
  if(REAL_TIME_RACING && S.live) {
    // First update after 1 minute, then every 3 minutes
    setTimeout(() => updateLivePositions(), 60000);
    updateInterval = setInterval(() => updateLivePositions(), LIVE_UPDATE_INTERVAL);
  }
  
  const timerEl = byId("log");
  
  // Animate progress bars and planes
  (function step(){
    if(!S.racing) {
      // Race ended, clean up
      if(updateInterval) clearInterval(updateInterval);
      return;
    }
    
    const elapsed = Date.now() - S.raceStartTime;
    
    // Get current ETAs (might have been updated)
    const currentA = S.dealt.A.etaMinutes;
    const currentB = S.dealt.B.etaMinutes;
    
    // Calculate progress based on current ETAs
    const progressA = Math.min(100, (elapsed / (currentA * 60 * 1000)) * 100);
    const progressB = Math.min(100, (elapsed / (currentB * 60 * 1000)) * 100);
    
    barA.style.width = progressA.toFixed(1)+"%";
    barB.style.width = progressB.toFixed(1)+"%";
    
    // Update map positions
    if(S.maps.A && S.maps.B) {
      // If we have live positions, use them directly
      if(S.dealt.A.pos) {
        const pos = S.dealt.A.pos;
        S.maps.A.plane.setLatLng([pos.lat, pos.lng || pos.lon]);
      } else {
        updatePlanePosition('A', progressA/100);
      }
      
      if(S.dealt.B.pos) {
        const pos = S.dealt.B.pos;
        S.maps.B.plane.setLatLng([pos.lat, pos.lng || pos.lon]);
      } else {
        updatePlanePosition('B', progressB/100);
      }
    }
    
    // Show time remaining
    if(REAL_TIME_RACING && S.racing) {
      const leadFlight = currentA < currentB ? 'A' : 'B';
      const leadETA = Math.min(currentA, currentB);
      const minRemaining = Math.max(0, leadETA - (elapsed / 60000));
      const seconds = Math.floor((minRemaining % 1) * 60);
      const minutes = Math.floor(minRemaining);
      timerEl.textContent = `LIVE RACE - Flight ${leadFlight} leads - ETA: ${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    
    // Check if someone has landed (100% progress)
    if(progressA >= 100 || progressB >= 100) {
      if(updateInterval) clearInterval(updateInterval);
      if(seat === S.turn) {
        resolve();
      }
    } else {
      requestAnimationFrame(step);
    }
  })();
}

function updatePlanePosition(which, progress) {
  const M = S.maps[which];
  if(!M) return;
  
  const flight = S.dealt[which];
  let startPos;
  
  // Get starting position
  if(flight.pos && flight.pos.lat && (flight.pos.lng || flight.pos.lon)) {
    const lng = flight.pos.lng || flight.pos.lon;
    startPos = [flight.pos.lat, lng];
  } else {
    startPos = guessPos(flight);
  }
  
  // Get destination
  let destPos;
  if(S.destPos && S.destPos.lat && (S.destPos.lng || S.destPos.lon)) {
    const lng = S.destPos.lng || S.destPos.lon;
    destPos = [S.destPos.lat, lng];
  } else if(AIRPORTS[flight.dest]) {
    destPos = AIRPORTS[flight.dest];
  } else {
    destPos = [40.6413,-73.7781]; // JFK default
  }
  
  // Interpolate position based on progress
  const currentLat = startPos[0] + (destPos[0] - startPos[0]) * progress;
  const currentLng = startPos[1] + (destPos[1] - startPos[1]) * progress;
  
  // Update plane marker position
  M.plane.setLatLng([currentLat, currentLng]);
}
function showBubble(which, text, ms=1400){
  const el = which==="K" ? bubK : bubC;
  if(!el) return;
  el.textContent = text;
  el.classList.add("show");
  setTimeout(()=>el.classList.remove("show"), ms);
}

/* Talk animation */
function talk(which, on=true){
  const M = which==="K" ? K_mouth : C_mouth;
  if(M) M.classList.toggle("talk", on);
}

/* Eye movement */
function eyes(which, dir="center"){
  const dx = dir==="left"? -6 : dir==="right" ? 6 : 0;
  const [L,R] = which==="K" ? [K_eyeL, K_eyeR] : [C_eyeL, C_eyeR];
  if(L && R) {
    L.style.transform = `translate(${dx}px,0)`;
    R.style.transform = `translate(${dx}px,0)`;
  }
}

/* Blink loop */
function startBlinking(){
  if(!K_eyeL || !K_eyeR || !C_eyeL || !C_eyeR) return;
  
  const pairs = [[K_eyeL, K_eyeR],[C_eyeL, C_eyeR]];
  pairs.forEach(([l,r])=>{
    (function loop(){
      const delay = 1200 + Math.random()*2200;
      setTimeout(()=>{
        if(l && r) {
          l.classList.add("blink");
          r.classList.add("blink");
          setTimeout(()=>{ 
            l.classList.remove("blink");
            r.classList.remove("blink");
            loop();
          }, 120);
        }
      }, delay);
    })();
  });
}

/* =================== Maps =================== */
function ensureMap(which){
  if(S.maps[which]) return S.maps[which];
  const el = which==='A' ? mapA : mapB;
  
  try {
    const m = L.map(el, { zoomControl:false, attributionControl:false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 15 }).addTo(m);
    const plane = L.circleMarker([0,0], { radius:6, color:'#0077ff', fillColor:'#3ab8ff', fillOpacity:.9 }).addTo(m);
    const dest = L.circleMarker([0,0], { radius:5, color:'#111827', fillColor:'#111827', fillOpacity:1 }).addTo(m);
    const line = L.polyline([], { color:'#0ea5e9', weight:3, opacity:.9 }).addTo(m);
    const group = L.featureGroup([plane, dest, line]).addTo(m);
    S.maps[which] = { map:m, plane, dest, line, group };
    return S.maps[which];
  } catch(e) {
    console.error("[DL] Map init failed:", e);
    return null;
  }
}

function fitAndRender(which, flight, destPos){
  const M = ensureMap(which);
  if(!M) return 100;
  
  // Get plane position - use actual pos if available from live data
  let pos;
  if(flight.pos && flight.pos.lat && (flight.pos.lng || flight.pos.lon)) {
    const lng = flight.pos.lng || flight.pos.lon;
    pos = [flight.pos.lat, lng];
  } else {
    pos = guessPos(flight);
  }
  
  // Get destination position
  let dst;
  if(destPos && destPos.lat && (destPos.lng || destPos.lon)) {
    const lng = destPos.lng || destPos.lon;
    dst = [destPos.lat, lng];
  } else if(AIRPORTS[flight.dest]) {
    dst = AIRPORTS[flight.dest];
  } else if(AIRPORTS[S.airport]) {
    dst = AIRPORTS[S.airport];
  } else {
    dst = [40.6413,-73.7781]; // JFK default
  }
  
  M.plane.setLatLng(pos);
  M.dest.setLatLng(dst);
  M.line.setLatLngs([pos, dst]);
  
  const bounds = L.latLngBounds([pos, dst]).pad(0.35);
  M.map.fitBounds(bounds, { animate:false });
  
  const distKm = L.latLng(pos[0],pos[1]).distanceTo(L.latLng(dst[0],dst[1]))/1000;
  return Math.max(1, Math.round(distKm));
}

function guessPos(f){
  // If flight has actual position data from API, use it
  if(f.pos && f.pos.lat && (f.pos.lng || f.pos.lon)) {
    const lng = f.pos.lng || f.pos.lon;
    return [f.pos.lat, lng];
  }
  
  // Otherwise try to interpolate between origin and dest
  const o = AIRPORTS[f.origin], d = AIRPORTS[f.dest];
  if(!o || !d) {
    // If we don't know origin, place plane near destination but not at it
    if(d) {
      // Place it about 100km out from destination
      const offsetLat = d[0] + (Math.random() - 0.5) * 0.9;
      const offsetLng = d[1] + (Math.random() - 0.5) * 0.9;
      return [offsetLat, offsetLng];
    }
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
    return {origin, dest:iata, etaMinutes:r(3,14), callsign:`${iata}${r(100,999)}`};
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
  // Update bank displays with color coding
  const kEl = byId("bankK");
  const cEl = byId("bankC");
  
  kEl.textContent = fmtMoney(S.bank.K);
  cEl.textContent = fmtMoney(S.bank.C);
  
  // Color code based on value
  kEl.className = S.bank.K > 0 ? "you" : S.bank.K < 0 ? "opp" : "zero";
  cEl.className = S.bank.C > 0 ? "you" : S.bank.C < 0 ? "opp" : "zero";
  
  betIn.value = S.bet;
  airportIn.value = S.airport;
  liveToggle.checked = S.live;
  dealBtn.disabled = !!(S.racing) || (seat!=="K" && seat!=="C");
  
  // Check for win condition
  if(S.bank.K >= 5000 && S.bank.C <= -5000) {
    setLog("🎉 KESSLER WINS THE GAME! +$5,000 vs -$5,000!");
  } else if(S.bank.C >= 5000 && S.bank.K <= -5000) {
    setLog("🎉 CAJUN WINS THE GAME! +$5,000 vs -$5,000!");
  }
}

function renderDealt(){
  const {A,B} = S.dealt;
  
  // For live flights, origin might be "—" so we show what we have
  const originA = A.origin !== "—" ? A.origin : "???";
  const originB = B.origin !== "—" ? B.origin : "???";
  
  lineA.textContent = `A — ${originA} → ${A.dest} (${A.callsign})`;
  lineB.textContent = `B — ${originB} → ${B.dest} (${B.callsign})`;
  etaA.textContent = `ETA ~ ${A.etaMinutes} min`;
  etaB.textContent = `ETA ~ ${B.etaMinutes} min`;
  
  // Show who picked what with visual indicators
  const cardA = byId("A");
  const cardB = byId("B");
  
  // Remove old badges
  cardA.querySelectorAll('.picker-badge').forEach(b => b.remove());
  cardB.querySelectorAll('.picker-badge').forEach(b => b.remove());
  cardA.className = "card";
  cardB.className = "card";
  
  if(S.pickedBy.A) {
    cardA.className = `card picked-${S.pickedBy.A.toLowerCase()}`;
    const badge = document.createElement('div');
    badge.className = `picker-badge ${S.pickedBy.A.toLowerCase()}`;
    badge.textContent = S.pickedBy.A === "K" ? "Kessler's" : "Cajun's";
    cardA.appendChild(badge);
  }
  
  if(S.pickedBy.B) {
    cardB.className = `card picked-${S.pickedBy.B.toLowerCase()}`;
    const badge = document.createElement('div');
    badge.className = `picker-badge ${S.pickedBy.B.toLowerCase()}`;
    badge.textContent = S.pickedBy.B === "K" ? "Kessler's" : "Cajun's";
    cardB.appendChild(badge);
  }
  
  try {
    const da = fitAndRender('A', A, S.destPos);
    etaA.textContent += ` — ~${da} km`;
  } catch(e) {
    console.warn("[DL] Map A render error:", e);
  }
  
  try {
    const db = fitAndRender('B', B, S.destPos);
    etaB.textContent += ` — ~${db} km`;
  } catch(e) {
    console.warn("[DL] Map B render error:", e);
  }
}

/* =================== Round flow =================== */
async function deal(){
  if(S.racing) return;
  if(seat!=="K" && seat!=="C"){
    showBubble("K","Join a seat to play!");
    return;
  }
  
  S.airport = (airportIn.value||"JFK").toUpperCase();
  S.bet = clamp(Number(betIn.value||MIN_BET), MIN_BET, Math.min(S.bank.K, S.bank.C));
  S.live = liveToggle.checked;
  
  barA.style.width="0%";
  barB.style.width="0%";
  lineA.textContent="Dealing…";
  lineB.textContent="Dealing…";
  etaA.textContent="";
  etaB.textContent="";

  // Character reactions
  showBubble("K","New round!");
  showBubble("C","Let's go!");
  talk("K",true);
  talk("C",true);
  setTimeout(()=>{talk("K",false); talk("C",false);}, 900);

  setLog(S.live? "Finding real flights (preferring 15+ min ETAs for drama)…" : "Drawing two simulated inbound flights…");
  
  let data;
  try {
    if(S.live) {
      // Request flights with minimum ETA preference
      const url = `${LIVE_PROXY}?airport=${encodeURIComponent(S.airport)}&minETA=${MIN_RACE_MINUTES}`;
      const r = await fetch(url, {cache:"no-store"});
      if(!r.ok) throw new Error("proxy failed");
      data = await r.json();
      
      // Check if we got good flights with decent ETAs
      if(data.A && data.B) {
        const minETA = Math.min(data.A.etaMinutes, data.B.etaMinutes);
        if(minETA < 10) {
          console.log("[DL] Flights too close, using simulated for better gameplay");
          data = simFlights(S.airport);
          // Make sure simulated flights are far enough out
          data.A.etaMinutes = 15 + Math.floor(Math.random() * 30);
          data.B.etaMinutes = 20 + Math.floor(Math.random() * 35);
          setLog("Live flights too close to airport—using simulated flights for longer race.");
        }
      }
    } else {
      data = simFlights(S.airport);
      // Make simulated flights interesting distances
      data.A.etaMinutes = 15 + Math.floor(Math.random() * 30);
      data.B.etaMinutes = 20 + Math.floor(Math.random() * 35);
    }
  } catch(e) {
    console.warn("[DL] Flight fetch error:", e);
    data = simFlights(S.airport);
    data.A.etaMinutes = 15 + Math.floor(Math.random() * 30);
    data.B.etaMinutes = 20 + Math.floor(Math.random() * 35);
    setLog("Live unavailable—using simulated flights.");
  }

  const destPos = data.destPos || AIRPORTS[S.airport] || null;
  S.dealt = { A:data.A, B:data.B };
  S.destPos = destPos;
  S.racing = false;
  S.chosen = null;
  S.roundSeed = Math.floor(Math.random()*1e9);

  renderDealt();
  
  // Show whose turn it is
  const turnPlayer = S.turn === "K" ? "Kessler" : "Cajun";
  if(S.turn === seat) {
    setLog(`${turnPlayer}'s turn! Pick flight A or B. Your opponent gets the other one.`);
    showBubble(S.turn, "My pick!");
  } else {
    setLog(`Waiting for ${turnPlayer} to pick a flight...`);
  }

  if(roomRef){
    try {
      await window.firebaseUpdateDoc(roomRef, {
        airport:S.airport, bet:S.bet, live:S.live,
        dealt:S.dealt, destPos:S.destPos,
        racing:false, chosen:null, roundSeed:S.roundSeed, lastWinner:null
      });
    } catch(e) {
      console.warn("[DL] room update(deal) failed:", e);
    }
  }
}

async function start(choice){
  if(!S.dealt || S.racing) return;
  if(seat!=="K" && seat!=="C"){ 
    showBubble("K","Join a seat to play!");
    return;
  }
  
  // Only the player whose turn it is can pick
  if(S.turn!==seat){ 
    return;
  }

  // Calculate dynamic bet based on ETA difference (reward for picking longshot)
  const {A,B} = S.dealt;
  const etaDiff = Math.abs(A.etaMinutes - B.etaMinutes);
  const longerFlight = A.etaMinutes > B.etaMinutes ? 'A' : 'B';
  const baseBet = Number(betIn.value || 50);
  
  // If you pick the longer ETA flight, you get bonus multiplier
  let finalBet = baseBet;
  if(choice === longerFlight && etaDiff > 5) {
    const multiplier = 1 + (etaDiff / 20); // Up to 2x for 20+ min difference
    finalBet = Math.round(baseBet * multiplier);
    showBubble(S.turn, `Longshot bonus! ${multiplier.toFixed(1)}x`);
  }
  
  S.bet = finalBet;
  S.chosen = choice;
  S.racing = true;
  S.raceStartTime = Date.now();
  
  // Track who picked what
  S.pickedBy.A = choice === 'A' ? S.turn : (S.turn === "K" ? "C" : "K");
  S.pickedBy.B = choice === 'B' ? S.turn : (S.turn === "K" ? "C" : "K");
  
  // Current player gets their choice, opponent gets the other
  const myChoice = choice;
  const oppChoice = choice === 'A' ? 'B' : 'A';
  const turnPlayer = S.turn === "K" ? "Kessler" : "Cajun";
  const oppPlayer = S.turn === "K" ? "Cajun" : "Kessler";
  
  setLog(`${turnPlayer} picks Flight ${myChoice}! ${oppPlayer} gets Flight ${oppChoice}. Racing for ${finalBet}!`);
  
  // Character reactions - more expressive
  eyes(S.turn, choice === 'A' ? "left" : "right");
  talk(S.turn, true);
  byId(S.turn + "_mouth").classList.add("smile");
  setTimeout(()=>{
    eyes(S.turn, "center");
    talk(S.turn, false);
    byId(S.turn + "_mouth").classList.remove("smile");
  }, 1200);

  // Update Firebase so both players see the race
  if(roomRef){
    try {
      await window.firebaseUpdateDoc(roomRef, {
        racing: true,
        chosen: choice,
        bet: finalBet,
        raceStartTime: S.raceStartTime,
        pickedBy: S.pickedBy
      });
    } catch(e) {
      console.warn("[DL] room update(start) failed:", e);
    }
  }
  
  // Re-render to show who picked what
  renderDealt();
  
  // Start the race animation for the picker
  startRaceAnimation();
}

async function resolve(){
  const {A,B}=S.dealt;
  const tie = (A.etaMinutes===B.etaMinutes);
  const winner = tie ? (S.roundSeed % 2 ? 'A' : 'B') : (A.etaMinutes<B.etaMinutes?'A':'B');

  // Figure out who picked what
  const turnPlayer = S.turn; // Who picked this round
  const oppPlayer = S.turn === "K" ? "C" : "K";
  const turnChoice = S.chosen;
  const oppChoice = S.chosen === 'A' ? 'B' : 'A';
  
  // Who won?
  const turnWon = (turnChoice === winner);
  const winnerPlayer = turnWon ? turnPlayer : oppPlayer;
  const loserPlayer = turnWon ? oppPlayer : turnPlayer;

  // Update banks
  S.bank[winnerPlayer] += S.bet;
  S.bank[loserPlayer] -= S.bet;
  
  // Announce results
  const winnerName = winnerPlayer === "K" ? "Kessler" : "Cajun";
  const loserName = loserPlayer === "K" ? "Kessler" : "Cajun";
  setLog(`Flight ${winner} wins! ${winnerName} takes ${S.bet} from ${loserName}.`);
  
  // Character reactions - more expressive
  showBubble(winnerPlayer, "YES! Got it!", 1500);
  showBubble(loserPlayer, "Damn!", 1200);
  
  // Winner celebrates
  talk(winnerPlayer, true);
  byId(winnerPlayer + "_mouth").classList.add("smile");
  setTimeout(() => {
    talk(winnerPlayer, false);
    byId(winnerPlayer + "_mouth").classList.remove("smile");
  }, 1500);
  
  // Loser reacts
  byId(loserPlayer + "_mouth").classList.add("frown");
  eyes(loserPlayer, "left");
  setTimeout(() => {
    eyes(loserPlayer, "center");
    byId(loserPlayer + "_mouth").classList.remove("frown");
  }, 1200);

  updateHUD();
  S.racing=false;
  S.lastWinner = winner;
  S.turn = (S.turn==="K"?"C":"K"); // Alternate turns
  S.pickedBy = {A:null, B:null}; // Reset picks
  
  // Check win conditions
  if(S.bank.K >= 5000 && S.bank.C <= -5000) {
    setLog("🎉 KESSLER WINS THE GAME! +$5,000 vs -$5,000! 🎉");
    showBubble("K", "I'm the champion!", 3000);
    showBubble("C", "Good game!", 3000);
  } else if(S.bank.C >= 5000 && S.bank.K <= -5000) {
    setLog("🎉 CAJUN WINS THE GAME! +$5,000 vs -$5,000! 🎉");
    showBubble("C", "Victory is mine!", 3000);
    showBubble("K", "Well played!", 3000);
  }

  if(roomRef){
    try {
      await window.firebaseUpdateDoc(roomRef, {
        bank:S.bank, racing:false, chosen:null, lastWinner:winner, 
        turn:S.turn, pickedBy:{A:null, B:null}
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
  S.bank={K:0,C:0}; // Reset to 0
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

airportIn.addEventListener("change", async ()=>{
  S.airport=airportIn.value.toUpperCase();
  if(roomRef) {
    try {
      await window.firebaseUpdateDoc(roomRef, {airport:S.airport});
    } catch(e) {
      console.warn("[DL] airport update failed:", e);
    }
  }
});

betIn.addEventListener("change", async ()=>{
  S.bet=clamp(Number(betIn.value||MIN_BET),MIN_BET,Math.min(S.bank.K,S.bank.C));
  if(roomRef) {
    try {
      await window.firebaseUpdateDoc(roomRef, {bet:S.bet});
    } catch(e) {
      console.warn("[DL] bet update failed:", e);
    }
  }
});

liveToggle.addEventListener("change", async e=>{
  S.live=e.target.checked;
  setLog(S.live?"LIVE mode ON (via Lambda)":"Simulated mode");
  if(roomRef) {
    try {
      await window.firebaseUpdateDoc(roomRef, {live:S.live});
    } catch(e) {
      console.warn("[DL] live toggle update failed:", e);
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
  
  // Try to load the image
  const img = new Image();
  img.onload = function() {
    const stage = byId("stage");
    const placeholder = stage.querySelector(".stage-placeholder");
    if(placeholder) placeholder.remove();
    
    const actualImg = document.createElement("img");
    actualImg.src = "./sofawithkesslerandcajun.png";
    actualImg.alt = "Kessler and the Cajun on a sofa";
    stage.insertBefore(actualImg, stage.firstChild);
    
    // Show the faces SVG
    const faceSvg = stage.querySelector(".faces");
    if(faceSvg) faceSvg.style.display = "block";
  };
  img.onerror = function() {
    console.warn("[DL] Could not load sofa image, using placeholder");
  };
  img.src = "./sofawithkesslerandcajun.png";
  
  // Initialize Firebase and rooms
  await initFirebase();
  await ensureRoom();
  
  setLog("Welcome to the Diplomat's Lounge. Deal flights to start.");
})();
