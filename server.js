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
function roomCode(){ let code; do{code=crypto.randomBytes(3).toString("hex").toUpperCase();}while(rooms.has(code)); return code; }
function emitRoom(r){ io.to(r.code).emit("state", publicState(r)); }
function publicRoomList(){return [...rooms.values()].filter(r=>r.visibility==="public"&&r.phase==="lobby").map(r=>({code:r.code,count:r.players.size,maxPlayers:r.settings.maxPlayers}));}
function broadcastPublicRooms(){io.emit("publicRooms",publicRoomList());}
function revealedRole(p){ return p.role==="클러쳐" ? "시민" : p.role; }
function publicState(r){
 const voteCounts={};if(r.phase==="day_vote")for(const [voterId,target] of Object.entries(r.votes||{})){const voter=r.players.get(voterId);const weight=voter?.role==="국회의원"?2:1;voteCounts[target]=(voteCounts[target]||0)+weight;}
 return {code:r.code,phase:r.phase,day:r.day,aiMode:!!r.aiMode,settings:r.settings||null,visibility:r.visibility||"public",voteCounts,skippedCount:Object.keys(r.skippedVotes||{}).length,serverNow:Date.now(),players:[...r.players.values()].map(p=>({id:p.id,name:p.name,alive:p.alive,role:!p.alive&&p.team==="evil"?revealedRole(p):null})),host:r.host,endsAt:r.endsAt,log:r.log.slice(-30),winner:r.winner};
}
function viewFor(r,p){
 const st=publicState(r); st.me={id:p.id,name:p.name,role:p.role,alive:p.alive,team:p.team,joined:p.joined,isPresident:p.id===r.presidentId,canVote:p.alive&&r.phase==="day_vote",hasVoted:!!r.votes[p.id]||!!r.skippedVotes?.[p.id],reporterUsed:p.used?.reporterDay===r.day,judgeUsed:!!p.used?.judgeNight,policeUsed:p.used?.policeNight===r.day,spyUsed:p.used?.spyNight===r.day,lastAbility:p.lastAbility||null,vigilanteInvestigated:!!p.used?.vigilanteInvestigated,vigilanteTargetId:p.vigilanteTargetId||null,vigilanteInvestigatedDay:p.vigilanteInvestigatedDay??null};
 st.players=[...r.players.values()].map(x=>({id:x.id,name:x.name,alive:x.alive,connected:x.connected!==false,role:r.phase==="ended"?x.role:(!x.alive&&x.team==="evil"?revealedRole(x):(x.id===p.id?x.role:null)),team:r.phase==="ended"?x.team:null}));
 st.teamChatAllowed=!!(p.alive&&p.team==="evil"&&p.joined);
 return st;
}
function sendState(r){ for(const p of r.players.values()) io.to(p.id).emit("state",viewFor(r,p)); }
function log(r,msg){r.log.push({day:r.day,text:msg}); if(r.log.length>100)r.log.shift();}
function alive(r){return [...r.players.values()].filter(p=>p.alive);}
function normalizeSettings(raw={},playerCount=6){
 const maxPlayers=Math.max(6,Math.min(15,Number.parseInt(raw.maxPlayers,10)||10));
 const maxEvil=Math.min(3,maxPlayers-2);
 const fallback=Math.min(maxEvil,Math.max(1,Math.floor(playerCount/5)));
 const evilCount=Math.max(1,Math.min(maxEvil,Number.parseInt(raw.evilCount,10)||fallback));
 const discussionSeconds=Math.max(15,Math.min(300,Number.parseInt(raw.discussionSeconds,10)||60));
 const voteSeconds=Math.max(15,Math.min(300,Number.parseInt(raw.voteSeconds,10)||120));
 const visibility=raw.visibility==="private"?"private":"public";
 const excludedRoles=Array.isArray(raw.excludedRoles)?[...new Set(raw.excludedRoles.filter(x=>Object.prototype.hasOwnProperty.call(ROLES,x)&&x!=="마피아"&&x!=="시민"))]:[];
 return {maxPlayers,evilCount,excludedRoles,discussionSeconds,voteSeconds,visibility};
}
function assign(r){
 const n=r.players.size;
 r.settings=normalizeSettings(r.settings,n);
 const excluded=new Set(r.settings.excludedRoles);
 const evilCount=Math.max(1,Math.min(r.settings.evilCount,n-2));
 const roles=["마피아"];
 const evilPool=["스파이","클러쳐","선교사"].filter(x=>!excluded.has(x));
 for(let i=evilPool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[evilPool[i],evilPool[j]]=[evilPool[j],evilPool[i]];}
 while(roles.filter(x=>ROLES[x].team==="evil").length<evilCount){
  const next=evilPool.shift();roles.push(next||"마피아");
 }
 if(!excluded.has("궁정광대"))roles.push("궁정광대");
 const goodRoles=["의사","경찰","판사","국회의원","기자","자경단","제사장"].filter(x=>!excluded.has(x));
 for(let i=goodRoles.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[goodRoles[i],goodRoles[j]]=[goodRoles[j],goodRoles[i]];}
 while(roles.length<n){if(goodRoles.length)roles.push(goodRoles.shift());else roles.push("시민");}
 for(let i=roles.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[roles[i],roles[j]]=[roles[j],roles[i]];}
 [...r.players.values()].forEach((p,i)=>{p.role=roles[i];p.team=ROLES[p.role].team;p.alive=true;p.joined=p.role==="마피아";p.used={};p.viewerId=p.id;});
 r.phase="day_discuss";r.day=1;r.actions={};r.votes={};r.botSuspicion={};r.botHistory=[];r.botHistorySeq=0;r.lastBotSpeakerId=null;r.endsAt=Date.now()+r.settings.discussionSeconds*1000;r.botChatCount=0;r.nextBotChatAt=Date.now()+3000;[...r.players.values()].filter(p=>p.isBot).forEach((p,i)=>{p.persona=BOT_PERSONAS[i%BOT_PERSONAS.length];p.botTalkCount=0;p.lastBotLine="";});
 log(r,"게임 시작! 낮 1일차 토론이 시작되었습니다.");
}
function joinedEvil(p){return p.team==="evil"&&p.joined&&p.alive;}
function endCheck(r){
 const a=alive(r), evil=a.filter(p=>p.team==="evil").length;
 if(!a.length)return "무승부";
 if(evil===0)return "선량한 팀";
 if(evil>=Math.ceil(a.length/2))return "악인 팀";
 return null;
}
function finish(r,w){r.phase="ended";r.winner=w;r.endsAt=null;log(r,w+" 승리!");sendState(r);}
function botChoose(r,arr=[]){return Array.isArray(arr)&&arr.length?arr[Math.floor(Math.random()*arr.length)]:null;}
const BOT_PERSONAS=[
 {kind:"분석형",open:"잠깐, 지금까지 나온 얘기를 정리해 보면요.",tone:"근거를 조금 더 확인하고 싶어요."},
 {kind:"직설형",open:"제 생각은 조금 달라요.",tone:"빙빙 돌리지 말고 이유를 말해 봐요."},
 {kind:"신중형",open:"아직 확신할 단계는 아닌 것 같아요.",tone:"조금 더 듣고 결정해도 늦지 않아요."},
 {kind:"관찰형",open:"저는 방금 반응이 조금 신경 쓰였어요.",tone:"말보다 앞뒤가 맞는지 보는 게 좋겠어요."},
 {kind:"사교형",open:"다들 잠깐만요, 제 의견도 말해 볼게요.",tone:"서로 얘기 들어보고 차분히 정해요."},
 {kind:"토론형",open:"그 주장에는 확인할 부분이 있어요.",tone:"누가 어떤 근거로 말했는지 따져보죠."}
];
function botScore(r,p){
 const votes=Object.values(r.votes||{}).filter(id=>id===p.id).length;
 const mentions=(r.botHistory||[]).filter(m=>!m.isBot&&m.text.includes(p.name)&&/(수상|의심|마피아|악인|거짓말|투표|몰아|이상하|믿기|걸려)/.test(m.text)).length;
 return (r.botSuspicion?.[p.id]||0)+votes*1.35+mentions*.65+(p.alive?0:-100);
}
function botPickSuspect(r,bot,candidates){
 const pool=candidates.filter(p=>p.id!==bot.id&&(bot.team!=="evil"||p.team!=="evil"));
 if(!pool.length)return null;
 const ranked=pool.map(p=>({p,score:botScore(r,p)})).sort((a,b)=>b.score-a.score);
 const top=ranked[0].score;
 const tied=ranked.filter(x=>x.score>=top-.8).map(x=>x.p);
 return botChoose(r,tied);
}
function botLine(r,bot){
 const living=alive(r).filter(p=>p.id!==bot.id);
 const recent=(r.botHistory||[]).slice(-12);
 const persona=bot.persona||BOT_PERSONAS[0];
 const lastHuman=[...recent].reverse().find(m=>!m.isBot);
 const direct=lastHuman&&lastHuman.text.includes(bot.name)&&/(수상|의심|마피아|악인|거짓말|이상하|몰아|투표)/.test(lastHuman.text);
 const mentioned=lastHuman&&living.find(p=>p.id!==bot.id&&lastHuman.text.includes(p.name));
 const ranked=living.filter(p=>bot.team!=="evil"||p.team!=="evil").map(p=>({p,score:botScore(r,p)})).sort((a,b)=>b.score-a.score);
 const suspect=ranked[0]?.p;
 const votes=Object.entries(r.votes||{}).map(([voter,target])=>({voter:r.players.get(voter),target:r.players.get(target)})).filter(x=>x.voter?.alive&&x.target?.alive);
 const recentVoteTarget=votes.length?votes[votes.length-1].target:null;
 const candidates=[];
 if(direct){
  candidates.push("제 이름이 나와서 답할게요. 그렇게 의심하는 이유가 뭔지 구체적으로 말해 주실래요?");
  candidates.push("저를 의심하는 건 알겠는데, 아직은 근거가 부족해 보여요. 다른 정황도 있나요?");
  candidates.push("일단 제 입장도 들어 주세요. 지금은 이름만 지목하기보다 발언과 투표 흐름을 같이 봐야 해요.");
 }
 if(mentioned&&!direct){
  candidates.push(mentioned.name+"님을 의심하는 이유가 방금 말한 부분 때문인가요? 어떤 점이 가장 걸렸어요?");
  candidates.push(mentioned.name+"님 얘기가 나왔네요. 저는 그분이 앞에서 한 말과 지금 말이 일치하는지 확인하고 싶어요.");
  candidates.push(mentioned.name+"님을 바로 몰기보다는 한 번 더 설명을 들어보죠.");
 }
 if(lastHuman&&!direct&&!mentioned){
  candidates.push(lastHuman.name+"님 말은 들었어요. 그런데 그 판단을 뒷받침하는 단서가 하나 더 있을까요?");
  candidates.push("방금 의견에 한 가지 덧붙이면, 지금까지 나온 투표 흐름도 같이 봐야 할 것 같아요.");
 }
 if(suspect&&botScore(r,suspect)>=1.5){
  candidates.push("저는 "+suspect.name+"님이 조금 걸려요. 아직 확신은 아니지만 지금까지 나온 말과 투표가 자연스럽게 이어지는지 궁금해요.");
  candidates.push(suspect.name+"님, 지금 의심받는 상황인데 본인 입장에서는 누가 가장 수상해 보여요?");
  candidates.push("현재로서는 "+suspect.name+"님 쪽을 조금 더 살펴보고 싶어요. 다른 분들은 어떻게 생각하세요?");
 }
 if(recentVoteTarget&&recentVoteTarget.id!==bot.id){
  candidates.push("방금 투표 흐름을 보니 "+recentVoteTarget.name+"님에게 표가 모이네요. 다들 같은 이유로 선택한 건지 확인해 봐야겠어요.");
 }
 if(r.day===1){
  candidates.push("첫날이라 정보가 많지 않네요. 일단 서로 한 번씩 의견을 듣고 판단하는 게 좋겠어요.");
  candidates.push("저는 아직 특정한 사람을 지목하긴 어려워요. 다들 누구를 의심하는지 이유까지 말해 주세요.");
  candidates.push("너무 빨리 결론 내리지 말고, 발언이 앞뒤가 맞는지 차근차근 봐요.");
 }else if(living.length<=4){
  candidates.push("이제 인원이 얼마 안 남았어요. 이전에 누가 누구를 의심했고 실제 투표는 어떻게 했는지 다시 생각해 봅시다.");
  candidates.push("이번 선택이 중요하니까 감보다는 지금까지 확인된 행동을 기준으로 정했으면 해요.");
 }else{
  candidates.push("아직 확실한 단서는 부족해요. 의심되는 분은 이름만 말하지 말고 이유도 같이 얘기해 주세요.");
  candidates.push("말을 많이 했는지만 보지 말고, 질문을 받았을 때 어떻게 답하는지도 살펴봐요.");
  candidates.push("한 사람에게 표가 몰리면 편하긴 하지만, 다 같이 같은 근거를 갖고 있는지는 확인해야 해요.");
 }
 let unique=[...new Set(candidates)].filter(line=>line!==bot.lastBotLine);
 if(!unique.length)unique=[persona.tone];
 let line=unique[Math.floor(Math.random()*unique.length)];
 if(bot.lastBotLine===line)line=persona.open+" "+persona.tone;
 bot.lastBotLine=line;
 return line;
}
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
 if(!r.nextBotChatAt)r.nextBotChatAt=Date.now()+2200+Math.floor(Math.random()*2600);
 if(Date.now()<r.nextBotChatAt||r.botChatCount>=8)return;
 const bots=alive(r).filter(p=>p.isBot);
 if(!bots.length)return;
 const available=bots.filter(b=>b.id!==r.lastBotSpeakerId);
 const leastSpoken=Math.min(...(available.length?available:bots).map(b=>b.botTalkCount||0));
 const pool=(available.length?available:bots).filter(b=>(b.botTalkCount||0)<=leastSpoken+1);
 const bot=botChoose(r,pool);
 if(!bot)return;
 const message=botLine(r,bot);
 io.to(r.code).emit("chat",{name:bot.name,text:message,team:false});
 if(!r.botHistory)r.botHistory=[];
 r.botHistory.push({name:bot.name,text:message,day:r.day,isBot:true});
 if(r.botHistory.length>40)r.botHistory.shift();
 bot.botTalkCount=(bot.botTalkCount||0)+1;
 r.lastBotSpeakerId=bot.id;
 r.botChatCount++;
 r.nextBotChatAt=Date.now()+3500+Math.floor(Math.random()*5200);
}
function runBotNight(r){
 if(!r.aiMode)return;
 const living=alive(r), bots=living.filter(p=>p.isBot);
 for(const b of bots){
  const others=living.filter(p=>p.id!==b.id);
  if(!others.length)continue;
  if(b.role==="마피아"&&!Object.values(r.actions).some(x=>x.type==="attack")){const t=botChoose(r,others.filter(x=>x.team!=="evil"));if(t)r.actions["attack:"+b.id]={type:"attack",actor:b.id,target:t.id};}
  if(b.role==="의사"){const t=botChoose(r,others);if(t)r.actions["heal:"+b.id]={type:"heal",actor:b.id,target:t.id};}
  if(b.role==="자경단"){const t=botChoose(r,others);if(t)r.actions["vigilante:"+b.id]={type:"vigilante",actor:b.id,target:t.id};}
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
 {role:"제사장",phase:"night_priest"},
 {role:"판사",phase:"night_judge"}
];
const NIGHT_PHASE_BY_TYPE={attack:"night_mafia",vigilante:"night_vigilante",convert:"night_missionary",heal:"night_doctor",revive:"night_priest"};
function beginNightTurn(r,index=0){
 if(index>=NIGHT_TURNS.length)return nightResolve(r);
 const turn=NIGHT_TURNS[index],members=alive(r).filter(p=>p.role===turn.role&&canTakeNightTurn(r,p,turn.role));
 
 r.nightTurnIndex=index;
 if(!members.length)return beginNightTurn(r,index+1);
 r.phase=turn.phase;r.endsAt=Date.now()+15000;
 const humans=members.filter(p=>!p.isBot);
 if(!humans.length){
  for(const b of members){
   const others=alive(r).filter(x=>x.id!==b.id);
   let target=null,type=null;
   if(turn.role==="마피아"){target=botChoose(r,others.filter(x=>x.team!=="evil"));type="attack";}
   if(turn.role==="자경단"){
    if(!b.used.vigilanteInvestigated){
     target=botPickSuspect(r,b,others);
     b.used.vigilanteInvestigated=true;b.vigilanteInvestigatedDay=r.day;
     b.vigilanteTargetId=target?.team==="evil"?target.id:null;
     if(target)r.botSuspicion[target.id]=(r.botSuspicion[target.id]||0)+(target.team==="evil"?2:0);
    }else if(b.vigilanteTargetId&&r.day>b.vigilanteInvestigatedDay){
     target=r.players.get(b.vigilanteTargetId);if(target?.alive)type="vigilante";else b.vigilanteTargetId=null;
    }
   }
   if(turn.role==="선교사"&&!b.used.convert){target=botChoose(r,others.filter(x=>x.team==="good"));type="convert";}
   if(turn.role==="경찰"){target=botPickSuspect(r,b,others);if(target&&target.team==="evil")r.botSuspicion[target.id]=(r.botSuspicion[target.id]||0)+2;}
   if(turn.role==="스파이"){target=botPickSuspect(r,b,others);if(target?.role==="마피아"){b.joined=true;target.joined=true;}}
   if(turn.role==="의사"){target=botChoose(r,others);type="heal";}
   if(turn.role==="제사장"&&!b.used.revive){target=botChoose(r,[...r.players.values()].filter(x=>!x.alive));type="revive";}
   if(target&&type)r.actions[type+":"+b.id]={type,actor:b.id,target:target.id};
  }
  return beginNightTurn(r,index+1);
 }
 sendState(r);
}
function canTakeNightTurn(r,p,role){
 if(role==="자경단"){
  if(!p.used.vigilanteInvestigated)return true;
  const target=p.vigilanteTargetId?r.players.get(p.vigilanteTargetId):null;
  return !!(target?.alive&&r.day>p.vigilanteInvestigatedDay);
 }
 if(role==="선교사")return !p.used.convert;
 if(role==="경찰")return p.used.policeNight!==r.day;
 if(role==="스파이")return p.used.spyNight!==r.day;
 if(role==="제사장")return !p.used.revive&&[...r.players.values()].some(x=>!x.alive&&x.connected!==false);
 if(role==="판사")return !p.used.judgeNight;
 return true;
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
 if(vigil){const v=r.players.get(vigil.actor),t=r.players.get(vigil.target);if(v?.alive&&t?.alive&&t.team==="evil"){if(markDead(t,"이 밤에 자경단의 공격으로 탈락했습니다."))log(r,"자경단의 공격으로 악인 한 명이 탈락했습니다.");}else if(v?.alive&&t?.alive){log(r,"자경단의 공격은 아무도 탈락시키지 못했습니다.");}}
 for(const x of Object.values(act)){const p=r.players.get(x.actor),t=r.players.get(x.target);if(!p?.alive||!t||(x.type!=="revive"&&!t.alive))continue;
  if(x.type==="convert"){if(t.team==="good"&&!p.used.convert){t.team="evil";t.joined=true;p.joined=true;p.used.convert=true;log(r,"진영에 변화가 생겼습니다.");}else if(t.team==="evil"){markDead(p,"이 밤에 전향 실패로 탈락했습니다.");log(r,"선교사가 잘못 전향을 시도해 탈락했습니다.");}}
  if(x.type==="revive"&&p.role==="제사장"&&!p.used.revive&&!t.alive){t.alive=true;const deathIndex=deaths.findIndex(d=>d.startsWith(t.name+"님"));if(deathIndex>=0)deaths.splice(deathIndex,1);p.used.revive=true;log(r,"제사장의 능력으로 한 명이 부활했습니다.");}
 }

 const nightText=deaths.length?deaths.join("\n"):"오늘 밤 탈락자는 없습니다.";
 const judgeAction=Object.values(act).find(x=>x.type==="judge");
 if(judgeAction){const judge=r.players.get(judgeAction.actor),target=r.players.get(judgeAction.target);if(judge?.alive&&target?.alive){if(target.team==="evil"){markDead(target,"이 밤에 판결로 탈락했습니다.");log(r,"판사의 판결로 "+target.name+"님이 탈락했습니다.");}else{markDead(judge,"이 밤에 잘못된 판결로 탈락했습니다.");log(r,"판사가 선량한 플레이어에게 판결을 내려 탈락했습니다.");}}}
 io.to(r.code).emit("nightResult",{text:(judgeAction?"판사가 판결을 내렸습니다.\n":"")+(deaths.length?deaths.join("\n"):"오늘 밤 탈락자는 없습니다.")});
 const w=endCheck(r);if(w)return finish(r,w);
 r.phase="day_discuss";r.endsAt=Date.now()+r.settings.discussionSeconds*1000;r.actions={};r.botChatCount=0;r.nextBotChatAt=Date.now()+3000;log(r,"아침입니다. 토론을 시작하세요.");sendState(r);
}
function nextVote(r){r.phase="day_vote";r.votes={};r.skippedVotes={};r.resolvingVote=false;r.endsAt=Date.now()+r.settings.voteSeconds*1000;log(r,"투표가 시작되었습니다. 제한 시간은 "+r.settings.voteSeconds+"초입니다.");sendState(r);}
function fillBotVotes(r){if(!r.aiMode)return;for(const b of alive(r).filter(p=>p.isBot&&!r.votes[p.id])){const candidates=alive(r).filter(p=>p.id!==b.id);const target=botPickSuspect(r,b,candidates);if(target)r.votes[b.id]=target.id;}}
function allAliveVoted(r){const voters=alive(r).filter(p=>p.connected!==false);return voters.length>0&&voters.every(p=>!!r.votes[p.id]||!!r.skippedVotes?.[p.id]);}
function resolveVote(r){
 if(r.phase!=="day_vote"||r.resolvingVote)return;r.resolvingVote=true;
 fillBotVotes(r);
 
 const counts={};for(const [v,t] of Object.entries(r.votes)){const p=r.players.get(v),target=r.players.get(t);if(p?.alive&&target?.alive&&target.id!==r.presidentId)counts[t]=(counts[t]||0)+(p.role==="국회의원"?2:1);}
 const sorted=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
 const skippedCount=Object.keys(r.skippedVotes||{}).length;
 const tallyLines=sorted.map(([id,count])=>{const target=r.players.get(id);return (target?.name||"알 수 없는 플레이어")+" : "+count+"표";});
 tallyLines.push("건너뛰기 : "+skippedCount+"표");
 let resultText="투표 결과\n"+(sorted.length?tallyLines.slice(0,-1).join("\n"):"득표 없음")+"\n"+tallyLines[tallyLines.length-1]+"\n\n";
 let jesterWon=false;
 if(sorted.length&&(!sorted[1]||sorted[0][1]>sorted[1][1])){
  const target=r.players.get(sorted[0][0]);
  if(target?.alive){
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
  resultText+="이번 투표에서는 아무도 탈락하지 않았습니다.";
 }
 const evilRemaining=alive(r).filter(p=>p.team==="evil").length;
 resultText+="\n악인팀이 "+evilRemaining+"명 남았습니다.";
 io.to(r.code).emit("voteResult",{text:resultText,counts:sorted.map(([id,count])=>({name:r.players.get(id)?.name||"알 수 없음",count})),skippedCount});
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
 s.emit("publicRooms",publicRoomList());
 s.on("quickJoin",name=>{
  name=clean(name);if(!name)return s.emit("errorMsg","닉네임을 입력해 주세요.");
  removeFromQueue(s.id);if(matchmakingQueue.some(x=>x.name.toLowerCase()===name.toLowerCase()))return s.emit("errorMsg","이미 대기 중인 닉네임입니다.");matchmakingQueue.push({id:s.id,name,socket:s});
  s.emit("queueStatus",{waiting:true,count:matchmakingQueue.length});
  runMatchmaking();
 });
 s.on("cancelQueue",()=>{removeFromQueue(s.id);s.emit("queueStatus",{waiting:false,count:matchmakingQueue.length});});
 s.on("listPublicRooms",()=>s.emit("publicRooms",[...rooms.values()].filter(r=>r.visibility==="public"&&r.phase==="lobby").map(r=>({code:r.code,count:r.players.size,maxPlayers:r.settings.maxPlayers}))));

 s.on("soloStart",payload=>{
  const data=payload&&typeof payload==="object"?payload:{name:payload};
  const name=clean(data.name);if(!name)return s.emit("errorMsg","닉네임을 입력해 주세요.");
  const settings=normalizeSettings(data.settings,6);
  const code=roomCode(),r={code,players:new Map(),host:s.id,phase:"lobby",day:0,log:[],endsAt:null,actions:{},votes:{},aiMode:true,settings};
  r.players.set(s.id,{id:s.id,name,alive:true,isBot:false});
  const botNames=["하늘","단풍","별이","구름","달빛","노을","바다","새벽","은하","초롱","가람","이슬","나래","도윤"];
  for(let i=1;i<settings.maxPlayers;i++){const id="bot_"+crypto.randomBytes(5).toString("hex");r.players.set(id,{id,name:botNames[(i-1)%botNames.length],alive:true,isBot:true,persona:BOT_PERSONAS[(i-1)%BOT_PERSONAS.length],botTalkCount:0,lastBotLine:""});}
  rooms.set(code,r);s.join(code);s.emit("joined",{code,aiMode:true});assign(r);log(r,"AI 대련 모드 시작! AI 플레이어 "+(settings.maxPlayers-1)+"명과 대결합니다.");sendState(r);
 });
 s.on("create",payload=>{const data=payload&&typeof payload==="object"?payload:{name:payload};const name=clean(data.name);if(!name)return s.emit("errorMsg","닉네임을 입력해 주세요.");const code=roomCode();const r={code,players:new Map(),host:s.id,phase:"lobby",day:0,log:[],endsAt:null,actions:{},votes:{},settings:normalizeSettings(data.settings,6),visibility:normalizeSettings(data.settings,6).visibility};r.players.set(s.id,{id:s.id,name,alive:true});rooms.set(code,r);s.join(code);s.emit("joined",{code});sendState(r);broadcastPublicRooms();});
 s.on("join",payload=>{const {code,name}=payload&&typeof payload==="object"?payload:{};const r=rooms.get(String(code||"").trim().toUpperCase()),n=clean(name);if(!r||!n||r.phase!=="lobby"||r.players.size>=(r.settings?.maxPlayers||15))return s.emit("errorMsg","방을 찾을 수 없거나 정원이 가득 찼습니다.");if([...r.players.values()].some(x=>x.name.toLowerCase()===n.toLowerCase()))return s.emit("errorMsg","이미 사용 중인 닉네임입니다.");r.players.set(s.id,{id:s.id,name:n,alive:true});s.join(r.code);s.emit("joined",{code:r.code});sendState(r);broadcastPublicRooms();});
 s.on("updateRoomSettings",payload=>{const r=[...rooms.values()].find(x=>x.players.has(s.id));if(!r||r.host!==s.id||r.phase!=="lobby")return s.emit("errorMsg","대기실 방장만 설정을 바꿀 수 있습니다.");const next=normalizeSettings(payload,r.players.size);if(next.maxPlayers<r.players.size)return s.emit("errorMsg","현재 참가 인원보다 정원을 적게 설정할 수 없습니다.");r.settings=next;r.visibility=next.visibility;log(r,"방장이 게임 설정을 변경했습니다.");sendState(r);broadcastPublicRooms();});
 s.on("start",()=>{const r=[...rooms.values()].find(x=>x.players.has(s.id));if(!r||r.host!==s.id||r.phase!=="lobby"||r.players.size<6||r.players.size>(r.settings?.maxPlayers||15))return s.emit("errorMsg","방장만 6명 이상, 설정 정원 이내일 때 시작할 수 있습니다.");assign(r);sendState(r);broadcastPublicRooms();});
 s.on("action",payload=>{const {type,target}=payload&&typeof payload==="object"?payload:{};const r=[...rooms.values()].find(x=>x.players.has(s.id)),p=r?.players.get(s.id),t=r?.players.get(target);if(!r||!p?.alive||!t||typeof type!=="string")return;
 if(type==="judge"){
  if(p.role!=="판사"||r.phase!=="night_judge"||!t.alive||p.id===t.id||p.used.judgeNight)return;
  r.actions["judge:"+p.id]={type:"judge",actor:p.id,target:t.id};
  p.used.judgeNight=true;recordAbility(p,r,t,"판결");
  io.to(r.code).emit("judgementAnnouncement",{text:"판사가 판결을 내렸습니다"});
  advanceNightTurn(r);return;
 }
 if(!String(r.phase).startsWith("night_"))return;
 if(type!=="revive"&&!t.alive)return;
 if(type==="revive"&&(t.alive||t.connected===false||p.used.revive))return;
 const allowed={의사:"heal",마피아:"attack",자경단:"vigilante",선교사:"convert",제사장:"revive"};
 if(allowed[p.role]!==type||p.id===t.id||r.phase!==NIGHT_PHASE_BY_TYPE[type])return;
 if(type==="attack"&&t.team==="evil"){s.emit("errorMsg","마피아는 같은 악인 팀을 공격할 수 없습니다.");return;}
 
 if(type==="revive"&&t.alive)return;
 if(type==="convert"&&p.used.convert)return;
 if(type==="vigilante"&&(p.role!=="자경단"||!p.used.vigilanteInvestigated||!p.vigilanteTargetId||p.vigilanteTargetId!==t.id||r.day<=p.vigilanteInvestigatedDay))return;
 r.actions[type+":"+p.id]={type,actor:p.id,target:t.id};
 const abilityLabels={heal:"치료",attack:"공격",judge:"처벌",vigilante:"공격",convert:"전향",revive:"부활"};recordAbility(p,r,t,abilityLabels[type]||type);
 if(p.role==="스파이"&&type==="spy"){s.emit("privateResult",{text:"상대 직업: "+t.role});if(t.role==="마피아"){p.joined=true;t.joined=true;log(r,"스파이가 마피아와 서로 정체를 확인했습니다.");}}
 advanceNightTurn(r);
 });
 s.on("special",payload=>{
  const {target}=payload&&typeof payload==="object"?payload:{};
  const r=[...rooms.values()].find(x=>x.players.has(s.id)),p=r?.players.get(s.id),t=r?.players.get(target);
  if(!r||!p?.alive||!t?.alive||p.id===t.id)return;
    if(p.role==="경찰"&&r.phase==="night_police"&&p.used.policeNight!==r.day){
   p.used.policeNight=r.day;recordAbility(p,r,t,"경찰 조사");
   s.emit("privateResult",{text:t.name+"님의 직업은 "+t.role+"입니다. (경찰에게만 공개)"});
   advanceNightTurn(r);
   return;
  }
  if(p.role==="스파이"&&r.phase==="night_spy"&&p.used.spyNight!==r.day){
   p.used.spyNight=r.day;recordAbility(p,r,t,"스파이 조사");
   s.emit("privateResult",{text:t.name+"님의 직업: "+t.role});
   if(t.role==="마피아"){p.joined=true;t.joined=true;log(r,"스파이와 마피아가 서로 정체를 확인했습니다.");}
   advanceNightTurn(r);
   return;
  }
  if(p.role==="자경단"&&r.phase==="night_vigilante"&&!p.used.vigilanteInvestigated){
   p.used.vigilanteInvestigated=true;p.vigilanteInvestigatedDay=r.day;
   p.vigilanteTargetId=t.team==="evil"?t.id:null;
   recordAbility(p,r,t,"자경단 조사");
   s.emit("privateResult",{text:t.name+"님 조사 결과: "+(t.team==="evil"?"악인입니다. 다음 밤에 이 대상을 공격할 수 있습니다.":"악인이 아닙니다. 자경단의 1회 조사는 끝났습니다.")});
   sendState(r);advanceNightTurn(r);return;
  }
  if(p.role==="기자"&&r.phase==="day_discuss"&&r.day>1&&p.used.reporterDay!==r.day){
   p.used.reporterDay=r.day;recordAbility(p,r,t,"기자 발표");
   const announcement="기자 발표: "+t.name+"님의 직업은 "+t.role+"입니다.";
   log(r,announcement);
   io.to(r.code).emit("reporterAnnouncement",{text:announcement});
   sendState(r);
   return;
  }

 });
 s.on("vote",target=>{const r=[...rooms.values()].find(x=>x.players.has(s.id)),p=r?.players.get(s.id),t=r?.players.get(target);if(!r||r.day===1||r.phase!=="day_vote"||r.resolvingVote||!p?.alive||!t?.alive||p.id===t.id||r.votes[s.id]||r.skippedVotes?.[s.id])return;r.votes[s.id]=target;fillBotVotes(r);sendState(r);if(allAliveVoted(r))resolveVote(r);});
 s.on("skipVote",()=>{const r=[...rooms.values()].find(x=>x.players.has(s.id)),p=r?.players.get(s.id);if(!r||r.day===1||r.phase!=="day_vote"||r.resolvingVote||!p?.alive||r.votes[s.id]||r.skippedVotes?.[s.id])return;r.skippedVotes=r.skippedVotes||{};r.skippedVotes[s.id]=true;fillBotVotes(r);sendState(r);if(allAliveVoted(r))resolveVote(r);});
 s.on("chat",payload=>{const {text:msg,team}=payload&&typeof payload==="object"?payload:{};const r=[...rooms.values()].find(x=>x.players.has(s.id)),p=r?.players.get(s.id);if(!r||!p||typeof msg!=="string"||!msg)return;const message=cleanMessage(msg);if(!message)return;
 if(team){if(!joinedEvil(p))return;for(const q of r.players.values())if(joinedEvil(q))io.to(q.id).emit("chat",{name:p.name,text:message,team:true});}
 else{if(!p.alive||r.phase==="ended")return;
  if(r.aiMode&&/(수상|의심|마피아|악인|거짓말|투표|몰아|이상하)/.test(message)){
   for(const b of alive(r).filter(x=>x.isBot)){
    if(message.includes(b.name))r.botSuspicion[b.id]=(r.botSuspicion[b.id]||0)+2;
   }
  }
  if(!r.botHistory)r.botHistory=[];r.botHistory.push({name:p.name,text:message,day:r.day,isBot:false});if(r.botHistory.length>40)r.botHistory.shift();if(r.aiMode&&r.phase==="day_discuss")r.nextBotChatAt=Math.min(r.nextBotChatAt||Date.now()+1000,Date.now()+1200+Math.floor(Math.random()*1000));io.to(r.code).emit("chat",{name:p.name,text:message,team:false});
 }
 });
 s.on("leaveRoom",()=>{for(const [code,r] of rooms){const p=r.players.get(s.id);if(!p)continue;s.leave(code);if(r.aiMode){rooms.delete(code);break;}r.players.delete(s.id);if(r.host===s.id)r.host=r.players.keys().next().value;if(!r.players.size)rooms.delete(code);else sendState(r);broadcastPublicRooms();break;}});
 s.on("disconnect",()=>{removeFromQueue(s.id);for(const [code,r] of rooms){const p=r.players.get(s.id);if(!p)continue;if(r.phase==="lobby"){r.players.delete(s.id);if(r.host===s.id)r.host=r.players.keys().next().value;if(!r.players.size)rooms.delete(code);else sendState(r);broadcastPublicRooms();}else if(p.alive){p.connected=false;p.alive=false;log(r,p.name+"님이 접속 종료로 게임에서 이탈했습니다.");const w=endCheck(r);if(w)finish(r,w);else{sendState(r);broadcastPublicRooms();if(r.phase==="day_vote"&&allAliveVoted(r))resolveVote(r);}}}});
});
const PORT=process.env.PORT||3000;server.listen(PORT,"0.0.0.0",()=>console.log("MAFIA ONLINE listening on "+PORT));