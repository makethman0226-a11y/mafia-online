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
const ROLES = {
 시민:{team:"good"}, 의사:{team:"good"}, 경찰:{team:"good"}, 판사:{team:"good"},
 국회의원:{team:"good"}, 기자:{team:"good"}, 자경단:{team:"good"}, 제사장:{team:"good"},
 마피아:{team:"evil"}, 스파이:{team:"evil"}, 클러쳐:{team:"evil"}, 선교사:{team:"evil"},
 궁정광대:{team:"solo"}
};
const clean = s => String(s || "").replace(/[<>]/g,"").trim().slice(0,18);
function roomCode(){ return crypto.randomBytes(3).toString("hex").toUpperCase(); }
function emitRoom(r){ io.to(r.code).emit("state", publicState(r)); }
function publicState(r){
 return {code:r.code,phase:r.phase,day:r.day,players:[...r.players.values()].map(p=>({id:p.id,name:p.name,alive:p.alive,role:r.phase==="ended"||!p.alive||p.id===p.viewerId?p.role:null})),host:r.host,endsAt:r.endsAt,log:r.log.slice(-30),winner:r.winner};
}
function viewFor(r,p){
 const st=publicState(r); st.me={id:p.id,name:p.name,role:p.role,alive:p.alive,team:p.team,joined:p.joined,canVote:p.alive&&r.phase==="day_vote"};
 st.players=[...r.players.values()].map(x=>({id:x.id,name:x.name,alive:x.alive,role:r.phase==="ended"||!x.alive||x.id===p.id?x.role:null}));
 st.teamChatAllowed=!!(p.alive&&p.team==="evil"&&p.joined);
 return st;
}
function sendState(r){ for(const p of r.players.values()) io.to(p.id).emit("state",viewFor(r,p)); }
function log(r,msg){r.log.push({day:r.day,text:msg}); if(r.log.length>100)r.log.shift();}
function alive(r){return [...r.players.values()].filter(p=>p.alive);}
function assign(r){
 const n=r.players.size, roles=["마피아","스파이","클러쳐","선교사","궁정광대","의사","경찰","판사","국회의원","기자","자경단","제사장"];
 while(roles.length<n)roles.push("시민");
 const shuffled=[...roles].sort(()=>Math.random()-.5);
 [...r.players.values()].forEach((p,i)=>{p.role=shuffled[i];p.team=ROLES[p.role].team;p.alive=true;p.joined=p.role==="마피아";p.used={};p.viewerId=p.id;});
 r.phase="night";r.day=1;r.actions={};r.votes={};r.endsAt=Date.now()+30000;
 log(r,"게임 시작! 밤이 되었습니다.");
}
function joinedEvil(p){return p.team==="evil"&&p.joined&&p.alive;}
function endCheck(r){
 const a=alive(r), evil=a.filter(p=>p.team==="evil").length, good=a.filter(p=>p.team==="good").length, solo=a.find(p=>p.role==="궁정광대");
 if(!a.length)return "무승부";
 if(solo&&solo.alive&&a.length===1)return "궁정광대";
 if(evil===0)return "선량한 팀";
 if(evil>=good)return "악인 팀";
 return null;
}
function finish(r,w){r.phase="ended";r.winner=w;r.endsAt=null;log(r,w+" 승리!");sendState(r);}
function nightResolve(r){
 const a=alive(r), act=r.actions;
 const mafia=Object.values(act).filter(x=>x.type==="attack").map(x=>x.target).filter(Boolean);
 const target=mafia[0], save=Object.values(act).find(x=>x.type==="heal")?.target;
 if(target&&target!==save){const victim=r.players.get(target);if(victim?.alive){victim.alive=false;log(r,(victim.role==="클러쳐"?"정체가 공개된 클러쳐가 탈락했습니다.":victim.name+"님이 밤에 탈락했습니다."));}}
 const judge=Object.values(act).find(x=>x.type==="judge");
 if(judge){const j=r.players.get(judge.actor), t=r.players.get(judge.target);if(j?.alive){if(t&&t.team==="evil"){t.alive=false;log(r,"판사의 처벌로 한 명이 탈락했습니다.");}else{j.alive=false;log(r,"판사가 잘못 판단해 탈락했습니다.");}}}
 const vigil=Object.values(act).find(x=>x.type==="vigilante");
 if(vigil){const v=r.players.get(vigil.actor),t=r.players.get(vigil.target);if(v?.alive&&t?.alive&&t.team==="evil"){t.alive=false;log(r,"자경단의 행동으로 악인 한 명이 탈락했습니다.");}}
 for(const x of Object.values(act)){const p=r.players.get(x.actor),t=r.players.get(x.target);if(!p?.alive||!t)continue;
  if(x.type==="convert"){if(t.team==="good"&&!p.used.convert){t.team="evil";t.joined=true;p.used.convert=true;log(r,"진영에 변화가 생겼습니다.");}else if(t.team==="evil"){p.alive=false;log(r,"선교사가 잘못 전향을 시도해 탈락했습니다.");}}
  if(x.type==="revive"&&p.role==="제사장"&&!p.used.revive&&!t.alive){t.alive=true;p.used.revive=true;log(r,"제사장의 능력으로 한 명이 부활했습니다.");}
 }
 const w=endCheck(r);if(w)return finish(r,w);
 r.phase="day_discuss";r.endsAt=Date.now()+60000;r.actions={};log(r,"아침입니다. 토론을 시작하세요.");sendState(r);
}
function nextVote(r){r.phase="day_vote";r.votes={};r.endsAt=Date.now()+30000;log(r,"투표가 시작되었습니다.");sendState(r);}
function resolveVote(r){
 const counts={};for(const [v,t] of Object.entries(r.votes)){const p=r.players.get(v);if(p?.alive)counts[t]=(counts[t]||0)+(p.role==="국회의원"?2:1);}
 const sorted=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
 if(sorted.length&&(!sorted[1]||sorted[0][1]>sorted[1][1])){
  const target=r.players.get(sorted[0][0]);if(target?.alive&&target.role!=="국회의원"){target.alive=false;log(r,target.role==="궁정광대"?"궁정광대가 투표로 탈락했습니다!":target.name+"님이 투표로 탈락했습니다.");if(target.role==="궁정광대")return finish(r,"궁정광대");}
  else log(r,"투표 결과 처벌 대상이 없습니다.");
 }else log(r,"동점 또는 투표 없음: 아무도 탈락하지 않았습니다.");
 const w=endCheck(r);if(w)return finish(r,w);
 r.phase="night";r.day++;r.actions={};r.endsAt=Date.now()+30000;log(r,"밤이 되었습니다.");sendState(r);
}
setInterval(()=>{for(const r of rooms.values()){if(!r.endsAt||Date.now()<r.endsAt)continue;
 if(r.phase==="night")nightResolve(r);else if(r.phase==="day_discuss")nextVote(r);else if(r.phase==="day_vote")resolveVote(r);
}},500);
io.on("connection",s=>{
 s.on("create",name=>{name=clean(name);if(!name)return;const code=roomCode();const r={code,players:new Map(),host:s.id,phase:"lobby",day:0,log:[],endsAt:null,actions:{},votes:{}};r.players.set(s.id,{id:s.id,name,alive:true});rooms.set(code,r);s.join(code);s.emit("joined",{code});sendState(r);});
 s.on("join",({code,name})=>{const r=rooms.get(String(code||"").toUpperCase()),n=clean(name);if(!r||!n||r.phase!=="lobby"||r.players.size>=15)return s.emit("errorMsg","방을 찾을 수 없거나 입장할 수 없습니다.");r.players.set(s.id,{id:s.id,name:n,alive:true});s.join(r.code);s.emit("joined",{code:r.code});sendState(r);});
 s.on("start",()=>{const r=[...rooms.values()].find(x=>x.players.has(s.id));if(!r||r.host!==s.id||r.phase!=="lobby"||r.players.size<6)return s.emit("errorMsg","방장만 6명 이상일 때 시작할 수 있습니다.");assign(r);sendState(r);});
 s.on("action",({type,target})=>{const r=[...rooms.values()].find(x=>x.players.has(s.id)),p=r?.players.get(s.id),t=r?.players.get(target);if(!r||!p?.alive||!t||r.phase!=="night")return;\n if(type!=="revive"&&!t.alive)return;\n if(type==="revive"&&t.alive)return;
 const allowed={의사:"heal",마피아:"attack",판사:"judge",자경단:"vigilante",선교사:"convert",제사장:"revive"};
 if(allowed[p.role]!==type||p.id===t.id)return;
 if(type==="revive"&&t.alive)return;
 if(type==="convert"&&(p.used.convert||t.team!=="good"))return;
 r.actions[type+":"+p.id]={type,actor:p.id,target:t.id};
 if(p.role==="경찰"&&type==="inspect")s.emit("privateResult",{text:t.team==="evil"?"악인 진영입니다.":"악인 진영이 아닙니다."});
 if(p.role==="스파이"&&type==="spy"){s.emit("privateResult",{text:"상대 직업: "+t.role});if(t.role==="마피아"){p.joined=true;t.joined=true;log(r,"스파이가 마피아와 서로 정체를 확인했습니다.");}}
 if(type==="revive"&&p.used.revive)return;
 sendState(r);
 });
 s.on("special",({target})=>{const r=[...rooms.values()].find(x=>x.players.has(s.id)),p=r?.players.get(s.id),t=r?.players.get(target);if(!r||!p?.alive||!t?.alive)return;
 if(p.role==="경찰"&&r.phase==="night"){const res=t.team==="evil"?"악인 진영입니다.":"악인 진영이 아닙니다.";s.emit("privateResult",{text:res});}
 if(p.role==="스파이"&&r.phase==="night"){s.emit("privateResult",{text:"상대 직업: "+t.role});if(t.role==="마피아"){p.joined=true;t.joined=true;sendState(r);}}
 if(p.role==="기자"&&r.phase==="day_discuss")log(r,"기자 발표: "+t.name+"님을 주목하세요.");
 if(p.role==="자경단"&&r.phase==="day_discuss")s.emit("privateResult",{text:t.team==="evil"?"악인입니다. 밤에 행동할 수 있습니다.":"악인이 아닙니다."});
 sendState(r);
 });
 s.on("vote",target=>{const r=[...rooms.values()].find(x=>x.players.has(s.id)),p=r?.players.get(s.id),t=r?.players.get(target);if(!r||r.phase!=="day_vote"||!p?.alive||!t?.alive)return;r.votes[s.id]=target;sendState(r);});
 s.on("chat",({text:msg,team})=>{const r=[...rooms.values()].find(x=>x.players.has(s.id)),p=r?.players.get(s.id);if(!r||!p||!msg)return;const message=clean(msg).slice(0,160);if(!message)return;
 if(team){if(!joinedEvil(p))return;for(const q of r.players.values())if(joinedEvil(q))io.to(q.id).emit("chat",{name:p.name,text:message,team:true});}
 else{if(!p.alive||r.phase==="ended")return;io.to(r.code).emit("chat",{name:p.name,text:message,team:false});}
 });
 s.on("disconnect",()=>{for(const r of rooms.values()){const p=r.players.get(s.id);if(p&&r.phase==="lobby"){r.players.delete(s.id);if(r.host===s.id)r.host=r.players.keys().next().value;sendState(r);}else if(p){p.connected=false;}}});
});
const PORT=process.env.PORT||3000;server.listen(PORT,"0.0.0.0",()=>console.log("MAFIA ONLINE listening on "+PORT));