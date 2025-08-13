/* ================================
   Diplomat’s Club — Game Logic
   Repository: diplomats_club (GitHub Pages)
   Author: you + ChatGPT
   ================================= */

/* --------- Config --------- */
const START_YOU = 500;
const START_TEXAN = 2000;
const MIN_BET = 25;
const MAX_MINUTES = 14; // simulated ETA window (3..14 min)
const MIN_MINUTES = 3;
const ROUND_SPEED = 6500; // ms that our "race" visualization runs
const LIVE_PROXY = "YOUR_PROXY_URL/api/flights"; // <-- fill when adding live data

/* --------- State --------- */
const S = {
  you: START_YOU,
  opp: START_TEXAN,
  bet: 50,
  airport: "JFK",
  dealt: null,     // {A:{...}, B:{...}}
  chosen: null,    // 'A' or 'B'
  racing: false,
  liveMode: false
};

/* --------- DOM --------- */
const $ = sel => document.querySelector(sel);
const youCash = $("#youCash");
const oppCash = $("#oppCash");
const betAmt  = $("#betAmt");
const logEl   = $("#log");
const lineA   = $("#lineA");
const lineB   = $("#lineB");
const etaA    = $("#etaA");
const etaB    = $("#etaB");
const barA    = $("#barA");
const barB    = $("#barB");
const dealBtn = $("#deal");
const nextBtn = $("#nextRound");
const airport = $("#airport");
const betA    = $("#betA");
const betB    = $("#betB");
const liveToggle = $("#liveToggle");
const chips = [...document.querySelectorAll(".chip")];

/* --------- Utils --------- */
const cities = [
  "PIT","YYZ","ORD","DFW","MIA","ATL","DTW","BOS","IAD","LAX",
  "PHX","CLT","SEA","DEN","SFO","MSP","PHL","BNA","BWI","HOU",
  "YUL","YOW","YVR","LAS","SLC","RDU","STL","CMH","CLE","MCI"
];
const destNames = { "JFK":"New York", "EWR":"Newark", "LGA":"New York", "DEN":"Denver", "LAX":"Los Angeles" };

const fmtCash = n => "$" + n.toLocaleString();
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

function updateHUD(){
  youCash.textContent = fmtCash(S.you);
  oppCash.textContent = fmtCash(S.opp);
  betAmt.textContent  = fmtCash(S.bet);
  airport.value = S.airport;
  betA.disabled = !S.dealt || S.racing;
  betB.disabled = !S.dealt || S.racing;
  nextBtn.disabled = S.racing || !S.dealt;
}

/* --------- Flight Generation (Sim Mode) --------- */
function randomInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
function simFlights(iata){
  const pick = () => {
    const origin = cities[randomInt(0, cities.length-1)];
    const mins   = randomInt(MIN_MINUTES, MAX_MINUTES);
    const distNm = randomInt(120, 1500); // nautical miles (just for flavor)
    return {
      origin,
      dest: iata,
      etaMinutes: mins,
      distanceNm: distNm,
      callsign: `${origin}${randomInt(100, 999)}`
    };
  };
  let A = pick(), B = pick();
  // avoid two identical origins for variety
  if (B.origin === A.origin) B.origin = cities[(cities.indexOf(A.origin)+3)%cities.length];
  return { A, B };
}

/* --------- LIVE Mode adapter (serverless proxy) --------- */
/*
  Your proxy should return:
  { A: {origin, dest, etaMinutes, distanceNm, callsign},
    B: {origin, dest, etaMinutes, distanceNm, callsign} }
*/
async function liveFlights(iata){
  const url = `${LIVE_PROXY}?airport=${encodeURIComponent(iata)}`;
  const r = await fetch(url, { cache:"no-store" });
  if(!r.ok) throw new Error("Live proxy failed");
  return await r.json();
}

/* --------- Round Flow --------- */
function setLog(t){ logEl.textContent = t; }

async function deal(){
  if (S.racing) return;
  S.airport = (airport.value || "JFK").toUpperCase();
  lineA.textContent = "Dealing flights…";
  lineB.textContent = "Dealing flights…";
  etaA.textContent = ""; etaB.textContent = "";
  barA.style.width = "0%"; barB.style.width = "0%";
  setLog("Picking two in-air arrivals…");

  try{
    S.dealt = S.liveMode ? await liveFlights(S.airport) : simFlights(S.airport);
  }catch(e){
    console.warn(e);
    S.dealt = simFlights(S.airport);
    setLog("Live Mode unavailable. Using simulated flights this round.");
  }

  const d = S.dealt;
  lineA.textContent = `A — ${d.A.origin} → ${d.A.dest}  (${d.A.callsign})`;
  lineB.textContent = `B — ${d.B.origin} → ${d.B.dest}  (${d.B.callsign})`;
  const destName = destNames[d.A.dest] || d.A.dest;
  etaA.textContent = `ETA ~ ${d.A.etaMinutes} min to ${destName}`;
  etaB.textContent = `ETA ~ ${d.B.etaMinutes} min to ${destName}`;

  S.chosen = null;
  updateHUD();
  setLog("Choose Flight A or B, then watch the race.");
}

function adjustBet(delta){
  if(delta === 0){ // ALL-IN
    S.bet = Math.min(S.you, S.opp); updateHUD(); return;
  }
  S.bet = clamp(S.bet + Number(delta), MIN_BET, Math.min(S.you, S.opp));
  updateHUD();
}

function startRace(choice){
  if(!S.dealt) return;
  S.chosen = choice; S.racing = true;
  betA.disabled = betB.disabled = true; nextBtn.disabled = true;
  setLog(`You bet ${fmtCash(S.bet)} on Flight ${choice}. Wheels up…`);

  // convert ETA to animation rate
  const d = S.dealt;
  const etaAms = Math.max(1, d.A.etaMinutes);
  const etaBms = Math.max(1, d.B.etaMinutes);
  const totalMs = ROUND_SPEED; // normalized visual duration

  const start = performance.now();
  function tick(now){
    const t = now - start;
    const pA = clamp(t / (totalMs * (etaAms / (etaAms + etaBms))), 0, 1);
    const pB = clamp(t / (totalMs * (etaBms / (etaAms + etaBms))), 0, 1);
    barA.style.width = (pA*100).toFixed(1) + "%";
    barB.style.width = (pB*100).toFixed(1) + "%";

    if(pA < 1 || pB < 1){
      requestAnimationFrame(tick);
    }else{
      resolveRound();
    }
  }
  requestAnimationFrame(tick);
}

function resolveRound(){
  const d = S.dealt;
  const winner = d.A.etaMinutes === d.B.etaMinutes
    ? (Math.random()<.5 ? 'A':'B')
    : (d.A.etaMinutes < d.B.etaMinutes ? 'A':'B');

  const youWon = (S.chosen === winner);
  if(youWon){
    S.you += S.bet;
    S.opp -= S.bet;
    setLog(`WIN! Flight ${winner} landed first. You won ${fmtCash(S.bet)}.`);
  }else{
    S.you -= S.bet;
    S.opp += S.bet;
    setLog(`Lost. Flight ${winner} beat your pick. You lost ${fmtCash(S.bet)}.`);
  }
  S.bet = clamp(S.bet, MIN_BET, Math.min(S.you, S.opp));
  S.racing = false;
  updateHUD();

  if(S.you <= 0){
    setLog("Broke! The Texan walks away grinning. Refresh to try again.");
    dealBtn.disabled = betA.disabled = betB.disabled = nextBtn.disabled = true;
  }else if(S.opp <= 0){
    setLog("YOU CLEANED HIM OUT! The Texan tips his hat in defeat.");
    dealBtn.disabled = betA.disabled = betB.disabled = nextBtn.disabled = true;
  }else{
    nextBtn.disabled = false;
  }
}

/* --------- Wire UI --------- */
dealBtn.addEventListener("click", deal);
nextBtn.addEventListener("click", deal);
betA.addEventListener("click", () => startRace('A'));
betB.addEventListener("click", () => startRace('B'));
chips.forEach(c => c.addEventListener("click", () => adjustBet(Number(c.dataset.add))));
airport.addEventListener("change", () => { S.airport = airport.value.toUpperCase(); });
liveToggle.addEventListener("change", e => {
  S.liveMode = e.target.checked;
  setLog(S.liveMode ? "Live Mode ON — requires proxy. If unavailable, sim will auto-fallback." : "Live Mode OFF — using simulated flights.");
});

updateHUD();
setLog("Welcome to the Diplomat’s Club. Hit ‘Deal Flights’.");
