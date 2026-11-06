/* 공용 유틸 — 수정하실 필요 없습니다. */

const C = window.CONFIG;
const SB = (C.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = C.SUPABASE_KEY || "";

/* Supabase 키는 두 종류입니다.
   - 새 방식 Publishable key (sb_publishable_...) — apikey 헤더에만 보냅니다.
     JWT가 아니라서 Authorization: Bearer 로 보내면 검증에 걸릴 수 있습니다.
   - 옛 방식 anon key (eyJ... 로 시작하는 JWT) — 두 헤더 모두에 보냅니다.
   어느 쪽을 넣으셔도 되도록 키 모양을 보고 맞춥니다. */
const IS_JWT = /^ey[A-Za-z0-9_-]/.test(KEY);
const HEAD = {
  "apikey": KEY,
  ...(IS_JWT ? { "Authorization": "Bearer " + KEY } : {}),
  "Content-Type": "application/json"
};

/* ── Supabase REST ────────────────────────── */
async function sbGet(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: HEAD, cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

async function sbUpsert(table, rows, onConflict) {
  const r = await fetch(`${SB}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: { ...HEAD, "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows)
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
}

async function sbPatch(path, obj) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method: "PATCH",
    headers: { ...HEAD, "Prefer": "return=minimal" },
    body: JSON.stringify(obj)
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
}

async function sbDelete(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method: "DELETE",
    headers: { ...HEAD, "Prefer": "return=minimal" }
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
}

/* ── 앱이 쓰는 네 가지 동작 ───────────────── */

async function getState() {
  const rows = await sbGet("state?id=eq.1&select=session_idx,phase,is_open,panel");
  const s = rows[0] || {};
  return {
    session: s.session_idx ?? 0,
    phase: s.phase ?? "idle",
    open: !!s.is_open,
    view: s.panel ?? "qr"
  };
}

async function setState(p) {
  const body = { updated_at: new Date().toISOString() };
  if ("session" in p) body.session_idx = p.session;
  if ("phase"   in p) body.phase       = p.phase;
  if ("open"    in p) body.is_open     = p.open;
  if ("view"    in p) body.panel       = p.view;
  await sbPatch("state?id=eq.1", body);
}

async function castVote(session, phase, voter, role, years, choice) {
  await sbUpsert("votes",
    [{ session_idx: session, phase, voter, role, years, choice }],
    "session_idx,phase,voter");
}

/* 한 세션의 표를 { pre: {voter:{j,y,c}}, post: {...} } 형태로 돌려줍니다.
   j = 직군, y = 경력, c = 선택지 번호. 아래 집계 함수들이 이 모양을 씁니다. */
async function getVotes(session) {
  const rows = await sbGet(
    `votes?session_idx=eq.${session}&select=phase,voter,role,years,choice&limit=5000`);
  const out = { pre: {}, post: {} };
  for (const r of rows) {
    if (out[r.phase]) out[r.phase][r.voter] = { j: r.role, y: r.years, c: r.choice };
  }
  return out;
}

async function resetVotes(session) {
  await sbDelete(session == null
    ? "votes?id=gt.0"
    : `votes?session_idx=eq.${session}`);
}

/* ── 익명 식별자 ──────────────────────────────
   기기 안에만 저장됩니다. 서버에는 무작위 문자열만 올라가고
   이름·기기정보는 어디에도 남지 않습니다.
   이 값 덕분에 "사전에 찬성했던 사람이 사후에 어디로 갔는지"를
   익명인 채로 연결할 수 있습니다.                        */
function voterId() {
  let v = localStorage.getItem("dv_id");
  if (!v) {
    v = "v" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    localStorage.setItem("dv_id", v);
  }
  return v;
}
function myRole()    { return localStorage.getItem("dv_role"); }
function setRole(r)  { localStorage.setItem("dv_role", r); }
function myYears()   { return localStorage.getItem("dv_years"); }
function setYears(y) { localStorage.setItem("dv_years", y); }

/* ── 집계 ─────────────────────────────────────
   key/val 을 주면 그 조건에 맞는 표만 셉니다.
   key 는 "j"(직군) 또는 "y"(경력).                        */
function tally(votes, key, val) {
  const counts = [0, 0, 0, 0, 0, 0];
  let n = 0, sum = 0;
  for (const id in (votes || {})) {
    const v = votes[id];
    if (!v || typeof v.c !== "number") continue;
    if (key && v[key] !== val) continue;
    counts[v.c - 1]++; n++; sum += v.c;
  }
  const pro = counts[3] + counts[4] + counts[5];
  return {
    counts, n,
    mean: n ? sum / n : 0,
    proPct: n ? (pro / n) * 100 : 0,
    conPct: n ? ((n - pro) / n) * 100 : 0
  };
}

/* 사전→사후 이동. 같은 익명 ID가 양쪽에 다 있는 사람만 집계합니다. */
function movement(pre, post) {
  const m = [];
  for (let i = 0; i < 6; i++) m.push([0, 0, 0, 0, 0, 0]);
  let paired = 0, flipped = 0, softened = 0, hardened = 0, same = 0;

  for (const id in (pre || {})) {
    const a = pre[id], b = (post || {})[id];
    if (!a || !b || typeof a.c !== "number" || typeof b.c !== "number") continue;
    paired++;
    m[a.c - 1][b.c - 1]++;

    const sideA = a.c >= 4, sideB = b.c >= 4;
    if (sideA !== sideB) { flipped++; continue; }
    if (a.c === b.c) { same++; continue; }
    const distA = Math.abs(a.c - 3.5), distB = Math.abs(b.c - 3.5);
    if (distB < distA) softened++; else hardened++;
  }
  return { m, paired, flipped, softened, hardened, same };
}

/* ── 표시 도우미 ──────────────────────────── */
const sideOf   = (i) => (i < 3 ? "con" : "pro");
const colorOf  = (i) => (i < 3 ? "var(--con)" : "var(--pro)");
const weightOf = (i) => [3, 2, 1, 1, 2, 3][i];
const pct = (x) => (Math.round(x * 10) / 10).toFixed(1);

/* 직군별·경력별 표의 행. 진행자 화면과 프로젝터가 같은 함수를 씁니다.
   인원이 5명 미만인 줄은 흐리게 — 2명짜리 100%가 큰 발견처럼 보이지 않도록. */
function breakdownRows(pre, post, key, options) {
  const rows = options.map(o => {
    const a = tally(pre, key, o), b = tally(post, key, o);
    const n = Math.max(a.n, b.n);
    if (!n) return "";
    const d = b.proPct - a.proPct;
    const thin = n < 5 ? ` style="opacity:.5"` : "";
    return `<tr${thin}><td>${o}</td><td>${n}</td><td>${pct(a.proPct)}%</td><td>${pct(b.proPct)}%</td>
      <td class="delta ${d>0?"up":d<0?"down":""}">${d>0?"+":""}${pct(d)}p</td></tr>`;
  }).join("");
  return rows ||
    `<tr><td colspan="5" style="text-align:left;color:var(--ink-soft)">아직 응답이 없습니다.</td></tr>`;
}

function barRows(el, t, opts = {}) {
  const max = Math.max(1, ...t.counts);
  el.innerHTML = C.SCALE.map((label, i) => {
    const w = (t.counts[i] / max) * 100;
    const share = t.n ? (t.counts[i] / t.n) * 100 : 0;
    return `<div class="bar-row">
      <div class="bar-lab">${label}</div>
      <div class="bar-track">
        <div class="bar-fill ${opts.pre ? "pre" : ""}" style="width:${w}%;background:${colorOf(i)}"></div>
      </div>
      <div class="bar-num">${t.counts[i]}<span style="color:var(--ink-soft);font-weight:400"> · ${Math.round(share)}%</span></div>
    </div>`;
  }).join("");
}

function compareRows(el, pre, post) {
  const max = Math.max(1, ...pre.counts, ...post.counts);
  el.innerHTML = C.SCALE.map((label, i) => {
    const wa = (pre.counts[i] / max) * 100;
    const wb = (post.counts[i] / max) * 100;
    return `<div class="bar-row" style="align-items:stretch">
      <div class="bar-lab" style="align-self:center">${label}</div>
      <div style="display:flex;flex-direction:column;gap:3px">
        <div class="bar-track" style="height:15px">
          <div class="bar-fill pre" style="width:${wa}%;background:${colorOf(i)}"></div>
        </div>
        <div class="bar-track" style="height:15px">
          <div class="bar-fill" style="width:${wb}%;background:${colorOf(i)}"></div>
        </div>
      </div>
      <div class="bar-num" style="align-self:center">${pre.counts[i]} → ${post.counts[i]}</div>
    </div>`;
  }).join("");
}

/* ── 이동 리본 (시그니처) ─────────────────────
   왼쪽이 사전, 오른쪽이 사후. 리본 굵기는 인원 수,
   색은 이동 방향입니다.                                   */
function ribbon(el, mv) {
  /* 가로로 넓은 비율 — 프로젝터 16:9에서 아래 수치까지 한 화면에 들어오도록 */
  const W = 900, H = 350, PAD = 28, NW = 16;
  const slot = (H - PAD * 2) / 6;
  const y = (i) => PAD + slot * i + slot / 2;

  if (!mv.paired) {
    el.innerHTML = `<p class="sub">사전과 사후에 모두 응답한 분이 아직 없습니다.</p>`;
    return;
  }

  const outTot = [0,0,0,0,0,0], inTot = [0,0,0,0,0,0];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    outTot[i] += mv.m[i][j]; inTot[j] += mv.m[i][j];
  }
  const maxTot = Math.max(...outTot, ...inTot, 1);
  const scale = (slot * 0.82) / maxTot;

  const oOff = [0,0,0,0,0,0], iOff = [0,0,0,0,0,0];
  let paths = "";

  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      const n = mv.m[i][j];
      if (!n) continue;
      const th = Math.max(1.5, n * scale);
      const y1 = y(i) - outTot[i] * scale / 2 + oOff[i] + th / 2;
      const y2 = y(j) - inTot[j]  * scale / 2 + iOff[j] + th / 2;
      oOff[i] += th; iOff[j] += th;

      const x1 = PAD + NW, x2 = W - PAD - NW;
      const cx = (x2 - x1) * 0.5;
      let stroke = "var(--flat)", op = .3;
      if (j > i) { stroke = "var(--pro)"; op = .5; }
      if (j < i) { stroke = "var(--con)"; op = .5; }

      paths += `<path d="M${x1},${y1} C${x1+cx},${y1} ${x2-cx},${y2} ${x2},${y2}"
        fill="none" stroke="${stroke}" stroke-opacity="${op}" stroke-width="${th}"
        stroke-linecap="butt"><title>${C.SCALE[i]} → ${C.SCALE[j]} · ${n}명</title></path>`;
    }
  }

  let nodes = "";
  for (let i = 0; i < 6; i++) {
    const ho = Math.max(4, outTot[i] * scale), hi = Math.max(4, inTot[i] * scale);
    nodes += `<rect x="${PAD}" y="${y(i)-ho/2}" width="${NW}" height="${ho}" rx="2.5" fill="${colorOf(i)}"/>`;
    nodes += `<rect x="${W-PAD-NW}" y="${y(i)-hi/2}" width="${NW}" height="${hi}" rx="2.5" fill="${colorOf(i)}"/>`;
    nodes += `<text x="${PAD-10}" y="${y(i)+6}" text-anchor="end" font-size="17" fill="var(--ink-soft)" font-family="Pretendard,sans-serif">${outTot[i]}</text>`;
    nodes += `<text x="${W-PAD+10}" y="${y(i)+6}" font-size="17" fill="var(--ink-soft)" font-family="Pretendard,sans-serif">${inTot[i]}</text>`;
  }

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img"
      aria-label="사전 투표에서 사후 투표로의 이동을 보여주는 흐름도">
      <text x="${PAD}" y="16" font-size="17" font-weight="700" fill="var(--ink-soft)" font-family="Pretendard,sans-serif">발표 전</text>
      <text x="${W-PAD}" y="16" text-anchor="end" font-size="17" font-weight="700" fill="var(--ink-soft)" font-family="Pretendard,sans-serif">발표 후</text>
      ${paths}${nodes}</svg>`;
}
