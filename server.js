const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static("public"));
app.get("/health", (_, res) => res.json({ ok: true }));
const rooms = new Map();
const matchmakingQueue = [];
const ROLES = {
 시민:{team:"good"}, 의사:{team:"good"}, 경찰:{team:"good"}, 판사:{team:"good"},
 국회의원:{team:"good"}, 기자:{team:"good"}, 자경단:{team:"good"}, 제사장:{team:"good"},
 마피아:{team:"evil"}, 스파이:{team:"evil"}, 클러쳐:{team:"evil"}, 선교사:{team:"evil"},
 궁정광대:{team:"solo"}
};
const clean = s => String(s || "").replace(/[<>]/g,"").replace(/[\x00-\x1F\x7F]/g,"").trim().slice(0,18);
const cleanMessage = s => String(s || "").replace(/[<>]/g,"").replace(/[\x00-\x1F\x7F]/g,"").trim().slice(0,160);
function roomCode(){ return crypto.randomBytes(3).toString("hex").toUpperCase(); }
function emitRoom(r){ io.to(r.code).emit("state", publicState(r)); }
function revealedRole(p){ return p.role==="클러쳐" ? "시민" : p.role; }
function publicState(r){
 return {code:r.code,phase:r.phase,day:r.day,aiMode:!!r.aiMode,serverNow:Date.now(),players:[...r.players.values()].map(p=>({id:p.id,name:p.name,alive:p.alive,role:!p.alive&&p.team==="evil"?revealedRole(p):null})),host:r.host,endsAt:r.endsAt,log:r.log.slice(-30),winner:r.winner};
}
function viewFor(r,p){
 const st=publicState(r); st.me={id:p.id,name:p.name,role:p.role,alive:p.alive,team:p.team,joined:p.joined,isPresident:p.id===r.presidentId,canVote:p.alive&&r.phase==="day_vote",hasVoted:!!r.votes[p.id],reporterUsed:p.used?.reporterDay===r.day,judgeUsed:p.used?.judgeDay===r.day,vigilanteInspectUsed:p.used?.vigilanteInspectDay===r.day,vigilanteTargetId:p.used?.vigilanteTarget||null,policeUsed:p.used?.policeNight===r.day,spyUsed:p.used?.spyNight===r.day,vigilanteTargetId:p.used?.vigilanteTarget||null,lastAbility:p.lastAbility||null};
 st.players=[...r.players.values()].map(x=>({id:x.id,name:x.name,alive:x.alive,role:!x.alive&&x.team==="evil"?revealedRole(x):(x.id===p.id?x.role:null)}));
 st.teamChatAllowed=!!(p.alive&&p.team==="evil"&&p.joined);
 return st;
}
function sendState(r){ for(const p of r.players.values()) io.to(p.id).emit("state",viewFor(r,p)); }
function log(r,msg){r.log.push({day:r.day,text:msg}); if(r.log.length>100)r.log.shift();}
function alive(r){return [...r.players.values()].filter(p=>p.alive);}
function assign(r){
 const n=r.players.size;
 const roles=[];
 const mafiaCount=Math.min(3,Math.max(1,Math.floor(n/5)));
 for(let i=0;i<mafiaCount;i++)roles.push("마피아");
 const evilExtras=[["스파이",8],["클러쳐",12],["선교사",14]];
 for(const [role,minPlayers] of evilExtras){
  if(n>=minPlayers&&roles.filter(x=>ROLES[x].team==="evil").length<3)roles.push(role);
 }
 roles.push("궁정광대");
 const goodRoles=["의사","경찰","판사","국회의원","기자","자경단","제사장"];
 while(roles.length<n){
  if(Math.random()<0.20)roles.push("시민");
  else roles.push(goodRoles[Math.floor(Math.random()*goodRoles.length)]);
 }
 for(let i=roles.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[roles[i],roles[j]]=[roles[j],roles[i]];}
 [...r.players.values()].forEach((p,i)=>{p.role=roles[i];p.team=ROLES[p.role].team;p.alive=true;p.joined=p.role==="마피아";p.used={};p.viewerId=p.id;});
 r.phase="day_discuss";r.day=1;r.actions={};r.votes={};r.endsAt=Date.now()+60000;r.botChatCount=0;r.nextBotChatAt=Date.now()+3000;
 log(r,"게임 시작! 낮 1일차 토론이 시작되었습니다.");
}
function joinedEvil(p){return p.team==="evil"&&p.joined&&p.alive;}
function endCheck(r){
 const a=alive(r), evil=a.filter(p=>p.team==="evil").length, good=a.filter(p=>p.team==="good").length;
 if(!a.length)return "무승부";
 if(evil===0)return "선량한 팀";
 if(evil>=good)return "악인 팀";
 return null;
}
function finish(r,w){r.phase="ended";r.winner=w;r.endsAt=null;log(r,w+" 승리!");sendState(r);}
function botChoose(r,arr=[]){return Array.isArray(arr)&&arr.length?arr[Math.floor(Math.random()*arr.length)]:null;}
function recordAbility(p,r,t,label){p.lastAbility={label,targetName:t.name,day:r.day,phase:r.phase};}
const BOT_DISCUSSION_LINES=[
 "일단 서로 얘기 좀 들어보고 판단하자.",
 "아직 단서가 부족한 것 같은데 다른 사람 의견은?",
 "첫날이라 정보가 없네. 말투나 반응을 잘 보자.",
 "무작정 몰아가지는 말고 근거를 말해 줘.",
 "나는 지금은 조금 더 토론해 보는 게 좋겠어.",
 "방금 말한 내용이 좀 걸리는데 이유를 설명해 줄래?",
 "다들 너무 조용한데 한 명씩 의견 내보자.",
 "지금은 확신하기 어려워. 투표 전까지 더 들어볼게."
];
function scheduleBotDiscussion(r){
 if(!r.aiMode||r.phase!=="day_discuss")return;
 if(!r.botChatCount)r.botChatCount=0;
 if(!r.nextBotChatAt)r.nextBotChatAt=Date.now()+2500+Math.floor(Math.random()*2500);
 if(Date.now()<r.nextBotChatAt||r.botChatCount>=5)return;
 const bots=alive(r).filter(p=>p.isBot);
 if(!bots.length)return;
 const bot=botChoose(r,bots);
 const message=BOT_DISCUSSION_LINES[Math.floor(Math.random()*BOT_DISCUSSION_LINES.length)];
 io.to(r.code).emit("chat",{name:bot.name,text:message,team:false});
 r.botChatCount++;
 r.nextBotChatAt=Date.now()+4500+Math.floor(Math.random()*5000);
}
function runBotNight(r){
 if(!r.aiMode)return;
 const living=alive(r), bots=living.filter(p=>p.isBot);
 for(const b of bots){
  const others=living.filter(p=>p.id!==b.id);
  if(!others.length)continue;
  if(b.role==="마피아"&&!Object.values(r.actions).some(x=>x.type==="attack")){const t=botChoose(r,others.filter(x=>x.team!=="evil"));if(t)r.actions["attack:"+b.id]={type:"attack",actor:b.id,target:t.id};}
  if(b.role==="의사"){const t=botChoose(r,others);if(t)r.actions["heal:"+b.id]={type:"heal",actor:b.id,target:t.id};}
  if(b.role==="자경단"){if(b.used.vigilanteTarget){const t=r.players.get(b.used.vigilanteTarget);if(t?.alive)r.actions["vigilante:"+b.id]={type:"vigilante",actor:b.id,target:t.id};}else{const t=botChoose(r,others);if(t){b.used.vigilanteTarget=t.id;b.used.vigilanteInvestigatedDay=r.day;}}}
  if(b.role==="선교사"&&!b.used.convert){const t=botChoose(r,others.filter(x=>x.team==="good"));if(t)r.actions["convert:"+b.id]={type:"convert",actor:b.id,target:t.id};}
  if(b.role==="제사장"&&!b.used.revive){const t=botChoose(r,[...r.players.values()].filter(x=>!x.alive));if(t)r.actions["revive:"+b.id]={type:"revive",actor:b.id,target:t.id};}
 }
}

const NIGHT_TURNS=[
 {role:"마피아",phase:"night_mafia"},
 {role:"자경단",phase:"night_vigilante"},
 {role:"선교사",phase:"night_missionary"},
 {role:"경찰",phase:"night_police"},
 {role:"스파이",phase:"night_spy"},
 {role:"의사",phase:"night_doctor"},
 {role:"제사장",phase:"night_priest"}
];
const NIGHT_PHASE_BY_TYPE={attack:"night_mafia",vigilante:"night_vigilante",convert:"night_missionary",heal:"night_doctor",revive:"night_priest"};
function beginNightTurn(r,index=0){
 if(index>=NIGHT_TURNS.length)return nightResolve(r);
 const turn=NIGHT_TURNS[index],members=alive(r).filter(p=>p.role===turn.role);
 r.nightTurnIndex=index;
 if(!members.length)return beginNightTurn(r,index+1);
 r.phase=turn.phase;r.endsAt=Date.now()+15000;
 const humans=members.filter(p=>!p.isBot);
 if(!humans.length){
  for(const b of members){
   const others=alive(r).filter(x=>x.id!==b.id);
   let target=null,type=null;
   if(turn.role==="마피아"){target=botChoose(r,others.filter(x=>x.team!=="evil"));type="attack";}
   if(turn.role==="자경단"){if(b.used.vigilanteTarget){target=r.players.get(b.used.vigilanteTarget);type="vigilante";}else{target=botChoose(r,others);if(target){b.used.vigilanteTarget=target.id;b.used.vigilanteInvestigatedDay=r.day;}}}
   if(turn.role==="선교사"&&!b.used.convert){target=botChoose(r,others.filter(x=>x.team==="good"));type="convert";}
   if(turn.role==="의사"){target=botChoose(r,others);type="heal";}
   if(turn.role==="제사장"&&!b.used.revive){target=botChoose(r,[...r.players.values()].filter(x=>!x.alive));type="revive";}
   if(target&&type)r.actions[type+":"+b.id]={type,actor:b.id,target:target.id};
  }
  return beginNightTurn(r,index+1);
 }
 sendState(r);
}
function advanceNightTurn(r){
 if(!r||!String(r.phase).startsWith("night_"))return;
 beginNightTurn(r,r.nightTurnIndex+1);
}
function startNight(r){r.actions={};r.votes={};beginNightTurn(r,0);}

function nightResolve(r){
 const act=r.actions, deaths=[];
 const markDead=(p,reason)=>{if(!p?.alive||p.id===r.presidentId)return false;p.alive=false;const reveal=p.team==="evil"?" (직업: "+revealedRole(p)+")":"";deaths.push(p.name+"님"+(reason||"이 탈락했습니다.")+reveal);return true;};
 const mafia=Object.values(act).filter(x=>x.type==="attack").map(x=>x.target).filter(Boolean);
 const target=mafia[0], save=Object.values(act).find(x=>x.type==="heal")?.target;
 if(target&&target!==save){const victim=r.players.get(target);if(markDead(victim,"이 밤에 탈락했습니다."))log(r,victim.name+"님이 밤에 탈락했습니다.");}
 const vigil=Object.values(act).find(x=>x.type==="vigilante");
 if(vigil){const v=r.players.get(vigil.actor),t=r.players.get(vigil.target);if(v?.alive&&t?.alive&&t.team==="evil"){if(markDead(t,"이 밤에 자경단의 행동으로 탈락했습니다."))log(r,"자경단의 행동으로 악인 한 명이 탈락했습니다.");}if(v?.used){v.used.vigilanteTarget=null;v.used.vigilanteInvestigatedDay=null;}}
 for(const x of Object.values(act)){const p=r.players.get(x.actor),t=r.players.get(x.target);if(!p?.alive||!t||(x.type!=="revive"&&!t.alive))continue;
  if(x.type==="convert"){if(t.team==="good"&&!p.used.convert){t.team="evil";t.joined=true;p.used.convert=true;log(r,"진영에 변화가 생겼습니다.");}else if(t.team==="evil"){markDead(p,"이 밤에 전향 실패로 탈락했습니다.");log(r,"선교사가 잘못 전향을 시도해 탈락했습니다.");}}
  if(x.type==="revive"&&p.role==="제사장"&&!p.used.revive&&!t.alive){t.alive=true;const deathIndex=deaths.findIndex(d=>d.startsWith(t.name+"님"));if(deathIndex>=0)deaths.splice(deathIndex,1);p.used.revive=true;log(r,"제사장의 능력으로 한 명이 부활했습니다.");}
 }

 const nightText=deaths.length?deaths.join("\n"):"오늘 밤 탈락자는 없습니다.";
 io.to(r.code).emit("nightResult",{text:nightText});
 const w=endCheck(r);if(w)return finish(r,w);
 r.phase="day_discuss";r.endsAt=Date.now()+60000;r.actions={};r.botChatCount=0;r.nextBotChatAt=Date.now()+3000;log(r,"아침입니다. 토론을 시작하세요.");sendState(r);
}
function nextVote(r){r.phase="day_vote";r.votes={};r.resolvingVote=false;r.endsAt=Date.now()+120000;log(r,"투표가 시작되었습니다. 제한 시간은 120초입니다.");sendState(r);}
function fillBotVotes(r){if(!r.aiMode)return;for(const b of alive(r).filter(p=>p.isBot&&!r.votes[p.id])){const candidates=alive(r).filter(p=>p.id!==b.id);let choices=candidates;if(b.team==="evil")choices=candidates.filter(p=>p.team!=="evil");const target=botChoose(r,choices);if(target)r.votes[b.id]=target.id;}}
function allAliveVoted(r){const voters=alive(r).filter(p=>p.connected!==false);return voters.length>0&&voters.every(p=>!!r.votes[p.id]);}
function resolveVote(r){
 if(r.phase!=="day_vote"||r.resolvingVote)return;r.resolvingVote=true;
 fillBotVotes(r);
 const judgeAction=Object.values(r.actions).find(x=>x.type==="judge");
 if(judgeAction){const judge=r.players.get(judgeAction.actor),target=r.players.get(judgeAction.target);
  if(judge?.alive&&target?.alive){if(target.team==="evil"){target.alive=false;log(r,"판사의 판결로 "+target.name+"님이 탈락했습니다.");}
   else{judge.alive=false;log(r,"판사가 잘못된 판결을 내려 탈락했습니다.");}}
 }
 const counts={};for(const [v,t] of Object.entries(r.votes)){const p=r.players.get(v),target=r.players.get(t);if(p?.alive&&target?.alive)counts[t]=(counts[t]||0)+(p.role==="국회의원"?2:1);}
 const sorted=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
 let resultText=judgeAction?"판사의 능력이 사용되었습니다.\n":"";
 let jesterWon=false;
 if(sorted.length&&(!sorted[1]||sorted[0][1]>sorted[1][1])){
  const target=r.players.get(sorted[0][0]);
  if(target?.alive&&target.role==="국회의원"){
   log(r,target.name+"님은 투표에서 탈락하지 않았습니다.");
   resultText+=target.name+"님은 투표에서 탈락하지 않았습니다.";
  }else if(target?.alive){
   target.alive=false;
   log(r,target.role==="궁정광대"?"궁정광대가 투표로 탈락했습니다!":target.name+"님이 투표로 탈락했습니다.");
   resultText+=target.name+"님이 투표로 탈락했습니다."+(target.team==="evil"?"\n직업: "+revealedRole(target):"");
   jesterWon=target.role==="궁정광대";
  }else{
   log(r,"투표 결과 처벌 대상이 없습니다.");
   resultText+="이번 투표에서는 아무도 탈락하지 않았습니다.";
  }
 }else{
  log(r,"동점 또는 투표 없음: 아무도 탈락하지 않았습니다.");
  resultText="이번 투표에서는 아무도 탈락하지 않았습니다.";
 }
 const evilRemaining=alive(r).filter(p=>p.team==="evil").length;
 resultText+="\n악인팀이 "+evilRemaining+"명 남았습니다.";
 io.to(r.code).emit("voteResult",{text:resultText});
 if(jesterWon)return finish(r,"궁정광대");
 const w=endCheck(r);if(w)return finish(r,w);
 r.day++;r.actions={};r.votes={};r.resolvingVote=false;
 if(r.day>=4&&!r.presidentId){const politician=alive(r).find(p=>p.role==="국회의원");if(politician){r.presidentId=politician.id;log(r,politician.name+"님이 대통령이 되었습니다. 이제 탈락하지 않습니다.");}}
 log(r,"밤이 되었습니다. 마피아부터 차례대로 행동합니다.");startNight(r);
}
setInterval(()=>{for(const r of rooms.values()){if(r.phase==="day_discuss"&&r.aiMode)scheduleBotDiscussion(r);if(!r.endsAt||Date.now()<r.endsAt)continue;
 if(String(r.phase).startsWith("night_"))advanceNightTurn(r);else if(r.phase==="day_discuss"){if(r.day===1){log(r,"첫째 날 토론이 끝났습니다. 밤이 시작됩니다.");r.day++;startNight(r);}else nextVote(r);}else if(r.phase==="day_vote")resolveVote(r);
}},500);
function removeFromQueue(id){const i=matchmakingQueue.findIndex(x=>x.id===id);if(i>=0)matchmakingQueue.splice(i,1);}
function runMatchmaking(){
 while(matchmakingQueue.length>=6){
  const batch=matchmakingQueue.splice(0,Math.min(15,matchmakingQueue.length));
  const code=roomCode(),r={code,players:new Map(),host:batch[0].id,phase:"lobby",day:0,log:[],endsAt:null,actions:{},votes:{}};
  for(const entry of batch){entry.socket.join(code);r.players.set(entry.id,{id:entry.id,name:entry.name,alive:true});entry.socket.emit("joined",{code,matched:true});}
  rooms.set(code,r);assign(r);sendState(r);
 }
}
io.on("connection",s=>{
 s.on("quickJoin",name=>{
  name=clean(name);if(!name)return s.emit("errorMsg","닉네임을 입력해 주세요.");
  removeFromQueue(s.id);matchmakingQueue.push({id:s.id,name,socket:s});
  s.emit("queueStatus",{waiting:true,count:matchmakingQueue.length});
  runMatchmaking();
 });
 s.on("cancelQueue",()=>{removeFromQueue(s.id);s.emit("queueStatus",{waiting:false,count:matchmakingQueue.length});});

 s.on("soloStart",name=>{
  name=clean(name);if(!name)return s.emit("errorMsg","닉네임을 입력해 주세요.");
  const code=roomCode(),r={code,players:new Map(),host:s.id,phase:"lobby",day:0,log:[],endsAt:null,actions:{},votes:{},aiMode:true};
  r.players.set(s.id,{id:s.id,name,alive:true,isBot:false});
  for(let i=1;i<6;i++){const id="bot_"+crypto.randomBytes(5).toString("hex");r.players.set(id,{id,name:["하늘","단풍","별이","구름","달빛"][i-1],alive:true,isBot:true});}
  rooms.set(code,r);s.join(code);s.emit("joined",{code,aiMode:true});assign(r);log(r,"AI 대련 모드 시작! AI 플레이어 5명과 대결합니다.");sendState(r);
 });
 s.on("create",name=>{name=clean(name);if(!name)return;const code=roomCode();const r={code,players:new Map(),host:s.id,phase:"lobby",day:0,log:[],endsAt:null,actions:{},votes:{}};r.players.set(s.id,{id:s.id,name,alive:true});rooms.set(code,r);s.join(code);s.emit("joined",{code});sendState(r);});
 s.on("join",({code,name})=>{const r=rooms.get(String(code||"").toUpperCase()),n=clean(name);if(!r||!n||r.phase!=="lobby"||r.players.size>=15)return s.emit("errorMsg","방을 찾을 수 없거나 입장할 수 없습니다.");r.players.set(s.id,{id:s.id,name:n,alive:true});s.join(r.code);s.emit("joined",{code:r.code});sendState(r);});
 s.on("start",()=>{const r=[...rooms.values()].find(x=>x.players.has(s.id));if(!r||r.host!==s.id||r.phase!=="lobby"||r.players.size<6)return s.emit("errorMsg","방장만 6명 이상일 때 시작할 수 있습니다.");assign(r);sendState(r);});
 s.on("action",({type,target})=>{const r=[...rooms.values()].find(x=>x.players.has(s.id)),p=r?.players.get(s.id),t=r?.players.get(target);if(!r||!p?.alive||!t)return;
 if(type==="judge"){
  if(p.role!=="판사"||r.phase!=="day_vote"||!t.alive||p.id===t.id||p.used.judgeDay===r.day||r.resolvingVote)return;
  r.actions["judge:"+p.id]={type:"judge",actor:p.id,target:t.id};
  p.used.judgeDay=r.day;recordAbility(p,r,t,"판결");sendState(r);return;
 }
 if(!String(r.phase).startsWith("night_"))return;
 if(type!=="revive"&&!t.alive)return;
 if(type==="revive"&&(t.alive||p.used.revive))return;
 const allowed={의사:"heal",마피아:"attack",자경단:"vigilante",선교사:"convert",제사장:"revive"};
 if(allowed[p.role]!==type||p.id===t.id||r.phase!==NIGHT_PHASE_BY_TYPE[type])return;
 if(type==="vigilante"&&(p.used.vigilanteTarget!==t.id||p.used.vigilanteInvestigatedDay>=r.day))return;
 if(type==="revive"&&t.alive)return;
 if(type==="convert"&&p.used.convert)return;
 r.actions[type+":"+p.id]={type,actor:p.id,target:t.id};
 const abilityLabels={heal:"치료",attack:"공격",judge:"처벌",vigilante:"공격",convert:"전향",revive:"부활"};recordAbility(p,r,t,abilityLabels[type]||type);
 if(p.role==="경찰"&&type==="inspect")s.emit("privateResult",{text:t.team==="evil"?"악인 진영입니다.":"악인 진영이 아닙니다."});
 if(p.role==="스파이"&&type==="spy"){s.emit("privateResult",{text:"상대 직업: "+t.role});if(t.role==="마피아"){p.joined=true;t.joined=true;log(r,"스파이가 마피아와 서로 정체를 확인했습니다.");}}
 advanceNightTurn(r);
 });
 s.on("special",({target})=>{
  const r=[...rooms.values()].find(x=>x.players.has(s.id)),p=r?.players.get(s.id),t=r?.players.get(target);
  if(!r||!p?.alive||!t?.alive||p.id===t.id)return;
  if(p.role==="자경단"&&r.phase==="night_vigilante"&&!p.used.vigilanteTarget){
   p.used.vigilanteTarget=t.id;p.used.vigilanteInvestigatedDay=r.day;recordAbility(p,r,t,"야간 정체 조사");
   s.emit("privateResult",{text:t.name+"님 조사 결과: "+(t.team==="evil"?"악인입니다. 다음 밤에 이 대상을 공격할 수 있습니다.":"악인이 아닙니다.")});
   advanceNightTurn(r);return;
  }
  if(p.role==="경찰"&&r.phase==="night_police"&&p.used.policeNight!==r.day){
   p.used.policeNight=r.day;recordAbility(p,r,t,"경찰 조사");
   s.emit("privateResult",{text:t.name+"님 조사 결과: "+(t.team==="evil"?"악인 진영입니다.":"악인 진영이 아닙니다.")});
   advanceNightTurn(r);
   return;
  }
  if(p.role==="스파이"&&r.phase==="night_spy"&&p.used.spyNight!==r.day){
   p.used.spyNight=r.day;recordAbility(p,r,t,"스파이 조사");
   s.emit("privateResult",{text:t.name+"님의 직업: "+revealedRole(t)});
   if(t.role==="마피아"){p.joined=true;t.joined=true;log(r,"스파이와 마피아가 서로 정체를 확인했습니다.");}
   advanceNightTurn(r);
   return;
  }
  if(p.role==="기자"&&r.phase==="day_discuss"&&r.day>1&&p.used.reporterDay!==r.day){
   p.used.reporterDay=r.day;recordAbility(p,r,t,"기자 발표");
   const announcement="기자 발표: "+t.name+"님의 직업은 "+revealedRole(t)+"입니다.";
   log(r,announcement);
   io.to(r.code).emit("reporterAnnouncement",{text:announcement});
   sendState(r);
   return;
  }

 });
 s.on("vote",target=>{const r=[...rooms.values()].find(x=>x.players.has(s.id)),p=r?.players.get(s.id),t=r?.players.get(target);if(!r||r.day===1||r.phase!=="day_vote"||r.resolvingVote||!p?.alive||!t?.alive||p.id===t.id||r.votes[s.id])return;r.votes[s.id]=target;fillBotVotes(r);sendState(r);if(allAliveVoted(r))resolveVote(r);});
 s.on("chat",({text:msg,team})=>{const r=[...rooms.values()].find(x=>x.players.has(s.id)),p=r?.players.get(s.id);if(!r||!p||!msg)return;const message=cleanMessage(msg);if(!message)return;
 if(team){if(!joinedEvil(p))return;for(const q of r.players.values())if(joinedEvil(q))io.to(q.id).emit("chat",{name:p.name,text:message,team:true});}
 else{if(!p.alive||r.phase==="ended")return;io.to(r.code).emit("chat",{name:p.name,text:message,team:false});}
 });
 s.on("disconnect",()=>{removeFromQueue(s.id);for(const r of rooms.values()){const p=r.players.get(s.id);if(p&&r.phase==="lobby"){r.players.delete(s.id);if(r.host===s.id)r.host=r.players.keys().next().value;sendState(r);}else if(p){p.connected=false;if(r.phase==="day_vote"&&allAliveVoted(r))resolveVote(r);}}});
});
const PORT=process.env.PORT||3000;server.listen(PORT,"0.0.0.0",()=>console.log("MAFIA ONLINE listening on "+PORT));