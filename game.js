/* Diplomat’s Club — portraits stay still on idle; animate only while “talking” */

/* ========= Configure this once you deploy your Lambda proxy ========= */
const LIVE_PROXY = "YOUR_API_GATEWAY_URL"; // e.g., https://abc123.execute-api.us-east-1.amazonaws.com
/* =================================================================== */

const START_YOU = 500;
const START_TEXAN = 2000;
const ROUND_MS = 6500;
const MIN_BET = 25;

/* Root-level sprite files (384x96 PNGs, 4 frames horizontally) */
const ASSET = {
  k_idle: "./kessler_idle.png",
  k_talk: "./kessler_talk.png",
  c_idle: "./cajun_idle.png",
  c_talk: "./cajun_talk.png",
};

const S = {
  you: START_YOU, opp: START_TEXAN,
  bet: 50, airport: "JFK",
  dealt: null, racing: false, chosen: null, live:false
};

/* ------- DOM ------- */
const $ = s => document.querySelector(s);
const youCash=$("#youCash"), oppCash=$("#oppCash"), log=$("#log");
const lineA=$("#lineA"), lineB=$("#lineB"), etaA=$("#etaA"), etaB=$("#etaB");
const barA=$("#barA"), barB=$("#barB");
const dealBtn=$("#deal"), resetBtn=$("#reset"), airport=$("#airport"), betIn=$("#betIn");
const cardA=$("#A"), cardB=$("#B"), liveToggle=$("#liveToggle");
const sprK=$("#sprK"), sprT=$("#sprT");

/* ------- Utils ------- */
const fmtCash = n => "$"+n.toLocaleString();
const clamp = (v,lo,hi)=> Math.max(lo, Math.min(hi, v));
const setLog = t => log.textContent = t;

function updateHUD(){
  youCash.textContent = fmtCash(S.you);
  oppCash.textContent = fmtCash(S.opp);
  betIn.value = S.bet;
  airport.value = S.airport;
  if (S.you<=0 || S.opp<=0){
    dealBtn.disabled = true;
  }
}

/* ------- Sprites ------- */
function setSpritesIdle(){
  // Still portraits (no frame cycling)
  sprK.style.backgroundImage = `url(${ASSET.k_idle})`;
  sprT.style.backgroundImage = `url(${ASSET.c_idle})`;
  sprK.style.backgroundPosition = "0px 0px";
  sprT.style.backgroundPosition = "0px 0px";
  sprK.classList.remove("animate-frames");
  sprT.classList.remove("animate-frames");
}
function talk(){
  // Turn on animation only during the talk burst
  sprK.style.backgroundImage = `url(${ASSET.k_talk})`;
  sprT.style.backgroundImage = `url(${ASSET.c_talk})`;
  sprK.style.backgroundPosition = "0px 0px";
  sprT.style.backgroundPosition = "0px 0px";
  sprK.classList.add("animate-frames");
  sprT.classList.add("animate-frames");
  setTimeout(setSpritesIdle, 900);
}
function cheer(el){ el.classList.add("cheer"); setTimeout(()=>el.classList.remove("cheer"), 1200); }
function sad(el){ el.classList.add("sad"); setTimeout(()=>el.classList.remove("sad"), 1200); }

/* ------- Flight sources ------- */
function simFlights(iata){
  const cities=["PIT","YYZ","ORD","DFW","MIA","ATL","DTW","BOS","IAD","LAX","SEA","DEN","SFO","PHX","CLT","MSP","PHL","BNA","BWI","HOU","LAS","SLC","RDU","STL"];
  const r=(a,b)=>Math.floor(Math.random()*(b-a+1))+a;
  const p=()=>({origin:cities[r(0,cities.length-1)],dest:iata,etaMinutes:r(3,14),callsign:`${iata}${r(100,999)}`});
  let A=p(),B=p(); if(B.origin===A.origin) B.origin=cities[(cities.indexOf(A.origin)+3)%cities.length];
  return {A,B};
}
async function liveFlights(iata){
  if(!LIVE_PROXY || LIVE_PROXY.includes("YOUR_API_GATEWAY_URL")) throw new Error("Live proxy not configured");
  const url = `${LIVE_PROXY}?airport=${encodeURIComponent(iata)}`;
  const r = await fetch(url, {cache:"no-store"});
  if(!r.ok) throw new Error("proxy failed");
  return await r.json(); // {A:{origin,dest,etaMinutes,callsign}, B:{...}}
}

/* ------- Round flow ------- */
async function deal(){
  if(S.racing) return;
  S.airport = (airport.value||"JFK").toUpperCase();
  lineA.textContent="Dealing…"; lineB.textContent="Dealing…"; etaA.textContent=""; etaB.textContent="";
  barA.style.width="0%"; barB.style.width="0%";
  setLog(S.live? "Pulling two inbound real flights…" : "Drawing two simulated inbound flights…");
  try{
    S.dealt = S.live ? await liveFlights(S.airport) : simFlights(S.airport);
  }catch(e){
    console.warn(e); S.dealt = simFlights(S.airport);
    setLog("Live unavailable—using simulated flights this round.");
  }
  const d=S.dealt;
  lineA.textContent=`A — ${d.A.origin} → ${d.A.dest} (${d.A.callsign})`;
  lineB.textContent=`B — ${d.B.origin} → ${d.B.dest} (${d.B.callsign})`;
  etaA.textContent=`ETA ~ ${d.A.etaMinutes} min`; etaB.textContent=`ETA ~ ${d.B.etaMinutes} min`;
  setSpritesIdle(); talk(); updateHUD();
  setLog("Tap A or B to place your bet (winner takes all).");
}

function start(choice){
  if(!S.dealt||S.racing) return;
  S.bet = clamp(Number(betIn.value||MIN_BET), MIN_BET, Math.min(S.you,S.opp));
  S.chosen=choice; S.racing=true; setLog(`You bet ${fmtCash(S.bet)} on Flight ${choice}.`);

  const {A,B}=S.dealt, a=A.etaMinutes, b=B.etaMinutes, total=ROUND_MS;
  const startT=performance.now();
  const Ams = total * (a/(a+b)), Bms = total * (b/(a+b));

  function step(now){
    const t=now-startT;
    barA.style.width = Math.min(100, (t/Ams)*100).toFixed(1)+"%";
    barB.style.width = Math.min(100, (t/Bms)*100).toFixed(1)+"%";
    if(t<Ams || t<Bms) requestAnimationFrame(step);
    else resolve();
  }
  requestAnimationFrame(step);
}

function resolve(){
  const {A,B}=S.dealt;
  const winner = (A.etaMinutes===B.etaMinutes) ? (Math.random()<.5?'A':'B') : (A.etaMinutes<B.etaMinutes?'A':'B');
  const youWon = (S.chosen===winner);

  if(youWon){
    S.you+=S.bet; S.opp-=S.bet;
    setLog(`WIN! Flight ${winner} first — ${fmtCash(S.bet)} to you.`);
    cheer(document.querySelector('.char.kessler')); sad(document.querySelector('.char.cajun'));
  }else{
    S.you-=S.bet; S.opp+=S.bet;
    setLog(`Lost. Flight ${winner} beat your pick — ${fmtCash(S.bet)} to the Cajun.`);
    cheer(document.querySelector('.char.cajun')); sad(document.querySelector('.char.kessler'));
  }
  S.bet = clamp(S.bet, MIN_BET, Math.min(S.you,S.opp));
  S.racing=false; updateHUD();

  if(S.you<=0){ setLog("Busted! Refresh to try again."); }
  if(S.opp<=0){ setLog("You cleaned him out! The Cajun tips his giant hat."); }
}

/* ------- Events ------- */
dealBtn.addEventListener("click", deal);
resetBtn.addEventListener("click", ()=>{ Object.assign(S,{you:START_YOU,opp:START_TEXAN,bet:50}); updateHUD(); setLog("Bank reset."); });
cardA.addEventListener("click", ()=> start('A'));
cardB.addEventListener("click", ()=> start('B'));
airport.addEventListener("change", ()=> S.airport=airport.value.toUpperCase());
betIn.addEventListener("change", ()=> S.bet=clamp(Number(betIn.value||MIN_BET),MIN_BET,Math.min(S.you,S.opp)));
liveToggle.addEventListener("change", e=>{ S.live=e.target.checked; setLog(S.live?"LIVE mode ON (via Lambda)":"Simulated mode"); });

/* Init */
updateHUD();
setSpritesIdle();
setLog("Welcome to the Diplomat’s Club. Hit ‘Deal flights’."); 
