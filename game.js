/* Diplomat’s Club — simplified UI + always-on portraits */

const LIVE_PROXY = "YOUR_API_GATEWAY_URL/proxy"; // set after Lambda deploy
const START_YOU = 500, START_TEXAN = 2000;
const ROUND_MS = 6500;
const MIN_BET = 25;

const S = {
  you: START_YOU, opp: START_TEXAN,
  bet: 50, airport: "JFK",
  dealt: null, racing: false, chosen: null, live:false
};

const $ = s => document.querySelector(s);
const youCash=$("#youCash"), oppCash=$("#oppCash"), log=$("#log");
const lineA=$("#lineA"), lineB=$("#lineB"), etaA=$("#etaA"), etaB=$("#etaB");
const barA=$("#barA"), barB=$("#barB");
const dealBtn=$("#deal"), resetBtn=$("#reset"), airport=$("#airport"), betIn=$("#betIn");
const cardA=$("#A"), cardB=$("#B"), liveToggle=$("#liveToggle");
const sprK=$("#sprK"), sprT=$("#sprT");

function fmtCash(n){ return "$"+n.toLocaleString(); }
function clamp(v,lo,hi){ return Math.max(lo, Math.min(hi, v)); }
function setLog(t){ log.textContent=t; }

function updateHUD(){
  youCash.textContent = fmtCash(S.you);
  oppCash.textContent = fmtCash(S.opp);
  betIn.value = S.bet;
  airport.value = S.airport;
}

function setSpritesIdle(){
  // Set your sheet files here (4 frames, 96x96 each, laid out horizontally)
  sprK.style.backgroundImage = "url('./sprites/kessler_idle.png')";
  sprT.style.backgroundImage = "url('./sprites/cajun_idle.png')";
  sprK.classList.add("animate-frames"); sprT.classList.add("animate-frames");
}
function talk(which=true){
  // Swap to talk sheets briefly
  sprK.style.backgroundImage = "url('./sprites/kessler_talk.png')";
  sprT.style.backgroundImage = "url('./sprites/cajun_talk.png')";
  setTimeout(setSpritesIdle, which? 900: 700);
}
function cheer(win){ win.classList.add("cheer"); setTimeout(()=>win.classList.remove("cheer"), 1200); }
function sad(lose){ lose.classList.add("sad"); setTimeout(()=>lose.classList.remove("sad"), 1200); }

function simFlights(iata){
  const cities=["PIT","YYZ","ORD","DFW","MIA","ATL","DTW","BOS","IAD","LAX","SEA","DEN","SFO","PHX","CLT","MSP","PHL","BNA","BWI","HOU"];
  const r=(a,b)=>Math.floor(Math.random()*(b-a+1))+a;
  const p=()=>({origin:cities[r(0,cities.length-1)],dest:iata,etaMinutes:r(3,14),callsign:`${iata}${r(100,999)}`});
  let A=p(),B=p(); if(B.origin===A.origin) B.origin=cities[(cities.indexOf(A.origin)+3)%cities.length];
  return {A,B};
}

async function liveFlights(iata){
  const url = `${LIVE_PROXY}?airport=${encodeURIComponent(iata)}`;
  const r = await fetch(url, {cache:"no-store"});
  if(!r.ok) throw new Error("proxy failed");
  return await r.json(); // {A:{origin,dest,etaMinutes,callsign}, B:{...}}
}

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
  const start=performance.now();
  const Ams = total * (a/(a+b)), Bms = total * (b/(a+b));

  function step(now){
    const t=now-start;
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
  if(youWon){ S.you+=S.bet; S.opp-=S.bet; setLog(`WIN! Flight ${winner} first — ${fmtCash(S.bet)} to you.`); cheer(document.querySelector('.char.kessler')); sad(document.querySelector('.char.cajun')); }
  else     { S.you-=S.bet; S.opp+=S.bet; setLog(`Lost. Flight ${winner} beat your pick — ${fmtCash(S.bet)} to the Cajun.`); cheer(document.querySelector('.char.cajun')); sad(document.querySelector('.char.kessler')); }
  S.bet = clamp(S.bet, MIN_BET, Math.min(S.you,S.opp));
  S.racing=false; updateHUD();
  if(S.you<=0){ setLog("Busted! Refresh to try again."); }
  if(S.opp<=0){ setLog("You cleaned him out! The Cajun tips his giant hat."); }
}

dealBtn.addEventListener("click", deal);
resetBtn.addEventListener("click", ()=>{ Object.assign(S,{you:START_YOU,opp:START_TEXAN,bet:50}); updateHUD(); setLog("Bank reset."); });
cardA.addEventListener("click", ()=> start('A'));
cardB.addEventListener("click", ()=> start('B'));
airport.addEventListener("change", ()=> S.airport=airport.value.toUpperCase());
betIn.addEventListener("change", ()=> S.bet=clamp(Number(betIn.value||MIN_BET),MIN_BET,Math.min(S.you,S.opp)));
liveToggle.addEventListener("change", e=>{ S.live=e.target.checked; setLog(S.live?"LIVE mode ON (via Lambda)":"Simulated mode"); });

updateHUD(); setSpritesIdle();
