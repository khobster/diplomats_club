/* Diplomat’s Club — sprite-free UI (SVG avatars), simpler + snappier */

/* ========= Configure this once you deploy your Lambda proxy ========= */
const LIVE_PROXY = "YOUR_API_GATEWAY_URL"; // e.g., https://abc123.execute-api.us-east-1.amazonaws.com
/* =================================================================== */

const START_YOU = 500;
const START_TEXAN = 2000;
const ROUND_MS = 6500;
const MIN_BET = 25;

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
const charK=$("#charK"), charT=$("#charT");
const bubbleK=$("#bubbleK"), bubbleT=$("#bubbleT");
const sofa=$("#sofa");

/* ------- Utils ------- */
const fmtCash = n => "$"+n.toLocaleString();
const clamp = (v,lo,hi)=> Math.max(lo, Math.min(hi, v));
const setLog = t => log.textContent = t;
const chantFrom = code => `C’mon ${code.toUpperCase()}, let’s go!`;

function updateHUD(){
  youCash.textContent = fmtCash(S.you);
  oppCash.textContent = fmtCash(S.opp);
  betIn.value = S.bet;
  airport.value = S.airport;
  dealBtn.disabled = (S.you<=0 || S.opp<=0);
}

function showBubble(el, text, ms=1500){
  el.textContent = text;
  el.classList.add("show");
  const id = setTimeout(()=>el.classList.remove("show"), ms);
  return ()=>clearTimeout(id);
}
function leanOn(){ charK.classList.add("lean"); charT.classList.add("lean"); }
function leanOff(){ charK.classList.remove("lean"); charT.classList.remove("lean"); }
function pump(el){ el.classList.add("pump"); setTimeout(()=>el.classList.remove("pump"), 1100); }
function slump(el){ el.classList.add("slump"); setTimeout(()=>el.classList.remove("slump"), 900); }
function shake(el){ el.classList.add("shake"); setTimeout(()=>el.classList.remove("shake"), 450); }

/* ------- Flight sources ------- */
function simFlights(iata){
  const cities=["PIT","YYZ","ORD","DFW","MIA","ATL","DTW","BOS","IAD","LAX","SEA","DEN","SFO","PHX","CLT","MSP","PHL","BNA","BWI","HOU","LAS","SLC","RDU","STL","CMH","CLE","MCI","AUS","SAN","SMF"];
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
  [lineA,lineB].forEach(el=>el.textContent="Dealing…");
  [etaA,etaB].forEach(el=>el.textContent="");
  barA.style.width="0%"; barB.style.width="0%";
  cardA.classList.remove("selected"); cardB.classList.remove("selected");

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

  showBubble(bubbleK, "New action!");
  showBubble(bubbleT, "Name your flight!");
  updateHUD();
  setLog("Click A or B to place your bet (winner takes all).");
}

function start(choice){
  if(!S.dealt||S.racing) return;
  S.bet = clamp(Number(betIn.value||MIN_BET), MIN_BET, Math.min(S.you,S.opp));
  S.chosen=choice; S.racing=true;

  const pick = choice === 'A' ? S.dealt.A : S.dealt.B;
  cardA.classList.toggle("selected", choice==='A');
  cardB.classList.toggle("selected", choice==='B');

  showBubble(bubbleK, chantFrom(pick.origin), 1800);
  leanOn();
  setLog(`You bet ${fmtCash(S.bet)} on Flight ${choice}.`);

  const {A,B}=S.dealt, a=A.etaMinutes, b=B.etaMinutes, total=ROUND_MS;
  const t0=performance.now();
  const Ams = total * (a/(a+b)), Bms = total * (b/(a+b));

  function step(now){
    const t=now-t0;
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

  leanOff();

  if(youWon){
    S.you+=S.bet; S.opp-=S.bet;
    setLog(`WIN! Flight ${winner} first — ${fmtCash(S.bet)} to you.`);
    pump(charK); slump(charT); shake(sofa);
    showBubble(bubbleK, "YES!", 900);
    showBubble(bubbleT, "Dang.", 900);
  }else{
    S.you-=S.bet; S.opp+=S.bet;
    setLog(`Lost. Flight ${winner} beat your pick — ${fmtCash(S.bet)} to the Cajun.`);
    pump(charT); slump(charK); shake(sofa);
    showBubble(bubbleT, "HA!", 900);
    showBubble(bubbleK, "Nooo!", 900);
  }
  S.bet = clamp(S.bet, MIN_BET, Math.min(S.you,S.opp));
  S.racing=false; updateHUD();

  if(S.you<=0){ setLog("Busted! Refresh to try again."); }
  if(S.opp<=0){ setLog("You cleaned him out! The Cajun tips his hat."); }
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
setLog("Welcome to the Diplomat’s Club. Deal flights to start.");
