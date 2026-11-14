const socket=io();let state=null,teamMode=false,serverOffset=0;
const chatMessages={public:[],team:[]};let privateNotice="",announcementNotice="";
const $=id=>document.getElementById(id);
function err(t){$("error").textContent=t||""}
$("rulesOpen").onclick=()=>$("rulesModal").classList.remove("hidden");
$("rulesClose").onclick=()=>$("rulesModal").classList.add("hidden");
$("rulesModal").addEventListener("click",e=>{if(e.target.id==="rulesModal")$("rulesModal").classList.add("hidden")});
document.addEventListener("keydown",e=>{if(e.key==="Escape")$("rulesModal").classList.add("hidden")});

function emitAction(type,id){socket.emit("action",{type,target:id})}
const ROLE_SVG={
"시민":'<circle cx="32" cy="23" r="9"/><path d="M14 54c1-11 8-17 18-17s17 6 18 17"/>',
"의사":'<path d="M32 12v40M12 32h40"/><path d="M18 9h28v46H18z" opacity=".25"/>',
"경찰":'<path d="M32 7 53 16v15c0 13-9 22-21 27C20 53 11 44 11 31V16z"/><path d="m32 17 4 9 10 1-7 7 2 10-9-5-9 5 2-10-7-7 10-1z"/>',
"판사":'<path d="m17 17 12-8 9 13-12 8zM31 25l12-8 8 13-12 8zM17 48h34M23 42l19-12"/>',
"국회의원":'<path d="M10 48h44M15 43V25h34v18M21 25v-8h22v8M25 34h14M25 40h14"/>',
"기자":'<path d="M13 10h31v42H13zM20 19h17M20 27h17M20 35h10"/><path d="m37 42 5 5 10-13"/>',
"자경단":'<path d="M32 7 53 17v14c0 13-9 22-21 27C20 53 11 44 11 31V17z"/><path d="m35 17-12 18h9l-3 13 13-20h-9z"/>',
"제사장":'<path d="M32 9v35M20 20h24M18 55h28M24 44h16"/><path d="M23 9h18l-3 8H26z"/>',
"마피아":'<path d="M9 29c3-12 11-18 23-18s20 6 23 18H9zM7 31h50v7H7z"/><path d="M18 38v9h28v-9"/>',
"스파이":'<path d="M6 32s10-17 26-17 26 17 26 17-10 17-26 17S6 32 6 32z"/><circle cx="32" cy="32" r="8"/><path d="m12 52 40-40"/>',
"클러쳐":'<path d="M18 52V29c0-4 6-4 6 0v8-19c0-5 7-5 7 0v17-20c0-5 7-5 7 0v21-13c0-5 7-5 7 0v21c0 8-6 13-14 13H25z"/>',
"선교사":'<path d="M15 55V9M17 12h31l-8 10 8 10H17"/><path d="M26 18v9M22 22h8"/>',
"궁정광대":'<path d="M13 48c7-2 12-7 19-7s12 5 19 7l-4-29-15 9-15-9z"/><circle cx="13" cy="17" r="5"/><circle cx="51" cy="17" r="5"/><circle cx="32" cy="9" r="5"/><path d="M25 51q7 7 14 0"/>'
};
function roleSvg(role){
 if(!ROLE_SVG[role])return "";
 const evil=["마피아","스파이","클러쳐","선교사"].includes(role),solo=role==="궁정광대";
 const stroke=evil?"#ff7185":solo?"#d5a6ff":"#75c7ff";
 return '<svg viewBox="0 0 64 64" fill="none" stroke="'+stroke+'" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="32" cy="32" r="28" stroke-opacity=".28"/>'+ROLE_SVG[role]+'</svg>';
}
function button(label,fn,disabled=false){const b=document.createElement("button");b.textContent=label;b.disabled=disabled;b.onclick=fn;return b}
$("solo").onclick=()=>{err("");if(!$("name").value.trim())return err("닉네임을 먼저 입력해 주세요.");socket.emit("soloStart",$("name").value)};
$("quick").onclick=()=>{err("");if(!$("name").value.trim())return err("닉네임을 먼저 입력해 주세요.");socket.emit("quickJoin",$("name").value)};
socket.on("queueStatus",d=>{if(d.waiting){$("home").classList.remove("hidden");$("game").classList.add("hidden");err("자동 매칭 대기 중… 현재 대기 인원 "+d.count+"명 (최소 6명)");}else err("매칭 대기가 취소되었습니다.");});
$("create").onclick=()=>{err("");socket.emit("create",$("name").value)};
$("join").onclick=()=>{err("");socket.emit("join",{name:$("name").value,code:$("code").value})};
socket.on("joined",d=>{$("home").classList.add("hidden");$("game").classList.remove("hidden");$("room").textContent="ROOM "+d.code;chatMessages.public=[];chatMessages.team=[];teamMode=false;if(d.aiMode){$("chatTitle").textContent="전체 대화 · AI 대련";$("message").placeholder="AI와 다른 플레이어에게 메시지 보내기";$("chatPanel").classList.remove("hidden");}else $("chatPanel").classList.add("hidden")});
socket.on("errorMsg",err);
socket.on("privateResult",d=>{privateNotice=d.text;render()});
socket.on("reporterAnnouncement",d=>{announcementNotice=d.text;render()});
socket.on("state",s=>{if(state&&state.day!==s.day){privateNotice="";announcementNotice="";}state=s;if(Number.isFinite(s.serverNow))serverOffset=s.serverNow-Date.now();render()});
function render(){if(!state)return;const me=state.me;
 $("phase").textContent=({lobby:"대기실",night_mafia:"밤 · 마피아 차례",night_vigilante:"밤 · 자경단 차례",night_missionary:"밤 · 선교사 차례",night_police:"밤 · 경찰 차례",night_spy:"밤 · 스파이 차례",night_doctor:"밤 · 의사 차례",night_priest:"밤 · 제사장 차례",day_discuss:"낮 · 토론",day_vote:"낮 · 투표",ended:"게임 종료"})[state.phase]||state.phase;
 $("role").textContent=me?.role?(me.isPresident?"대통령 · 국회의원":me.role):"대기 중";$("team").textContent=me?.team==="evil"?"악인 진영":me?.team==="good"?"선량한 진영":me?.team==="solo"?"개인 진영":"";$("roleIllustration").innerHTML=roleSvg(me?.role);
 const abilityNotice=me?.lastAbility&&me.lastAbility.day===state.day&&me.lastAbility.phase===state.phase?"능력 사용 완료 · "+me.lastAbility.label+" → "+me.lastAbility.targetName:"";
 $("notice").textContent=privateNotice||announcementNotice||abilityNotice||(state.aiMode?"AI 대련 모드 · AI 플레이어 5명과 대결 중":state.winner?state.winner+" 승리!":state.phase==="lobby"?"6명 이상 모이면 방장이 시작할 수 있어요.":me?.alive?"당신의 선택으로 게임의 흐름을 바꾸세요.":"관전 중입니다.");
 $("timer").textContent=state.endsAt?"남은 시간 "+Math.max(0,Math.ceil((state.endsAt-(Date.now()+serverOffset))/1000))+"초":"";
 const list=$("players");list.innerHTML="";
 state.players.forEach(p=>{const d=document.createElement("div");d.className="player"+(!p.alive?" dead":"");if(p.role){const art=document.createElement("span");art.className="player-role-icon";art.innerHTML=roleSvg(p.role);d.append(art);}const name=document.createElement("span");name.textContent=p.name+(p.id===me?.id?" (나)":"")+(p.role?" · "+p.role:"");d.append(name);const isNight=String(state.phase).startsWith("night_");const priestReviveTarget=state.phase==="night_priest"&&me?.role==="제사장";
 if(me?.alive&&p.id!==me.id&&(priestReviveTarget?!p.alive:p.alive)){let label=null,fn=null;
 if(isNight){const rolePhase={마피아:"night_mafia",자경단:"night_vigilante",선교사:"night_missionary",의사:"night_doctor",제사장:"night_priest"};const map={의사:["치료","heal"],마피아:["공격","attack"],선교사:["전향","convert"],제사장:["부활","revive"]};if(state.phase===rolePhase[me.role]&&map[me.role]){label=map[me.role][0];fn=()=>emitAction(map[me.role][1],p.id)}if(state.phase==="night_vigilante"&&me.role==="자경단"){
  if(!me.vigilanteInvestigated){label="1회 조사";fn=()=>socket.emit("special",{target:p.id})}
  else if(me.vigilanteTargetId===p.id&&state.day>me.vigilanteInvestigatedDay){label="조사한 악인 공격";fn=()=>emitAction("vigilante",p.id)}
 }}
 if(state.phase==="day_vote"){
  if(me.role==="판사"){d.append(button(me.judgeUsed?"판결 완료":"판결",()=>emitAction("judge",p.id),!!me.judgeUsed));}
  d.append(button(me.hasVoted?"투표 완료":"투표",()=>socket.emit("vote",p.id),!!me.hasVoted));
 }
 if((state.phase==="night_police"&&me.role==="경찰")||(state.phase==="night_spy"&&me.role==="스파이")){label=me.role==="경찰"?"조사":"직업 조사";fn=()=>socket.emit("special",{target:p.id})}
 if(state.phase==="day_discuss"&&state.day>1&&me.role==="기자"){label="기사 발표";fn=()=>socket.emit("special",{target:p.id})}
 if(label){const usedReporter=me?.role==="기자"&&state.phase==="day_discuss"&&me.reporterUsed;const usedVigilante=false;d.append(button(usedReporter?"오늘 발표 완료":usedVigilante?"오늘 조사 완료":label,fn,!!usedReporter||!!usedVigilante));}}list.append(d)});
 $("controls").innerHTML="";if(state.phase==="lobby"&&state.host===me?.id)$("controls").append(button("게임 시작",()=>socket.emit("start"),state.players.length<6));
 $("log").innerHTML="";(state.log||[]).forEach(x=>{const d=document.createElement("div");d.textContent=x.day+"일차 · "+x.text;$("log").append(d)});
 $("teamChatToggle").classList.toggle("hidden",!state.teamChatAllowed);
 $("teamChatToggle").setAttribute("aria-label",state.teamChatAllowed?"악인팀 대화 열기":"악인팀 대화 사용 불가");
}
function openChat(team){teamMode=team;$("chatTitle").textContent=team?"악인팀 대화":"전체 대화";$("message").placeholder=team?"악인팀에게 메시지 보내기":"전체에게 메시지 보내기";$("chatPanel").classList.remove("hidden");renderChat();$("message").focus()}
function renderChat(){$("chat").innerHTML="";(chatMessages[teamMode?"team":"public"]||[]).forEach(m=>{const d=document.createElement("div");d.textContent=(teamMode?"[악인팀] ":"")+m.name+": "+m.text;$("chat").append(d)});$("chat").scrollTop=$("chat").scrollHeight}
$("publicChatToggle").onclick=()=>openChat(false);
$("teamChatToggle").onclick=()=>{if(state?.teamChatAllowed)openChat(true)};
$("closeChat").onclick=()=>$("chatPanel").classList.add("hidden");
$("send").onclick=sendChat;$("message").addEventListener("keydown",e=>{if(e.key==="Enter")sendChat()});
function sendChat(){const text=$("message").value.trim();if(!text)return;if(teamMode&&!state?.teamChatAllowed)return err("악인팀 대화 권한이 없습니다.");socket.emit("chat",{text,team:teamMode});$("message").value=""}
socket.on("chat",m=>{const key=m.team?"team":"public";chatMessages[key].push(m);if(chatMessages[key].length>100)chatMessages[key].shift();if(teamMode===!!m.team&&!$("chatPanel").classList.contains("hidden"))renderChat()});
setInterval(()=>{if(state?.endsAt){const left=Math.max(0,Math.ceil((state.endsAt-(Date.now()+serverOffset))/1000));$("timer").textContent="남은 시간 "+left+"초";}},100);
socket.on("voteResult",d=>{
 $("voteResultText").textContent=d.text;
 $("voteResultOverlay").classList.remove("hidden");
 clearTimeout(window.voteResultTimer);
 window.voteResultTimer=setTimeout(()=>$("voteResultOverlay").classList.add("hidden"),5000);
});
socket.on("nightResult",d=>{
 $("voteResultText").textContent=d.text;
 $("voteResultOverlay").classList.remove("hidden");
 clearTimeout(window.voteResultTimer);
 window.voteResultTimer=setTimeout(()=>$("voteResultOverlay").classList.add("hidden"),5000);
});