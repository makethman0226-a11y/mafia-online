const socket=io();let state=null,teamMode=false;
const $=id=>document.getElementById(id);
function err(t){$("error").textContent=t||""}
function emitAction(type,id){socket.emit("action",{type,target:id})}
function button(label,fn,disabled=false){const b=document.createElement("button");b.textContent=label;b.disabled=disabled;b.onclick=fn;return b}
$("quick").onclick=()=>{err("");if(!$("name").value.trim())return err("닉네임을 먼저 입력해 주세요.");socket.emit("quickJoin",$("name").value)};
socket.on("queueStatus",d=>{if(d.waiting){$("home").classList.remove("hidden");$("game").classList.add("hidden");err("자동 매칭 대기 중… 현재 대기 인원 "+d.count+"명 (최소 6명)");}else err("매칭 대기가 취소되었습니다.");});
$("create").onclick=()=>{err("");socket.emit("create",$("name").value)};
$("join").onclick=()=>{err("");socket.emit("join",{name:$("name").value,code:$("code").value})};
socket.on("joined",d=>{$("home").classList.add("hidden");$("game").classList.remove("hidden");$("room").textContent="ROOM "+d.code});
socket.on("errorMsg",err);
socket.on("privateResult",d=>{$("notice").textContent=d.text});
socket.on("state",s=>{state=s;render()});
function render(){if(!state)return;const me=state.me;$("phase").textContent=({lobby:"대기실",night:"밤",day_discuss:"낮 · 토론",day_vote:"낮 · 투표",ended:"게임 종료"})[state.phase]||state.phase;$("role").textContent=me?.role||"대기 중";$("team").textContent=me?.team==="evil"?"악인 진영":me?.team==="good"?"선량한 진영":me?.team==="solo"?"개인 진영":"";$("notice").textContent=state.winner?state.winner+" 승리!":state.phase==="lobby"?"6명 이상 모이면 방장이 시작할 수 있어요.":me?.alive?"당신의 선택으로 게임의 흐름을 바꾸세요.":"관전 중입니다.";
$("timer").textContent=state.endsAt?Math.max(0,Math.ceil((state.endsAt-Date.now())/1000))+"초":"";
const list=$("players");list.innerHTML="";state.players.forEach(p=>{const d=document.createElement("div");d.className="player"+(!p.alive?" dead":"");d.textContent=p.name+(p.id===me?.id?" (나)":"")+(p.role?" · "+p.role:"");if(me?.alive&&p.id!==me.id&&(p.alive||(state.phase==="night"&&me.role==="제사장"))){let label=null,fn=null;
if(state.phase==="night"){const map={의사:["치료","heal"],마피아:["공격","attack"],판사:["처벌","judge"],자경단:["공격","vigilante"],선교사:["전향","convert"],제사장:["부활","revive"]};if(map[me.role]){label=map[me.role][0];fn=()=>emitAction(map[me.role][1],p.id)}}
if(state.phase==="day_vote"){label="투표";fn=()=>socket.emit("vote",p.id)}
if(state.phase==="night"&&(me.role==="경찰"||me.role==="스파이")){label=me.role==="경찰"?"조사":"직업 조사";fn=()=>socket.emit("special",{target:p.id})}
if(state.phase==="day_discuss"&&me.role==="기자"){label="기사 발표";fn=()=>socket.emit("special",{target:p.id})}
if(state.phase==="day_discuss"&&me.role==="자경단"){label="대상 조사";fn=()=>socket.emit("special",{target:p.id})}
if(label)d.append(button(label,fn));}list.append(d)});
$("controls").innerHTML="";if(state.phase==="lobby"&&state.host===me?.id){$("controls").append(button("게임 시작",()=>socket.emit("start"),state.players.length<6));}
$("log").innerHTML="";(state.log||[]).forEach(x=>{const d=document.createElement("div");d.textContent=x.day+"일차 · "+x.text;$("log").append(d)});
$("teamChat").classList.toggle("hidden",!state.teamChatAllowed);
}
$("send").onclick=sendChat;$("message").addEventListener("keydown",e=>{if(e.key==="Enter")sendChat()});
function sendChat(){const text=$("message").value.trim();if(!text)return;socket.emit("chat",{text,team:teamMode&&state?.teamChatAllowed});$("message").value=""}
$("teamChat").onclick=()=>{teamMode=!teamMode;$("teamChat").textContent=teamMode?"전체 채팅으로 전환":"악인팀 채팅 보기"};
socket.on("chat",m=>{if(m.team!==teamMode)return;const d=document.createElement("div");d.textContent=(m.team?"[악인팀] ":"")+m.name+": "+m.text;$("chat").append(d);$("chat").scrollTop=$("chat").scrollHeight});
setInterval(()=>{if(state?.endsAt)$("timer").textContent=Math.max(0,Math.ceil((state.endsAt-Date.now())/1000))+"초"},250);