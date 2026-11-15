const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const server = fs.readFileSync("server.js", "utf8");
const client = fs.readFileSync("public/client.js", "utf8");
const html = fs.readFileSync("public/index.html", "utf8");

test("경찰은 조사 대상의 실제 직업을 본인에게만 표시한다", () => {
  assert.match(server, /t\.name\+"님의 직업은 "\+t\.role\+"입니다\. \(경찰에게만 공개\)"/);
  assert.match(server, /p\.role==="경찰"&&r\.phase==="night_police"/);
});

test("스파이와 기자는 위장 공개명이 아닌 실제 직업을 확인한다", () => {
  assert.match(server, /t\.name\+"님의 직업: "\+t\.role/);
  assert.match(server, /t\.name\+"님의 직업은 "\+t\.role\+"입니다\."/);
});

test("클러쳐의 시민 위장은 탈락 공개에만 적용하고 조사·기자 발표에는 적용하지 않는다", () => {
  assert.match(server, /function revealedRole\(p\)\{ return p\.role==="클러쳐" \? "시민" : p\.role; \}/);
  assert.match(server, /t\.name\+"님의 직업은 "\+t\.role/);
});

test("마피아는 같은 악인 팀을 공격할 수 없다", () => {
  assert.match(server, /type==="attack"\|\|type==="missionaryKill"\)\&\&t\.team==="evil"/);
});

test("국회의원은 항상 투표 면역이 아니며 대통령만 투표 대상에서 제외된다", () => {
  assert.match(server, /target\.id!==r\.presidentId/);
  assert.doesNotMatch(server, /target\.role==="국회의원"\)\{/);
});

test("선교사의 전향 성공 시 선교사와 전향 대상이 악인 팀 대화 권한을 얻는다", () => {
  assert.match(server, /t\.team="evil";t\.joined=true;p\.joined=true;p\.used\.convert=true/);
});

test("밤 행동 순서와 첫째 날 토론 전용 규칙을 유지한다", () => {
  const order = ["마피아", "자경단", "선교사", "경찰", "스파이", "의사", "제사장"];
  let previous = -1;
  for (const role of order) {
    const index = server.indexOf('{role:"' + role + '",phase:');
    assert.ok(index > previous, role + " 순서가 잘못됨");
    previous = index;
  }
  assert.match(server, /if\(r\.day===1\)\{log\(r,"첫째 날 토론이 끝났습니다\./);
  assert.match(html, /첫째 날은 토론만 진행합니다\. 능력 사용과 투표는 없습니다\./);
});

test("이벤트 payload가 비정상이어도 구조 분해로 서버가 예외를 내지 않는다", () => {
  assert.match(server, /s\.on\("action",payload=>\{const \{type,target\}=payload&&typeof payload==="object"\?payload:\{\}/);
  assert.match(server, /s\.on\("special",payload=>\{\s*const \{target\}=payload&&typeof payload==="object"\?payload:\{\}/);
  assert.match(server, /s\.on\("chat",payload=>\{const \{text:msg,team\}=payload&&typeof payload==="object"\?payload:\{\}/);
});

test("사용한 능력의 확인 문구가 다음 밤 차례로 넘어가도 표시된다", () => {
  assert.match(client, /me\.lastAbility\.day===state\.day\?"능력 사용 완료/);
});

test("선량 직업은 중복되지 않고 시민은 기본 직업으로 유지한다", () => {
  assert.match(server, /const goodRoles=\["의사","경찰","판사","국회의원","기자","자경단","제사장"\]\.filter/);
  assert.match(server, /else roles\.push\("시민"\)/);
});

test("이미 사용한 능력과 행동 불가능한 부활 대상은 밤 차례에서 제외한다", () => {
  assert.match(server, /function canTakeNightTurn\(r,p,role\)/);
  assert.match(server, /return !p\.used\.revive&&\[\.\.\.r\.players\.values\(\)\]\.some\(x=>!x\.alive&&x\.connected!==false\)/);
  assert.match(server, /t\.connected===false\|\|p\.used\.revive/);
});


test("방 설정은 최대 인원·악인 수·제외 직업을 검증하고 직업 배정에 반영한다", () => {
  assert.match(server, /function normalizeSettings\(raw=\{\},playerCount=6\)/);
  assert.match(server, /maxPlayers,evilCount,excludedRoles/);
  assert.match(server, /const evilCount=Math.max\(1,Math.min\(r.settings.evilCount,n-2\)\)/);
  assert.match(server, /filter\(x=>!excluded.has\(x\)\)/);
  assert.match(server, /r.settings=normalizeSettings\(r.settings,n\)/);
});

test("온라인 방과 AI 대련 모두 같은 설정을 전달하며 대기실에서 수정할 수 있다", () => {
  assert.match(client, /socket.emit\("create",\{name:\$\("name"\)\.value,settings:readSetupSettings\(\)\}\)/);
  assert.match(client, /socket.emit\("soloStart",\{name:\$\("name"\)\.value,settings:readSetupSettings\(\)\}\)/);
  assert.match(client, /socket.emit\("updateRoomSettings"/);
  assert.match(server, /s.on\("updateRoomSettings"/);
  assert.match(server, /r.players.size>=\(r.settings\?\.maxPlayers\|\|15\)/);
  assert.match(html, /id="setupMaxPlayers"/);
  assert.match(html, /id="lobbySettings"/);
});


test("게임 종료 시 모든 참가자의 실제 직업과 진영을 공개한다", () => {
  assert.match(server, /role:r\.phase==="ended"\?x\.role/);
  assert.match(server, /team:r\.phase==="ended"\?x\.team:null/);
  assert.match(server, /function finish\(r,w\)\{r\.phase="ended"/);
});

test("결과 화면은 참가자 전체 직업을 표시하고 확인 시 메인 화면으로 돌아간다", () => {
  assert.match(client, /state\.phase==="ended"/);
  assert.match(client, /모든 참가자의 최종 직업이 공개되었습니다/);
  assert.match(client, /button\("확인",\(\)=>\{/);
  assert.match(client, /socket\.emit\("leaveRoom"\)/);
  assert.match(client, /\$\("home"\)\.classList\.remove\("hidden"\)/);
  assert.match(html, /id="gameResult"/);
  assert.match(server, /s\.on\("leaveRoom"/);
});


test("악인팀은 살아 있는 전체 플레이어의 절반 이상이면 승리한다", () => {
  assert.match(server, /evil>=Math\.ceil\(a\.length\/2\)/);
  assert.doesNotMatch(server, /evil>=good/);
});

test("선교사에게 세뇌된 플레이어는 직업과 관계없이 악인팀으로 계산되고 결과 화면에도 악인 진영으로 표시된다", () => {
  assert.match(server, /t\.team="evil";t\.joined=true;p\.joined=true;p\.used\.convert=true/);
  assert.match(server, /evil=a\.filter\(p=>p\.team==="evil"\)\.length/);
  assert.match(server, /team:r\.phase==="ended"\?x\.team:null/);
  assert.match(client, /p\.team==="evil"\?"악인 진영"/);
});


test("비밀투표는 투표자 정보를 노출하지 않고 대상별 합계만 표시한다",()=>{assert.match(server,/const voteCounts=\{\};if\(r\.phase==="day_vote"\)for\(const \[voterId,target\] of Object\.entries\(r\.votes\|\|\{\}\)\)/);assert.match(client,/state\.voteCounts\?\.\[p\.id\]/);assert.match(client,/voteMarkSvg\(\)/);});
test("판사는 밤 차례에 판결봉 버튼으로 판결하고 검은 화면 공지를 표시한다",()=>{assert.match(server,/phase!=="night_judge"/);assert.match(server,/judgementAnnouncement/);assert.match(client,/state\.phase==="night_judge"&&me\.role==="판사"/);assert.match(client,/showBlackAnnouncement/);});
test("방장이 토론·투표 시간을 정하고 공개·비공개 서버를 설정한다",()=>{assert.match(server,/discussionSeconds/);assert.match(server,/voteSeconds/);assert.match(server,/visibility==="public"/);assert.match(client,/setupDiscussionSeconds/);assert.match(client,/lobbyVoteSeconds/);assert.match(client,/setupVisibility/);assert.match(client,/publicRooms/);});
test("악인 수 설정은 최대 3명으로 제한한다",()=>{assert.match(server,/const maxEvil=Math\.min\(3,maxPlayers-2\)/);assert.match(client,/Math\.min\(3,/);});


test("비밀투표는 투표자 정보를 공개하지 않고 대상별 득표수만 전달한다", () => {
  assert.match(server, /const voteCounts=\{\};if\(r\.phase==="day_vote"\)/);
  assert.match(server, /voteCounts,skippedCount:Object/);
  assert.match(server, /hasVoted:!!r\.votes\[p\.id\]/);
  assert.doesNotMatch(server, /votes:r\.votes/);
  assert.match(client, /function voteMarkSvg\(\)/);
  assert.match(client, /state\.voteCounts\[p\.id\]/);
});

test("판사봉은 판사 밤 차례에만 표시되고 버튼을 누른 뒤 대상 선택으로 판결한다", () => {
  assert.match(html, /id="judgeGavel"/);
  assert.match(client, /judgeMode=!judgeMode/);
  assert.match(client, /state\.phase==="night_judge"&&me\.role==="판사"&&judgeMode/);
  assert.match(server, /io\.to\(r\.code\)\.emit\("judgementAnnouncement",\{text:"판사가 판결을 내렸습니다"\}\)/);
});

test("방 설정은 공개·비공개 및 토론·투표 시간을 방장이 저장할 수 있고 악인 수는 1~3명이다", () => {
  assert.match(server, /const maxEvil=Math\.min\(3,maxPlayers-2\)/);
  assert.match(server, /const evilCount=Math\.max\(1,Math\.min\(maxEvil/);
  assert.match(client, /discussionSeconds:Number\(\$\("setupDiscussionSeconds"\)\.value\)/);
  assert.match(client, /voteSeconds:Number\(\$\("setupVoteSeconds"\)\.value\)/);
  assert.match(client, /\[\["public","공개 서버"\],\["private","비공개 서버"\]\]/);
  assert.match(server, /r\.visibility=next\.visibility/);
  assert.match(server, /filter\(r=>r\.visibility==="public"&&r\.phase==="lobby"\)/);
});


test("투표 건너뛰기는 기권으로 기록되고 모든 생존자가 투표 또는 건너뛰기를 하면 결과를 확정한다", () => {
  assert.match(server, /s\.on\("skipVote"/);
  assert.match(server, /r\.skippedVotes\[s\.id\]=true/);
  assert.match(server, /voters\.every\(p=>!!r\.votes\[p\.id\]\|\|!!r\.skippedVotes\?\.\[p\.id\]\)/);
  assert.match(server, /hasVoted:!!r\.votes\[p\.id\]\|\|!!r\.skippedVotes\?\.\[p\.id\]/);
  assert.match(client, /button\("투표 건너뛰기",\(\)=>socket\.emit\("skipVote"\)\)/);
});

test("투표 결과는 대상별 득표수와 기권 수를 공개하고 최다 득표자를 탈락 처리한다", () => {
  assert.match(server, /const tallyLines=sorted\.map/);
  assert.match(server, /tallyLines\.push\("건너뛰기 : "\+skippedCount\+"표"\)/);
  assert.match(server, /target\.alive=false/);
  assert.match(server, /emit\("voteResult",\{text:resultText,counts:/);
  assert.match(html, /대상별 득표수와 건너뛰기 수를 공개/);
});


test("AI 토론은 서로 다른 성격과 대화 기억을 사용해 자연스럽게 반응한다", () => {
  assert.match(server, /const BOT_PERSONAS=\[/);
  assert.match(server, /p\.persona=BOT_PERSONAS\[i%BOT_PERSONAS\.length\]/);
  assert.match(server, /const lastHuman=\[\.\.\.recent\]\.reverse\(\)\.find\(m=>!m\.isBot\)/);
  assert.match(server, /lastHuman\.text\.includes\(bot\.name\)/);
  assert.match(server, /r\.botHistory\.push\(\{name:bot\.name,text:message,day:r\.day,isBot:true\}\)/);
  assert.match(server, /bot\.botTalkCount=\(bot\.botTalkCount\|\|0\)\+1/);
});

test("AI 토론 발언은 반복을 줄이고 일정한 간격으로 여러 차례 참여한다", () => {
  assert.match(server, /r\.botChatCount>=8/);
  assert.match(server, /r\.nextBotChatAt=Date\.now\(\)\+3500\+Math\.floor\(Math\.random\(\)\*5200\)/);
  assert.match(server, /bot\.lastBotLine=line/);
  assert.match(server, /b\.id!==r\.lastBotSpeakerId/);
});


test("선교사는 첫째·셋째·다섯째 밤에 공격할 수 있고 중간 밤에는 공격할 수 없다", () => {
  assert.match(server, /missionaryCanKill:r\.day>=2&&r\.day%2===0/);
  assert.match(server, /if\(type==="missionaryKill"&&\(r\.day<2\|\|r\.day%2!==0\)\)/);
  assert.match(server, /missionaryKill:"night_missionary"/);
  assert.match(client, /button\("선교사 공격",\(\)=>emitAction\("missionaryKill",p\.id\)\)/);
});

test("선교사의 공격은 같은 악인 팀을 공격하지 않고 밤 결과에서 탈락 처리한다", () => {
  assert.match(server, /type==="missionaryKill"\)\&\&t\.team==="evil"/);
  assert.match(server, /const missionaryTarget=Object\.values\(act\)\.find\(x=>x\.type==="missionaryKill"\)\?\.target/);
  assert.match(server, /선교사의 공격으로 한 명이 탈락했습니다/);
});
