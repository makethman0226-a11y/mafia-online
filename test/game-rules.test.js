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
  assert.match(server, /if\(type==="attack"&&t\.team==="evil"\)/);
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

test("직업 중복 배정으로 같은 밤 차례가 사라지지 않도록 선량 직업은 중복되지 않는다", () => {
  assert.match(server, /if\(goodRoles\.length\)roles\.push\(goodRoles\.shift\(\)\)/);
  assert.match(server, /else roles\.push\("시민"\)/);
});

test("이미 사용한 능력과 행동 불가능한 부활 대상은 밤 차례에서 제외한다", () => {
  assert.match(server, /function canTakeNightTurn\(r,p,role\)/);
  assert.match(server, /return !p\.used\.revive&&\[\.\.\.r\.players\.values\(\)\]\.some\(x=>!x\.alive&&x\.connected!==false\)/);
  assert.match(server, /t\.connected===false\|\|p\.used\.revive/);
});
