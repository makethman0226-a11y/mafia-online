const socket=io();let state=null,teamMode=false,serverOffset=0;
const chatMessages={public:[],team:[]};let privateNotice="",announcementNotice="";
const $=id=>document.getElementById(id);
function err(t){$("error").textContent=t||""}
function emitAction(type,id){socket.emit("action",{type,target:id})}
function button(label,fn,disabled=false){const b=document.createElement("button");b.textContent=label;b.disabled=disabled;b.onclick=fn;return b}
$("solo").onclick=()=>{err("");if(!$("name").value.trim())return err("닉네임을 먼저 입력해 주세요.");socket.emit("soloStart",$("name").value)};
$("quick").onclick=()=>{err("");if(!$("name").value.trim())return err("닉네임을 먼저 입력해 주세요.");socket.emit("quickJoin",$("name").value)};
socket.on("queueStatus",d=>{if(d.waiting){$("home").classList.remove("hidden");$("game").classList.add("hidden");err("자동 매칭 대기 중… 현재 대기 인원 "+d.count+"명 (최소 6명)");}else err("매칭 대기가 취소되었습니다.");});
$("create").onclick=()=>{err("");socket.emit("create",$("name").value)};
$("join").onclick=()=>{err("");socket.emit("join",{name:$("name").value,code:$("code").value})};
socket.on("joined",d=>{$("home").classList.add("hidden");$("game").classList.remove("hidden");$("room").textContent="ROOM "+d.code;chatMessages.public=[];chatMessages.team=[];$("chatPanel").classList.add("hidden")});
socket.on("errorMsg",err);
socket.on("privateResult",d=>{privateNotice=d.text;render()});
socket.on("reporterAnnouncement",d=>{announcementNotice=d.text;render()});
socket.on("state",s=>{if(state&&(state.phase!==s.phase||state.day!==s.day)){privateNotice="";announcementNotice="";}state=s;if(Number.isFinite(s.serverNow))serverOffset=s.serverNow-Date.now();render()});
function render(){if(!state)return;const me=state.me;
 $("phase").textContent=({lobby:"대기실",night:"밤",day_discuss:"낮 · 토론",day_vote:"낮 · 투표",ended:"게임 종료"})[state.phase]||state.phase;
 $("role").textContent=me?.role?(me.isPresident?"대통령 · 국회의원":me.role):"대기 중";$("team").textContent=me?.team==="evil"?"악인 진영":me?.team==="good"?"선량한 진영":me?.team==="solo"?"개인 진영":"";
 const abilityNotice=me?.lastAbility&&me.lastAbility.day===state.day&&me.lastAbility.phase===state.phase?"능력 사용 완료 · "+me.lastAbility.label+" → "+me.lastAbility.targetName:"";
 $("notice").textContent=privateNotice||announcementNotice||abilityNotice||(state.aiMode?"AI 대련 모드 · AI 플레이어 5명과 대결 중":state.winner?state.winner+" 승리!":state.phase==="lobby"?"6명 이상 모이면 방장이 시작할 수 있어요.":me?.alive?"당신의 선택으로 게임의 흐름을 바꾸세요.":"관전 중입니다.");
 $("timer").textContent=state.endsAt?"남은 시간 "+Math.max(0,Math.ceil((state.endsAt-(Date.now()+serverOffset))/1000))+"초":"";
 const list=$("players");list.innerHTML="";
 state.players.forEach(p=>{const d=document.createElement("div");d.className="player"+(!p.alive?" dead":"");d.textContent=p.name+(p.id===me?.id?" (나)":"")+(p.role?" · "+p.role:"");const priestReviveTarget=state.phase==="night"&&me?.role==="제사장";
 if(me?.alive&&p.id!==me.id&&(priestReviveTarget?!p.alive:p.alive)){let label=null,fn=null;
 if(state.phase==="night"){const map={의사:["치료","heal"],마피아:["공격","attack"],판사:["처벌","judge"],자경단:["공격","vigilante"],선교사:["전향","convert"],제사장:["부활","revive"]};if(map[me.role]){label=map[me.role][0];fn=()=>emitAction(map[me.role][1],p.id)}}
 if(state.phase==="day_vote"){label="투표";fn=()=>socket.emit("vote",p.id)}
 if(state.phase==="night"&&(me.role==="경찰"||me.role==="스파이")){label=me.role==="경찰"?"조사":"직업 조사";fn=()=>socket.emit("special",{target:p.id})}
 if(state.phase==="day_discuss"&&me.role==="기자"){label="기사 발표";fn=()=>socket.emit("special",{target:p.id})}
 if(state.phase==="day_discuss"&&me.role==="자경단"){label="대상 조사";fn=()=>socket.emit("special",{target:p.id})}
 if(label){const usedVote=state.phase==="day_vote"&&me?.hasVoted;const usedReporter=me?.role==="기자"&&state.phase==="day_discuss"&&me.reporterUsed;d.append(button(usedVote?"투표 완료":usedReporter?"오늘 발표 완료":label,fn,!!usedVote||!!usedReporter));}}list.append(d)});
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