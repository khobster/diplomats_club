/* Diplomat's Lounge — Fixed version with proper Firebase integration */

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
        bank: {K:500, C:2000},
        airport:"JFK", bet:50, live:false,
        dealt:null, destPos:null,
        racing:false, turn:"K", chosen:null, roundSeed:null, lastWinner:null
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
    
    updateHUD();
    if(S.dealt) renderDealt();
    
    if(S.racing) {
      setLog("Round in progress…");
    } else if(S.dealt) {
      setLog(S.turn === seat ? "Your turn! Pick A or B." : "Waiting for other player...");
    } else {
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
const ROUND_MS = 6500, MIN_BET = 25;
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
function showBubble(which, text, ms=1400){
  const el = which==="K" ? bubK : bubC;
  if(!el) return;
  el.textContent = text;
  el.classList.add("show");
  setTimeout(()=>el.classList.remove("show"), ms);
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
  
  const pos = guessPos(flight);
  const dst = destPos || (AIRPORTS[flight.dest] || AIRPORTS[S.airport] || [40.6413,-73.7781]);
  
  M.plane.setLatLng(pos);
  M.dest.setLatLng(dst);
  M.line.setLatLngs([pos, dst]);
  
  const bounds = L.latLngBounds([pos, dst]).pad(0.35);
  M.map.fitBounds(bounds, { animate:false });
  
  const distKm = L.latLng(pos[0],pos[1]).distanceTo(L.latLng(dst[0],dst[1]))/1000;
  return Math.max(1, Math.round(distKm));
}

function guessPos(f){
  const o = AIRPORTS[f.origin], d = AIRPORTS[f.dest];
  if(!o || !d) return AIRPORTS[S.airport] || [40.6413,-73.7781];
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

  showBubble("K","New action!");
  showBubble("C","Name your flight!");

  setLog(S.live? "Pulling two inbound real flights…" : "Drawing two simulated inbound flights…");
  
  let data;
  try {
    data = S.live ? await liveFlights(S.airport) : simFlights(S.airport);
  } catch(e) {
    console.warn("[DL] Flight fetch error:", e);
    data = simFlights(S.airport);
    setLog("Live unavailable—using simulated flights this round.");
  }

  const destPos = data.destPos || AIRPORTS[S.airport] || null;
  S.dealt = { A:data.A, B:data.B };
  S.destPos = destPos;
  S.racing = false;
  S.chosen = null;
  S.roundSeed = Math.floor(Math.random()*1e9);

  renderDealt();
  setLog(S.turn === seat ? "Your turn! Click A or B to place your bet." : "Waiting for other player to choose...");

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
  if(S.turn!==seat){ 
    showBubble(seat,"Hold—other player's turn");
    return;
  }

  S.bet = clamp(Number(betIn.value||MIN_BET), MIN_BET, Math.min(S.bank.K, S.bank.C));
  S.chosen = choice;
  S.racing = true;

  setLog(`${seat==="K"?"Kessler":"Cajun"} bets ${fmtSirig(S.bet)} on Flight ${choice}.`);

  // Start the race animation
  const {A,B} = S.dealt;
  const a=A.etaMinutes, b=B.etaMinutes, total=ROUND_MS;
  const Ams = total * (a/(a+b)), Bms = total * (b/(a+b));
  const t0 = performance.now();
  
  (function step(now){
    const t = now - t0;
    barA.style.width = Math.min(100, (t/Ams)*100).toFixed(1)+"%";
    barB.style.width = Math.min(100, (t/Bms)*100).toFixed(1)+"%";
    if(t<Ams || t<Bms) {
      requestAnimationFrame(step);
    } else {
      resolve();
    }
  })(performance.now());

  if(roomRef){
    try {
      await window.firebaseUpdateDoc(roomRef, {
        racing: true,
        chosen: choice
      });
    } catch(e) {
      console.warn("[DL] room update(start) failed:", e);
    }
  }
}

async function resolve(){
  const {A,B}=S.dealt;
  const tie = (A.etaMinutes===B.etaMinutes);
  const winner = tie ? (S.roundSeed % 2 ? 'A' : 'B') : (A.etaMinutes<B.etaMinutes?'A':'B');

  const youPicked = S.chosen;
  const youWon = (youPicked===winner);

  const me = seat;
  const opp = seat==="K" ? "C" : "K";

  if(youWon){
    S.bank[me]+=S.bet;
    S.bank[opp]-=S.bet;
    setLog(`WIN! Flight ${winner} arrived first — ${fmtSirig(S.bet)} to ${me==="K"?"Kessler":"Cajun"}.`);
    showBubble(me,"YES!", 900);
  }else{
    S.bank[me]-=S.bet;
    S.bank[opp]+=S.bet;
    setLog(`Lost. Flight ${winner} beat your pick — ${fmtSirig(S.bet)} to ${opp==="K"?"Kessler":"Cajun"}.`);
    showBubble(opp,"Ha!", 900);
  }

  bankK.textContent = fmtSirig(S.bank.K);
  bankC.textContent = fmtSirig(S.bank.C);
  S.racing=false;
  S.lastWinner = winner;
  S.turn = (S.turn==="K"?"C":"K");
  
  if(S.bank.K<=0) setLog("Kessler is busted!");
  if(S.bank.C<=0) setLog("The Cajun is busted!");

  if(roomRef){
    try {
      await window.firebaseUpdateDoc(roomRef, {
        bank:S.bank, racing:false, chosen:null, lastWinner:winner, turn:S.turn
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
  S.bank={K:500,C:2000};
  bankK.textContent=fmtSirig(S.bank.K);
  bankC.textContent=fmtSirig(S.bank.C);
  setLog("Bank reset.");
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
