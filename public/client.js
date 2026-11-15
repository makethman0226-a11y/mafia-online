const socket=io();let state=null,teamMode=false,serverOffset=0,judgeMode=false;
const chatMessages={public:[],team:[]};let privateNotice="",announcementNotice="";
const $=id=>document.getElementById(id);
const CONFIGURABLE_ROLES=["스파이","클러쳐","선교사","궁정광대","의사","경찰","판사","국회의원","기자","자경단","제사장"];
function fillSettingSelect(select,from,to,value){select.innerHTML="";for(let n=from;n<=to;n++){const o=document.createElement("option");o.value=String(n);o.textContent=n+"명";select.append(o);}select.value=String(value);}
function readSetupSettings(){return {maxPlayers:Number($("setupMaxPlayers").value),evilCount:Number($("setupEvilCount").value),discussionSeconds:Number($("setupDiscussionSeconds").value),voteSeconds:Number($("setupVoteSeconds").value),visibility:$("setupVisibility").value,excludedRoles:[...$("setupExcluded").querySelectorAll("input:checked")].map(x=>x.value)};}
function buildSettingsEditor(container,settings,editable,prefix){
 container.innerHTML="";
 const title=document.createElement("h3");title.textContent=prefix==="setup"?"게임 설정":"방 설정";container.append(title);
 const hint=document.createElement("p");hint.className="settings-hint";hint.textContent=editable?"게임 시작 전까지 방장이 변경할 수 있습니다.":"현재 적용된 설정";container.append(hint);
 const row=document.createElement("div");row.className="settings-row";
 const maxLabel=document.createElement("label");maxLabel.textContent="최대 인원";const max=document.createElement("select");max.id=prefix+"MaxPlayers";fillSettingSelect(max,6,15,settings?.maxPlayers||10);max.disabled=!editable;maxLabel.append(max);
 const evilLabel=document.createElement("label");evilLabel.textContent="악인 수";const evil=document.createElement("select");evil.id=prefix+"EvilCount";fillSettingSelect(evil,1,Math.min(3,(settings?.maxPlayers||10)-2),settings?.evilCount||2);evil.disabled=!editable;evilLabel.append(evil);row.append(maxLabel,evilLabel);container.append(row);
 const sub=document.createElement("div");sub.className="settings-hint";sub.textContent="제외할 직업";container.append(sub);
 const checks=document.createElement("div");checks.className="role-checks";checks.id=prefix+"Excluded";
 for(const role of CONFIGURABLE_ROLES){const label=document.createElement("label");label.className="role-check";const input=document.createElement("input");input.type="checkbox";input.value=role;input.checked=(settings?.excludedRoles||[]).includes(role);input.disabled=!editable;label.append(input,document.createTextNode(role));checks.append(label);}container.append(checks);
 const timing=document.createElement("div");timing.className="settings-row";
 const discussionLabel=document.createElement("label");discussionLabel.textContent="토론 시간";const discussion=document.createElement("select");discussion.id=prefix+"DiscussionSeconds";[30,45,60,90,120,180,300].forEach(v=>{const o=document.createElement("option");o.value=String(v);o.textContent=v+"초";discussion.append(o);});discussion.value=String(settings?.discussionSeconds||60);discussion.disabled=!editable;discussionLabel.append(discussion);
 const voteLabel=document.createElement("label");voteLabel.textContent="투표 시간";const vote=document.createElement("select");vote.id=prefix+"VoteSeconds";[30,60,90,120,180,300].forEach(v=>{const o=document.createElement("option");o.value=String(v);o.textContent=v+"초";vote.append(o);});vote.value=String(settings?.voteSeconds||120);vote.disabled=!editable;voteLabel.append(vote);timing.append(discussionLabel,voteLabel);container.append(timing);
 const visibilityLabel=document.createElement("label");visibilityLabel.textContent="서버 공개 설정";const visibility=document.createElement("select");visibility.id=prefix+"Visibility";[["public","공개 서버"],["private","비공개 서버"]].forEach(([v,t])=>{const o=document.createElement("option");o.value=v;o.textContent=t;visibility.append(o);});visibility.value=settings?.visibility||"public";visibility.disabled=!editable;visibilityLabel.append(visibility);container.append(visibilityLabel);
 if(editable){max.addEventListener("change",()=>{fillSettingSelect(evil,1,Math.min(3,Number(max.value)-2),Math.min(Number(evil.value),3,Number(max.value)-2));});}
 return {max,evil,checks};
}
function setupSettings(){const box=$("setupSettings");buildSettingsEditor(box,{maxPlayers:10,evilCount:2,excludedRoles:[]},true,"setup");}
function renderPublicRooms(rooms){const box=$("publicRoomList");if(!box)return;box.innerHTML="";if(!rooms?.length){box.textContent="현재 공개 대기실이 없습니다.";return;}rooms.forEach(r=>{const row=document.createElement("div");row.className="public-room-row";const info=document.createElement("span");info.textContent="방 "+r.code+" · "+r.count+"/"+r.maxPlayers+"명";row.append(info,button("참가",()=>{if(!$("name").value.trim())return err("닉네임을 먼저 입력해 주세요.");socket.emit("join",{name:$("name").value,code:r.code});}));box.append(row);});}
function err(t){$("error").textContent=t||""}
$("rulesOpen").onclick=()=>$("rulesModal").classList.remove("hidden");
$("rulesClose").onclick=()=>$("rulesModal").classList.add("hidden");
$("rulesModal").addEventListener("click",e=>{if(e.target.id==="rulesModal")$("rulesModal").classList.add("hidden")});
setupSettings();
$("judgeGavel").onclick=()=>{judgeMode=!judgeMode;render();};
document.addEventListener("keydown",e=>{if(e.key==="Escape")$("rulesModal").classList.add("hidden")});

function emitAction(type,id){if(type==="judge")judgeMode=false;socket.emit("action",{type,target:id})}
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
function voteMarkSvg(){return '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="none" stroke="#ef382d" stroke-width="7"/><path d="M50 4V96M50 50 82 82" fill="none" stroke="#ef382d" stroke-width="7" stroke-linecap="round"/></svg>';}
function button(label,fn,disabled=false){const b=document.createElement("button");b.textContent=label;b.disabled=disabled;b.onclick=fn;return b}
$("solo").onclick=()=>{err("");if(!$("name").value.trim())return err("닉네임을 먼저 입력해 주세요.");socket.emit("soloStart",{name:$("name").value,settings:readSetupSettings()})};
$("quick").onclick=()=>{err("");if(!$("name").value.trim())return err("닉네임을 먼저 입력해 주세요.");socket.emit("quickJoin",$("name").value)};
socket.on("queueStatus",d=>{if(d.waiting){$("home").classList.remove("hidden");$("game").classList.add("hidden");err("자동 매칭 대기 중… 현재 대기 인원 "+d.count+"명 (최소 6명)");}else err("매칭 대기가 취소되었습니다.");});
$("create").onclick=()=>{err("");if(!$("name").value.trim())return err("닉네임을 먼저 입력해 주세요.");socket.emit("create",{name:$("name").value,settings:readSetupSettings()})};
$("join").onclick=()=>{err("");socket.emit("join",{name:$("name").value,code:$("code").value})};
socket.on("joined",d=>{$("home").classList.add("hidden");$("game").classList.remove("hidden");$("room").textContent="ROOM "+d.code;chatMessages.public=[];chatMessages.team=[];teamMode=false;if(d.aiMode){$("chatTitle").textContent="전체 대화 · AI 대련";$("message").placeholder="AI와 다른 플레이어에게 메시지 보내기";$("chatPanel").classList.remove("hidden");}else $("chatPanel").classList.add("hidden")});
socket.on("errorMsg",err);
socket.on("privateResult",d=>{privateNotice=d.text;render()});
socket.on("reporterAnnouncement",d=>{announcementNotice=d.text;render()});
socket.on("judgementAnnouncement",d=>{showBlackAnnouncement(d.text||"판사가 판결을 내렸습니다");});
socket.on("publicRooms",rooms=>renderPublicRooms(rooms));
socket.on("state",s=>{if(state&&state.day!==s.day){privateNotice="";announcementNotice="";}state=s;if(Number.isFinite(s.serverNow))serverOffset=s.serverNow-Date.now();render()});
function render(){if(!state)return;const me=state.me;$("judgeGavel").classList.toggle("hidden",!(state.phase==="night_judge"&&me?.role==="판사"&&!me.judgeUsed));$("judgeGavel").setAttribute("aria-pressed",String(judgeMode));$("judgeGavel").textContent=judgeMode?"🔨 판결 대상 선택 중":"🔨 판사봉";
 const resultPanel=$("gameResult");const gameSections=[...$("game").children].filter(el=>el.id!=="gameResult"&&(el.classList.contains("bar")||el.classList.contains("panel")));
 if(state.phase==="ended"){gameSections.forEach(el=>el.classList.add("hidden"));resultPanel.classList.remove("hidden");resultPanel.innerHTML="";const heading=document.createElement("h2");heading.textContent="게임 결과";resultPanel.append(heading);const winner=document.createElement("p");winner.className="result-winner";winner.textContent=state.winner==="무승부"?"무승부":(state.winner||"게임 종료")+" 승리";resultPanel.append(winner);const subtitle=document.createElement("p");subtitle.className="settings-hint";subtitle.textContent="모든 참가자의 최종 직업이 공개되었습니다.";resultPanel.append(subtitle);const roster=document.createElement("div");roster.className="result-roster";(state.players||[]).forEach(p=>{const row=document.createElement("div");row.className="result-player";const identity=document.createElement("div");identity.className="result-identity";if(p.role){const art=document.createElement("span");art.className="player-role-icon";art.innerHTML=roleSvg(p.role);identity.append(art);}const name=document.createElement("strong");name.textContent=p.name;const role=document.createElement("span");role.className="result-role";role.textContent=p.role||"직업 정보 없음";identity.append(name,role);const meta=document.createElement("span");meta.className="result-meta";meta.textContent=(p.team==="evil"?"악인 진영":p.team==="good"?"선량한 진영":p.team==="solo"?"개인 진영":"")+" · "+(p.alive?"생존":"탈락");row.append(identity,meta);roster.append(row);});resultPanel.append(roster);resultPanel.append(button("확인",()=>{socket.emit("leaveRoom");state=null;judgeMode=false;privateNotice="";announcementNotice="";chatMessages.public=[];chatMessages.team=[];teamMode=false;$("game").classList.add("hidden");$("home").classList.remove("hidden");$("chatPanel").classList.add("hidden");$("error").textContent="";}));return;}else{resultPanel.classList.add("hidden");gameSections.forEach(el=>el.classList.remove("hidden"));}
 const lobbyBox=$("lobbySettings");if(state.phase==="lobby"&&state.host===me?.id){lobbyBox.classList.remove("hidden");buildSettingsEditor(lobbyBox,state.settings||{maxPlayers:10,evilCount:2,excludedRoles:[],discussionSeconds:60,voteSeconds:120,visibility:"public"},true,"lobby");const save=button("설정 저장",()=>{const max=Number($("lobbyMaxPlayers").value);socket.emit("updateRoomSettings",{maxPlayers:max,evilCount:Number($("lobbyEvilCount").value),discussionSeconds:Number($("lobbyDiscussionSeconds").value),voteSeconds:Number($("lobbyVoteSeconds").value),visibility:$("lobbyVisibility").value,excludedRoles:[...$("lobbyExcluded").querySelectorAll("input:checked")].map(x=>x.value)});},state.players.length>(state.settings?.maxPlayers||15));lobbyBox.append(save);}else{lobbyBox.classList.add("hidden");lobbyBox.innerHTML="";}
 $("phase").textContent=({lobby:"대기실",night_mafia:"밤 · 마피아 차례",night_vigilante:"밤 · 자경단 차례",night_missionary:"밤 · 선교사 차례",night_police:"밤 · 경찰 차례",night_spy:"밤 · 스파이 차례",night_doctor:"밤 · 의사 차례",night_priest:"밤 · 제사장 차례",night_judge:"밤 · 판사 차례",day_discuss:"낮 · 토론",day_vote:"낮 · 투표",ended:"게임 종료"})[state.phase]||state.phase;
 $("role").textContent=me?.role?(me.isPresident?"대통령 · 국회의원":me.role):"대기 중";$("team").textContent=me?.team==="evil"?"악인 진영":me?.team==="good"?"선량한 진영":me?.team==="solo"?"개인 진영":"";$("roleIllustration").innerHTML=roleSvg(me?.role);
 const abilityNotice=me?.lastAbility&&me.lastAbility.day===state.day?"능력 사용 완료 · "+me.lastAbility.label+" → "+me.lastAbility.targetName:"";
 $("notice").textContent=privateNotice||announcementNotice||abilityNotice||(state.aiMode?"AI 대련 모드 · AI 플레이어 5명과 대결 중":state.winner?state.winner+" 승리!":state.phase==="lobby"?"6명 이상 모이면 방장이 시작할 수 있어요.":me?.alive?"당신의 선택으로 게임의 흐름을 바꾸세요.":"관전 중입니다.");
 $("timer").textContent=state.endsAt?"남은 시간 "+Math.max(0,Math.ceil((state.endsAt-(Date.now()+serverOffset))/1000))+"초":"";
 const list=$("players");list.innerHTML="";
 state.players.forEach(p=>{const d=document.createElement("div");d.className="player"+(!p.alive?" dead":"");if(p.role){const art=document.createElement("span");art.className="player-role-icon";art.innerHTML=roleSvg(p.role);d.append(art);}const name=document.createElement("span");name.textContent=p.name+(p.id===me?.id?" (나)":"")+(p.role?" · "+p.role:"");d.append(name);if(state.phase==="day_vote"&&(state.voteCounts?.[p.id]||0)>0){const tally=document.createElement("span");tally.className="vote-tally";tally.innerHTML=voteMarkSvg()+"<b>"+state.voteCounts[p.id]+"</b>";tally.setAttribute("aria-label","받은 투표 "+state.voteCounts[p.id]+"표");d.append(tally);}const isNight=String(state.phase).startsWith("night_");const priestReviveTarget=state.phase==="night_priest"&&me?.role==="제사장";
 if(me?.alive&&p.id!==me.id&&(priestReviveTarget?!p.alive&&p.connected!==false:p.alive)){let label=null,fn=null;
 if(isNight){const rolePhase={마피아:"night_mafia",자경단:"night_vigilante",선교사:"night_missionary",의사:"night_doctor",제사장:"night_priest"};const map={의사:["치료","heal"],마피아:["공격","attack"],선교사:["전향","convert"],제사장:["부활","revive"]};if(state.phase===rolePhase[me.role]&&map[me.role]){label=map[me.role][0];fn=()=>emitAction(map[me.role][1],p.id)}if(state.phase==="night_vigilante"&&me.role==="자경단"){
  if(!me.vigilanteInvestigated){label="1회 조사";fn=()=>socket.emit("special",{target:p.id})}
  else if(me.vigilanteTargetId===p.id&&state.day>me.vigilanteInvestigatedDay){label="조사한 악인 공격";fn=()=>emitAction("vigilante",p.id)}
 }}
 if(state.phase==="night_judge"&&me.role==="판사"&&judgeMode){d.append(button("🔨 이 대상 판결",()=>emitAction("judge",p.id),!!me.judgeUsed));}
 if(state.phase==="day_vote")d.append(button(me.hasVoted?"투표 완료":"투표",()=>socket.emit("vote",p.id),!!me.hasVoted));
 if((state.phase==="night_police"&&me.role==="경찰")||(state.phase==="night_spy"&&me.role==="스파이")){label=me.role==="경찰"?"조사":"직업 조사";fn=()=>socket.emit("special",{target:p.id})}
 if(state.phase==="day_discuss"&&state.day>1&&me.role==="기자"){label="기사 발표";fn=()=>socket.emit("special",{target:p.id})}
 if(label){const usedReporter=me?.role==="기자"&&state.phase==="day_discuss"&&me.reporterUsed;const usedVigilante=false;d.append(button(usedReporter?"오늘 발표 완료":usedVigilante?"오늘 조사 완료":label,fn,!!usedReporter||!!usedVigilante));}}list.append(d)});
 $("controls").innerHTML="";if(state.phase==="lobby"&&state.host===me?.id)$("controls").append(button("게임 시작",()=>socket.emit("start"),state.players.length<6||state.players.length>(state.settings?.maxPlayers||15)));
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
function showBlackAnnouncement(text){$("voteResultText").textContent=text;$("voteResultOverlay").classList.remove("hidden");clearTimeout(window.voteResultTimer);window.voteResultTimer=setTimeout(()=>$("voteResultOverlay").classList.add("hidden"),3500);}
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