/* 독서로그 — 책의 계보 (v2) */
(function () {
"use strict";

/* ================= config & helpers ================= */
const CFG = window.READING_LOG_CONFIG || {};
const CONFIGURED = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase);
const sb = CONFIGURED ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
const PROVIDERS = (CFG.AUTH_PROVIDERS && CFG.AUTH_PROVIDERS.length ? CFG.AUTH_PROVIDERS : ["google"]);
const APP_NAME = CFG.APP_NAME || "독서로그";

// desktop (horizontal) geometry
let NODE_W = 176, NODE_H = 72, G_W = 118, G_H = 40, S_W = 104, S_H = 30, COL = 214, ROW = 94; const PAD = 28, G_GAP = 44, GR_GAP = 14;
// phone (vertical) geometry
const VPAD = 16, VGAP = 12, SEC_H = 30;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2));
const isUrl = s => /^https?:\/\/\S+$/i.test(s || "");
const coarse = () => !!(window.matchMedia && matchMedia("(pointer:coarse)").matches);
const isPhone = () => !!(window.matchMedia && matchMedia("(max-width: 720px)").matches);

const S = {
  mode: "own", store: null, user: null, profile: null,
  books: [], links: [], inbox: [],
  sel: null, draft: null, hidden: new Set(), zoom: 1, canWrite: true,
  genre: null, period: "", kw: "", L: null, crop: null, covers: true, view: "full"
};
try {
  const h = localStorage.getItem("rlog.hidden"); if (h) S.hidden = new Set(JSON.parse(h));
  const z = parseFloat(localStorage.getItem("rlog.zoom")); if (z > 0) S.zoom = z;
  const v = localStorage.getItem("rlog.view"); if (v === "full" || v === "text" || v === "cover") S.view = v; else if (localStorage.getItem("rlog.covers") === "0") S.view = "text";
  if (isPhone()) { const zp = parseFloat(localStorage.getItem("rlog.zoom.phone")); S.zoom = zp > 0 ? zp : 0.8; }
} catch (e) {}

function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2200); }
const byId = id => S.books.find(b => b.id === id);
const genreOf = b => (b && b.genre) || "미분류";
const prim = b => (b && b.subgenres && b.subgenres[0]) || "";
const subsText = b => (b.subgenres || []).join(", ");
function genres() { const m = new Map(); S.books.forEach(b => { const g = genreOf(b); if (!m.has(g) || m.get(g) > (b.created || 0)) m.set(g, b.created || 0); }); return [...m.entries()].sort((a, b) => a[1] - b[1]).map(x => x[0]); }
function gIndex(g) { const i = genres().indexOf(g); return (i < 0 ? 0 : i) % 6; }
const gColor = g => `var(--g${gIndex(g)})`;
function subsOf(g) { const m = new Map(); S.books.filter(b => genreOf(b) === g).forEach(b => (b.subgenres || []).forEach(s => { if (s && (!m.has(s) || m.get(s) > (b.created || 0))) m.set(s, b.created || 0); })); return [...m.entries()].sort((a, b) => a[1] - b[1]).map(x => x[0]); }
function altOf(b, s) { const a = b && b.alt_parents && b.alt_parents[s]; if (!a || !a.parent) return null; const p = byId(a.parent); return p && p.id !== b.id && genreOf(p) === genreOf(b) ? { book: p, reason: a.reason || "" } : null; }
function validParent(b) { const p = b.parent && byId(b.parent); return p && p.id !== b.id && genreOf(p) === genreOf(b) ? p : null; }
const sortKids = (a, b) => ((a && a.read) || "9999").localeCompare((b && b.read) || "9999") || ((a && a.created) || 0) - ((b && b.created) || 0);
function ancestors(id) { const out = [], seen = new Set(); let b = byId(id); while (b && !seen.has(b.id)) { seen.add(b.id); out.unshift(b); b = validParent(b); } return out; }
function descendants(id) { const out = new Set([id]); let grew = true; while (grew) { grew = false; S.books.forEach(b => { const p = validParent(b); if (p && out.has(p.id) && !out.has(b.id)) { out.add(b.id); grew = true; } }); } return out; }
function sinceText() {
  const p = S.profile || {};
  if (p.since) return p.since.replace(/-/g, ".");
  const reads = S.books.map(b => b.read).filter(Boolean).sort();
  return reads.length ? reads[0].slice(0, 4) : "";
}
const ownerName = () => (S.profile && S.profile.nickname) || "나";
const logTitle = () => `${ownerName()}의 독서로그`;
const publicUrl = () => S.profile && S.profile.handle ? `${location.origin}/u/${S.profile.handle}` : "";
function parseSubs(v) { const out = []; String(v || "").split(/[,，、/]/).map(s => s.trim()).filter(Boolean).forEach(s => { s = s.slice(0, 20); if (!out.includes(s)) out.push(s); }); return out.slice(0, 5); }

/* period filter */
function periodRange() {
  const p = S.period; if (!p) return null;
  if (p === "last12") { const d = new Date(); d.setMonth(d.getMonth() - 11); return [d.toISOString().slice(0, 7), "9999-12"]; }
  return [p + "-01", p + "-12"];
}
const kwOf = b => (b && Array.isArray(b.keywords)) ? b.keywords : [];
function parseKw(v) { const out = []; String(v || "").split(/[,，、#]/).map(s => s.trim()).filter(Boolean).forEach(s => { s = s.slice(0, 20); if (!out.some(x => x.toLowerCase() === s.toLowerCase())) out.push(s); }); return out.slice(0, 10); }
function allKeywords() { const m = new Map(); S.books.forEach(b => kwOf(b).forEach(k => m.set(k, (m.get(k) || 0) + 1))); return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko")); }
const focusOn = () => !!(S.period || S.kw);
function inFocus(b) { if (!inPeriod(b)) return false; if (S.kw && !kwOf(b).some(k => k.toLowerCase() === S.kw.toLowerCase())) return false; return true; }
function inPeriod(b) { const r = periodRange(); if (!r) return true; if (!b || !b.read) return false; const m = b.read.slice(0, 7); return m >= r[0] && m <= r[1]; }

/* feed url normalisation (blog id / blog address → RSS) */
function normFeed(input) {
  let s = String(input || "").trim(); if (!s) return "";
  if (/^[A-Za-z0-9_-]{3,40}$/.test(s)) return `https://rss.blog.naver.com/${s}.xml`;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u; try { u = new URL(s); } catch (e) { return null; }
  const h = u.hostname.replace(/^m\./, "");
  if (h === "blog.naver.com") { const id = u.searchParams.get("blogId") || u.pathname.split("/").filter(Boolean)[0]; return id ? `https://rss.blog.naver.com/${id}.xml` : null; }
  if (/\.tistory\.com$/.test(h) && !/\/rss/.test(u.pathname)) return `https://${h}/rss`;
  if (h === "velog.io") { const m = u.pathname.match(/^\/@([^/]+)/); if (m) return `https://v2.velog.io/rss/@${m[1]}`; }
  if (/\.substack\.com$/.test(h) && !/\/feed/.test(u.pathname)) return `https://${h}/feed`;
  if (h === "medium.com") { const m = u.pathname.match(/^\/(@[^/]+)/); if (m && !/\/feed\//.test(u.pathname)) return `https://medium.com/feed/${m[1]}`; }
  u.protocol = "https:"; return u.toString();
}
function feedLabel(f) { if (!f) return ""; const m = f.match(/rss\.blog\.naver\.com\/([^.]+)\.xml/); if (m) return `blog.naver.com/${m[1]}`; try { const u = new URL(f); return u.hostname + u.pathname.replace(/\/$/, ""); } catch (e) { return f; } }
const feedOfProfile = p => (p && (p.feed_url || (p.blog_id ? `https://rss.blog.naver.com/${p.blog_id}.xml` : ""))) || "";

/* ================= stores ================= */
const fromRow = r => ({ id: r.id, title: r.title || "", author: r.author || "", genre: r.genre || "", subgenres: Array.isArray(r.subgenres) ? r.subgenres : [], published: r.published || "", cover_url: r.cover_url || "", publisher: r.publisher || "", keywords: Array.isArray(r.keywords) ? r.keywords : [], alt_parents: (r.alt_parents && typeof r.alt_parents === "object" && !Array.isArray(r.alt_parents)) ? r.alt_parents : {}, parent: r.parent || "", reason: r.reason || "", read: r.read || "", review_url: r.review_url || "", created: Date.parse(r.created_at) || 0 });
const linkRow = r => ({ id: r.id, from: r.from_id, to: r.to_id, note: r.note || "", created: Date.parse(r.created_at) || 0 });
function bookPatch(b) { const o = {}; ["title", "author", "genre", "reason", "read", "review_url", "published", "cover_url", "publisher"].forEach(k => { if (k in b) o[k] = b[k] || ""; }); if ("parent" in b) o.parent = b.parent || null; if ("subgenres" in b) o.subgenres = b.subgenres || []; if ("keywords" in b) o.keywords = b.keywords || []; if ("alt_parents" in b) o.alt_parents = b.alt_parents || {}; return o; }
function chk(res) { if (res.error) throw res.error; return res.data; }

const Supa = {
  async session() { const { data } = await sb.auth.getSession(); return data.session; },
  async profileOf(id) { return chk(await sb.from("profiles").select("*").eq("id", id).maybeSingle()); },
  async profileByHandle(h) { return chk(await sb.from("profiles").select("id,handle,nickname,since,is_public").eq("handle", h).eq("is_public", true).maybeSingle()); },
  async saveProfile(p) { return chk(await sb.from("profiles").upsert(Object.assign({ id: S.user.id }, p)).select().single()); },
  async books(owner) { return chk(await sb.from("books").select("*").eq("user_id", owner).order("created_at").limit(5000)).map(fromRow); },
  async links(owner) { return chk(await sb.from("links").select("*").eq("user_id", owner).limit(5000)).map(linkRow); },
  async inbox() { return chk(await sb.from("review_inbox").select("*").eq("status", "new").order("published_at", { ascending: false }).limit(200)); },
  async addBook(b) { return fromRow(chk(await sb.from("books").insert(bookPatch(b)).select().single())); },
  async updateBook(id, p) { chk(await sb.from("books").update(bookPatch(p)).eq("id", id)); },
  async deleteBook(id) { chk(await sb.from("books").delete().eq("id", id)); },
  async addLink(l) { return linkRow(chk(await sb.from("links").insert({ from_id: l.from, to_id: l.to, note: l.note || "" }).select().single())); },
  async deleteLink(id) { chk(await sb.from("links").delete().eq("id", id)); },
  async updateInbox(id, p) { chk(await sb.from("review_inbox").update(p).eq("id", id)); },
  async importAll(books, links) {
    for (let i = 0; i < books.length; i += 200) chk(await sb.from("books").insert(books.slice(i, i + 200).map(b => Object.assign({ id: b.id }, bookPatch(b)))));
    for (let i = 0; i < links.length; i += 200) chk(await sb.from("links").insert(links.slice(i, i + 200).map(l => ({ from_id: l.from, to_id: l.to, note: l.note || "" }))));
  }
};

const DEMO_KEY = "rlog.demo.v2";
function demoSeed() {
  const B = (id, title, author, genre, subgenres, parent, reason, read, i) => ({ id, title, author, genre, subgenres, parent, reason, read, review_url: "", created: i, example: true });
  return {
    profile: { nickname: "체험", handle: "", since: "", is_public: false, feed_url: "", blog_category: "" },
    books: [
      B("ex-1", "죽음의 수용소에서", "빅터 프랭클", "심리", [], "", "", "2025-01", 1),
      B("ex-2", "도파민네이션", "애나 렘키", "심리", ["중독", "뇌과학"], "ex-1", "고통을 대하는 방식이 궁금해서", "2025-03", 2),
      B("ex-3", "중독은 학습이다", "마크 루이스", "심리", ["중독"], "ex-2", "중독을 다르게 보는 시선", "2025-05", 3),
      B("ex-4", "도둑맞은 집중력", "요한 하리", "심리", ["뇌과학"], "ex-2", "도파민 이야기가 이어져서", "2025-06", 4),
      B("ex-5", "기억의 뇌과학", "리사 제노바", "심리", ["뇌과학"], "ex-4", "뇌를 더 알고 싶어서", "2025-08", 5),
      B("ex-6", "데미안", "헤르만 헤세", "문학", ["독일문학"], "", "", "2025-02", 6),
      B("ex-7", "싯다르타", "헤르만 헤세", "문학", ["독일문학"], "ex-6", "같은 작가", "2025-04", 7),
      B("ex-8", "이방인", "알베르 카뮈", "문학", ["프랑스문학"], "ex-6", "고독의 결이 비슷해서", "2025-09", 8)
    ],
    links: [{ id: "ex-l1", from: "ex-1", to: "ex-8", note: "실존의 질문", created: 9, example: true }]
  };
}
const Local = {
  get() { try { const d = JSON.parse(localStorage.getItem(DEMO_KEY)); if (d && d.books) return d; } catch (e) {} const d = demoSeed(); this.put(d); return d; },
  put(d) { try { localStorage.setItem(DEMO_KEY, JSON.stringify(d)); } catch (e) {} },
  async profileOf() { return this.get().profile; },
  async saveProfile(p) { const d = this.get(); d.profile = Object.assign({}, d.profile, p); this.put(d); return d.profile; },
  async books() { return this.get().books.map(b => Object.assign({ subgenres: [] }, b)); },
  async links() { return this.get().links; },
  async inbox() { return []; },
  async addBook(b) { const d = this.get(); const n = Object.assign(bookPatch(b), { id: uid(), created: Date.now() }); n.parent = n.parent || ""; d.books.push(n); this.put(d); return n; },
  async updateBook(id, p) { const d = this.get(); const b = d.books.find(x => x.id === id); if (b) { Object.assign(b, bookPatch(p)); b.parent = b.parent || ""; } this.put(d); },
  async deleteBook(id) { const d = this.get(); d.books = d.books.filter(x => x.id !== id); d.books.forEach(x => { if (x.parent === id) x.parent = ""; }); d.links = d.links.filter(l => l.from !== id && l.to !== id); this.put(d); },
  async addLink(l) { const d = this.get(); const n = { id: uid(), from: l.from, to: l.to, note: l.note || "", created: Date.now() }; d.links.push(n); this.put(d); return n; },
  async deleteLink(id) { const d = this.get(); d.links = d.links.filter(l => l.id !== id); this.put(d); },
  async updateInbox() {},
  async importAll(books, links) { const d = this.get(); books.forEach((b, i) => d.books.push(Object.assign(bookPatch(b), { id: b.id, parent: b.parent || "", created: Date.now() + i }))); links.forEach(l => d.links.push({ id: uid(), from: l.from, to: l.to, note: l.note || "", created: Date.now() })); this.put(d); }
};

/* ================= display forest =================
   One tree per genre. Groups = subgenres (primary = first). Solid lines stay inside a group.
   A parent in another group, or a book's secondary subgenre, appears as a dashed "ghost" copy.
   Extra links appear as dashed "link" cards hanging off the source book. */
function forest(g, visible) {
  const list = S.books.filter(b => genreOf(b) === g);
  const keys = [""].concat(subsOf(g));
  const roots = new Map(keys.map(k => [k, []]));
  const nodes = new Map();
  const mk = (id, o) => { const n = Object.assign({ id, children: [], parent: null }, o); nodes.set(id, n); return n; };
  const attach = (p, c) => { c.parent = p; p.children.push(c); };
  list.forEach(b => mk("b:" + b.id, { kind: "book", bookId: b.id, group: prim(b), genre: g }));
  const ghost = (bid, k) => { const id = "g:" + bid + "|" + k; let n = nodes.get(id); if (!n) { n = mk(id, { kind: "ghost", bookId: bid, group: k, genre: g }); roots.get(k).push(n); } return n; };
  const reattach = (p, c) => { for (let q = p; q; q = q.parent) if (q === c) return false; const rs = roots.get(c.group); const i = rs.indexOf(c); if (i >= 0) rs.splice(i, 1); attach(p, c); return true; };
  list.forEach(b => {
    const n = nodes.get("b:" + b.id), p = validParent(b), k = prim(b);
    if (p) { if (prim(p) === k) attach(nodes.get("b:" + p.id), n); else attach(ghost(p.id, k), n); }
    else roots.get(k).push(n);
  });
  list.forEach(b => (b.subgenres || []).slice(1).forEach(s => {
    if (!s || s === prim(b)) return;
    const c = ghost(b.id, s), ap = altOf(b, s);
    if (ap && !c.parent) { const pn = prim(ap.book) === s ? nodes.get("b:" + ap.book.id) : ghost(ap.book.id, s); if (pn && reattach(pn, c)) c.altReason = ap.reason || b.reason || ""; }
  }));
  const direct = [];
  S.links.forEach(l => {
    const n = nodes.get("b:" + l.from), t = byId(l.to); if (!n || !t) return;
    // the target's own card is on this map → draw the dashed arrow straight to it; otherwise hang a dashed copy
    if (visible && visible.has(genreOf(t))) direct.push({ from: l.from, to: l.to, note: l.note, linkId: l.id });
    else attach(n, mk("l:" + l.id, { kind: "link", bookId: l.to, group: n.group, genre: g, note: l.note, linkId: l.id }));
  });
  return { groups: keys.map(k => ({ key: k, roots: roots.get(k) })).filter(x => x.roots.length), nodes, direct };
}
const kindRank = n => n.kind === "ghost" ? 0 : n.kind === "book" ? 1 : 2;
const nodeSort = (a, b) => kindRank(a) - kindRank(b) || sortKids(byId(a.bookId), byId(b.bookId));

/* ---------- desktop: all visible genres, left → right ---------- */
function setGeom() {
  S.covers = S.view !== "text";
  if (S.view === "cover") { NODE_W = 54; NODE_H = 78; COL = 86; ROW = 92; }
  else { NODE_W = 176; NODE_H = 72; COL = 214; ROW = 94; }
}
function layoutH(only) {
  setGeom();
  const L = { orient: "h", nodes: [], pills: [], edges: [], sections: [], w: 0, h: 0, view: S.view };
  let y = PAD, maxX = 0;
  const shown = g => only ? g === only : !S.hidden.has(g);
  const vis = new Set(genres().filter(shown)); const direct = [];
  genres().forEach(g => {
    if (!shown(g)) return;
    const F = forest(g, vis); direct.push(...F.direct); const color = gColor(g), gi = gIndex(g);
    const hasSub = F.groups.some(x => x.key);
    // phone shows one genre at a time: drop the genre pill column so the books start closer to the left edge
    const lead = only ? PAD - 12 : PAD + G_W + 40;
    const subX = lead, x0 = hasSub ? subX + S_W + 40 : (only ? PAD : PAD + G_W + 54);
    const pos = new Map(); const centers = []; const genreTop = y;
    const place = (n, d) => {
      const ks = n.children.slice().sort(nodeSort); const x = x0 + d * COL; let cy;
      if (!ks.length) { cy = y + NODE_H / 2; y += ROW; } else { const ys = ks.map(k => place(k, d + 1)); cy = (ys[0] + ys[ys.length - 1]) / 2; }
      pos.set(n.id, { x, y: cy - NODE_H / 2 }); maxX = Math.max(maxX, x + NODE_W); return cy;
    };
    const subPills = [], directRoots = [];
    F.groups.forEach(gr => {
      const top = y; const rs = gr.roots.slice().sort(nodeSort); const ys = rs.map(r => place(r, 0));
      const cy = ys.length ? (ys[0] + ys[ys.length - 1]) / 2 : top + NODE_H / 2;
      if (gr.key) {
        const cnt = S.books.filter(b => genreOf(b) === g && (b.subgenres || []).includes(gr.key)).length;
        const ph = (gr.key.length + String(cnt).length * 0.6) * 12.6 > S_W - 22 ? 46 : S_H; // long names wrap onto two lines
        const pill = { kind: "sub", label: gr.key, count: cnt, x: subX, y: cy - ph / 2, w: S_W, h: ph, genre: g, color, gi };
        L.pills.push(pill); subPills.push(pill); centers.push(cy);
        rs.forEach(r => { const p = pos.get(r.id); L.edges.push({ c: curveH(subX + S_W, cy, p.x, p.y + NODE_H / 2), type: "tree", color, gi, a: null, b: r.bookId }); });
      } else { centers.push(...ys); directRoots.push(...rs); }
      L.sections.push({ genre: g, key: gr.key, y: top });
      y += GR_GAP;
    });
    const gy = centers.length ? (centers[0] + centers[centers.length - 1]) / 2 : genreTop + NODE_H / 2;
    if (!only) L.pills.push({ kind: "genre", label: g, count: S.books.filter(b => genreOf(b) === g).length, x: PAD, y: gy - G_H / 2, w: G_W, h: G_H, genre: g, color, gi });
    if (!only) directRoots.forEach(r => {
      const p = pos.get(r.id), ry = p.y + NODE_H / 2;
      if (hasSub) { // route around the subgenre pills: curve to the pill column, then straight across
        L.edges.push({ c: curveH(PAD + G_W, gy, subX, ry), type: "tree", color, gi, a: null, b: r.bookId });
        L.edges.push({ c: [subX, ry, subX + 10, ry, p.x - 10, ry, p.x, ry], type: "tree", color, gi, a: null, b: r.bookId });
      } else L.edges.push({ c: curveH(PAD + G_W, gy, p.x, ry), type: "tree", color, gi, a: null, b: r.bookId });
    });
    if (!only) subPills.forEach(p => L.edges.push({ c: curveH(PAD + G_W, gy, p.x, p.y + p.h / 2), type: "tree", color, gi, a: null, b: null }));
    pushNodes(L, F, pos, NODE_W, NODE_H, "h", color, gi);
    y += G_GAP - GR_GAP;
  });
  L.w = Math.max(maxX, PAD + G_W) + PAD + 40; L.h = Math.max(y, 200);
  addDirectLinks(L, direct);
  return L;
}

/* ---------- phone: one genre, top → down, one section per subgenre ---------- */
function layoutV(g) {
  setGeom(); const VROW = NODE_H + 34;
  const L = { orient: "v", nodes: [], pills: [], edges: [], sections: [], w: 0, h: 0 };
  const F = forest(g, new Set([g])); const color = gColor(g), gi = gIndex(g);
  const vw = Math.max(320, ($("viewport").clientWidth || 360));
  const cw = Math.max(140, Math.min(176, Math.floor((vw - VPAD * 2 - VGAP) / 2)));
  const pos = new Map(); let y = 14, maxX = vw - VPAD;
  F.groups.forEach(gr => {
    if (gr.key) {
      const label = gr.key; const w = Math.min(vw - VPAD * 2, 30 + label.length * 13 + 28);
      L.pills.push({ kind: "sub", label, count: S.books.filter(b => genreOf(b) === g && (b.subgenres || []).includes(gr.key)).length, x: VPAD, y, w, h: SEC_H, genre: g, color, gi });
      L.sections.push({ genre: g, key: gr.key, y }); y += SEC_H + 14;
    } else { L.sections.push({ genre: g, key: "", y }); }
    gr.roots.slice().sort(nodeSort).forEach(r => {
      const top = y; let x = VPAD, maxD = 0;
      const place = (n, d) => {
        const ks = n.children.slice().sort(nodeSort); let cx;
        if (!ks.length) { cx = x + cw / 2; x += cw + VGAP; } else { const xs = ks.map(k => place(k, d + 1)); cx = (xs[0] + xs[xs.length - 1]) / 2; }
        pos.set(n.id, { x: cx - cw / 2, y: top + d * VROW }); maxD = Math.max(maxD, d); maxX = Math.max(maxX, cx + cw / 2); return cx;
      };
      place(r, 0);
      y = top + maxD * VROW + NODE_H + 22;
    });
    y += 18;
  });
  pushNodes(L, F, pos, cw, NODE_H, "v", color, gi);
  L.w = maxX + VPAD; L.h = y + 20;
  addDirectLinks(L, F.direct);
  return L;
}

function pushNodes(L, F, pos, w, h, orient, color, gi) {
  F.nodes.forEach(n => {
    const p = pos.get(n.id); if (!p) return;
    L.nodes.push({ nid: n.id, kind: n.kind, bookId: n.bookId, x: p.x, y: p.y, w, h, color, gi, genre: n.genre, group: n.group, note: n.note, linkId: n.linkId, altReason: n.altReason, attached: !!n.parent });
    if (n.parent && pos.get(n.parent.id)) {
      const q = pos.get(n.parent.id);
      const c = orient === "h" ? curveH(q.x + w, q.y + h / 2, p.x, p.y + h / 2) : curveV(q.x + w / 2, q.y + h, p.x + w / 2, p.y);
      L.edges.push({ c, type: n.kind === "link" ? "link" : "tree", color, gi, a: n.parent.bookId, b: n.bookId });
    }
  });
}
function addDirectLinks(L, direct) {
  const real = new Map(L.nodes.filter(n => n.kind === "book").map(n => [n.bookId, n]));
  direct.forEach(d => {
    const a = real.get(d.from), b = real.get(d.to); if (!a || !b) return;
    const g = linkCurve(a, b, L.orient);
    let [mx, my] = g.side || g.over ? [g.mx, g.my] : bezPt(g.c, 0.82);
    L.edges.push({ c: g.c, type: "link", a: d.from, b: d.to, note: d.note || "", mx, my, direct: true, anchor: g.side ? "start" : "middle" });
    if (g.side) L.w = Math.max(L.w, g.c[2] + 24 + (d.note ? Math.min(18, d.note.length) * 12 : 0));
  });
}
function linkCurve(a, b, orient) {
  if (orient === "h") {
    const ay = a.y + a.h / 2, by = b.y + b.h / 2;
    if (b.x > a.x + 10 && Math.abs(ay - by) < a.h * 0.6 && b.x - (a.x + a.w) > 8) {
      // same row with cards in between: arc through the gap above the cards instead of running over the solid line
      const top = Math.min(a.y, b.y), ax = a.x + a.w * 0.7, bx = b.x + b.w * 0.3, cy = top - 20;
      return { c: [ax, a.y, ax + 20, cy, bx - 20, cy, bx, b.y - 2], mx: (ax + bx) / 2, my: top - 1, over: true };
    }
    if (b.x > a.x + 10) { const c = curveH(a.x + a.w, ay, b.x - 2, by); return { c, mx: (c[0] + c[6]) / 2, my: (ay + by) / 2 }; }
    if (Math.abs(b.x - a.x) <= 10) { const x = a.x + a.w, bend = Math.min(140, 60 + Math.abs(by - ay) / 4); return { c: [x, ay, x + bend, ay, x + bend, by, x + 4, by], mx: x + bend * .75, my: (ay + by) / 2 }; }
    const x1 = a.x, x2 = b.x + b.w; return { c: [x1, ay, x1 - 60, ay, x2 + 60, by, x2 + 2, by], mx: (x1 + x2) / 2, my: (ay + by) / 2 };
  }
  // phone: go out to the right edge and come back in, so the arrow never runs through the cards in between
  const ay = a.y + a.h / 2, by = b.y + b.h / 2, x1 = a.x + a.w, x2 = b.x + b.w, bend = Math.max(x1, x2) + 34;
  return { c: [x1, ay, bend, ay, bend, by, x2 + 2, by], mx: bend + 2, my: (ay + by) / 2 + 10, side: true };
}
function bezPt(c, t) { const u = 1 - t; const f = (i) => u * u * u * c[i] + 3 * u * u * t * c[i + 2] + 3 * u * t * t * c[i + 4] + t * t * t * c[i + 6]; return [f(0), f(1)]; }
function curveH(x1, y1, x2, y2) { const dx = Math.max(36, (x2 - x1) / 2); return [x1, y1, x1 + dx, y1, x2 - dx, y2, x2, y2]; }
function curveV(x1, y1, x2, y2) { const dy = Math.max(14, (y2 - y1) / 2); return [x1, y1, x1, y1 + dy, x2, y2 - dy, x2, y2]; }
const pathD = c => `M${c[0]},${c[1]} C${c[2]},${c[3]} ${c[4]},${c[5]} ${c[6]},${c[7]}`;

function currentLayout() { return isPhone() ? (S.genre ? layoutH(S.genre) : null) : layoutH(); }

/* card text for any node */
const coverOk = u => typeof u === "string" && u.startsWith("/api/cover?u=");
const coverOf = b => (S.covers && b && coverOk(b.cover_url)) ? b.cover_url : "";
function cardInfo(n) {
  const b = byId(n.bookId) || {};
  if (n.kind === "book") {
    const tags = [];
    if (b.example) tags.push(["예시", ""]);
    (b.subgenres || []).slice(1).forEach(s => tags.push(["+" + s, "sub"]));
    if (b.review_url) tags.push(["리뷰", ""]);
    const incoming = S.links.filter(l => l.to === b.id).length; if (incoming) tags.push(["↔" + (incoming > 1 ? incoming : ""), ""]);
    const cover = coverOf(b);
    const meta = b.reason ? "← " + b.reason : cover ? (b.author || (b.read ? b.read.replace("-", ".") : "")) : [b.author, b.published].filter(Boolean).join(", ");
    return { title: b.title || "제목 없음", meta, tags, cover };
  }
  if (n.kind === "ghost") {
    const where = genreOf(b) !== n.genre ? genreOf(b) : (prim(b) || genreOf(b));
    if (n.attached && n.altReason !== undefined && n.genre === genreOf(b)) return { title: b.title || "", meta: `${n.altReason ? "← " + n.altReason + " · " : ""}${where}에 있음 ↗`, tags: [], cover: coverOf(b) };
    return { title: b.title || "", meta: `${where} 갈래에 있음 ↗`, tags: [], cover: coverOf(b) };
  }
  const where = genreOf(b) + (prim(b) ? "·" + prim(b) : "");
  return { title: b.title || "", meta: `→ ${where}${n.note ? " · " + n.note : ""}`, tags: [], cover: coverOf(b) };
}

/* ================= rendering ================= */
function renderMap() {
  const L = currentLayout(); S.L = L;
  const stage = $("stage"), home = $("home");
  if (!L) { stage.hidden = true; renderHome(); home.hidden = false; return; }
  home.hidden = true; stage.hidden = false;
  const path = new Set(S.sel ? ancestors(S.sel).map(b => b.id) : []);
  const svg = [`<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style="fill:var(--ink2)"/></marker></defs>`];
  L.edges.forEach(e => {
    const on = e.type === "tree" && e.a && path.has(e.a) && path.has(e.b);
    const dim = focusOn() && e.b && !inFocus(byId(e.b));
    if (e.type === "link") {
      svg.push(`<path class="e-link${S.sel && (e.a === S.sel || e.b === S.sel) ? " on" : ""}${dim ? " dim" : ""}" d="${pathD(e.c)}" marker-end="url(#ah)"/>`);
      if (e.direct && e.note && S.view !== "cover") svg.push(`<text class="e-note" x="${e.mx}" y="${e.my - 6}" text-anchor="${e.anchor || "middle"}">${esc(e.note.length > 18 ? e.note.slice(0, 17) + "…" : e.note)}</text>`);
    }
    else svg.push(`<path class="e-tree${on ? " on" : ""}${dim ? " dim" : ""}" style="stroke:${e.color}" d="${pathD(e.c)}"/>`);
  });
  const html = [];
  L.pills.forEach(p => {
    if (p.kind === "genre") html.push(`<div class="gnode" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;--gc:${p.color}"><span>${esc(p.label)}</span><small>${p.count}</small></div>`);
    else html.push(`<div class="snode${p.h > S_H ? " two" : ""}" title="${esc(p.label)}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;--gc:${p.color}"><span>${esc(p.label)} <small>${p.count}</small></span></div>`);
  });
  L.nodes.forEach(n => {
    const info = cardInfo(n); const b = byId(n.bookId);
    const cls = ["node"]; if (n.kind !== "book") cls.push("ghost");
    if (n.kind === "book" && n.bookId === S.sel) cls.push("sel"); else if (path.has(n.bookId) && n.kind !== "link") cls.push("path");
    if (focusOn() && !inFocus(b)) cls.push("dim");
    const tags = info.tags.map(t => `<span class="tag${t[1] ? " " + t[1] : ""}">${esc(t[0])}</span>`).join("");
    if (S.view === "cover") {
      cls.push("cvonly"); if (info.cover) cls.push("has-cover");
      const inner = info.cover ? `<img class="cv" src="${esc(info.cover)}" alt="${esc(info.title)}" loading="lazy" decoding="async">` : `<span class="t">${esc(info.title)}</span>`;
      html.push(`<button class="${cls.join(" ")}" title="${esc(info.title + (info.meta ? " · " + info.meta : ""))}" data-nid="${esc(n.nid)}" data-book="${esc(n.bookId)}" data-kind="${n.kind}" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px;--gc:${n.color}">${inner}</button>`);
      return;
    }
    if (info.cover) cls.push("has-cover");
    const img = info.cover ? `<img class="cv" src="${esc(info.cover)}" alt="" loading="lazy" decoding="async">` : "";
    html.push(`<button class="${cls.join(" ")}" data-nid="${esc(n.nid)}" data-book="${esc(n.bookId)}" data-kind="${n.kind}" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px;--gc:${n.color}">${img}<span class="tx"><span class="t">${esc(info.title)}${tags}</span>${info.meta ? `<span class="m">${esc(info.meta)}</span>` : ""}</span></button>`);
  });
  const e = $("edges"); e.setAttribute("width", L.w); e.setAttribute("height", L.h); e.innerHTML = svg.join("");
  $("nodes").innerHTML = html.join("");
  const z = L.orient === "v" ? 1 : S.zoom;
  const cv = $("canvas"); cv.style.width = L.w + "px"; cv.style.height = L.h + "px"; cv.style.transform = `scale(${z})`;
  stage.style.width = L.w * z + "px"; stage.style.height = L.h * z + "px";
}

function renderHome() {
  const gs = genres();
  if (!gs.length) { $("home").innerHTML = ""; return; }
  $("home").innerHTML = `<h2>장르를 고르세요</h2>` + gs.map(g => {
    const list = S.books.filter(b => genreOf(b) === g);
    const recent = list.slice().sort((a, b) => (b.read || "").localeCompare(a.read || "") || (b.created || 0) - (a.created || 0))[0];
    const subs = subsOf(g);
    const chain = recent ? ancestors(recent.id).map(b => b.title) : [];
    const chainTxt = chain.length > 3 ? `${chain[0]} → … → ${chain[chain.length - 1]}` : chain.join(" → ");
    return `<button class="gcard" data-genre="${esc(g)}" style="--gc:${gColor(g)}"><span class="nm">${esc(g)} <small>${list.length}권</small></span>${chainTxt ? `<span class="ch">${esc(chainTxt)}</span>` : ""}${subs.length ? `<span class="sb">${esc(subs.join(" · "))}</span>` : ""}</button>`;
  }).join("");
}

function renderHeader() {
  $("title").textContent = logTitle();
  document.title = logTitle();
  const parts = ["책의 계보"]; const s = sinceText(); if (s) parts.push("since " + s);
  if (S.books.length) parts.push(`${S.books.length}권 · 장르 ${genres().length}개`);
  $("sub").innerHTML = parts.map(p => `<span>${esc(p)}</span>`).join("");
  $("addBtn").hidden = !S.canWrite;
  $("inboxBtn").hidden = S.mode !== "own";
  const n = S.inbox.length; $("inboxBadge").hidden = !n; $("inboxBadge").textContent = n;
  $("menuLbl").textContent = S.mode === "public" ? "이미지 저장" : "공유·저장";
  $("viewSel").value = S.view;
  const years = [...new Set(S.books.map(b => (b.read || "").slice(0, 4)).filter(Boolean))].sort().reverse();
  const sel = $("period"); const cur = S.period;
  sel.innerHTML = `<option value="">전체 기간</option><option value="last12">최근 1년</option>` + years.map(y => `<option value="${y}">${y}년</option>`).join("");
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : ""; if (sel.value !== cur) S.period = sel.value;
  sel.classList.toggle("on", !!S.period);
}
function renderChips() {
  const gs = genres();
  if (isPhone()) {
    $("chips").innerHTML = (gs.length ? `<button class="chip${S.genre ? "" : " on"}" data-home="1">전체</button>` : "") + gs.map(g => `<button class="chip${S.genre === g ? " on" : ""}" data-g="${esc(g)}" style="--gc:${gColor(g)}"><i></i>${esc(g)} <b>${S.books.filter(b => genreOf(b) === g).length}</b></button>`).join("");
    const subs = S.genre ? subsOf(S.genre) : [];
    const sc = $("subchips"); sc.hidden = !subs.length;
    sc.innerHTML = subs.length ? `<button class="chip" data-sec="">맨 위로</button>` + subs.map(s => `<button class="chip" data-sec="${esc(s)}" style="--gc:${gColor(S.genre)}">${esc(s)}</button>`).join("") : "";
  } else {
    $("chips").innerHTML = gs.map(g => `<button class="chip${S.hidden.has(g) ? " off" : ""}" data-g="${esc(g)}" style="--gc:${gColor(g)}" aria-pressed="${!S.hidden.has(g)}"><i></i>${esc(g)} <b>${S.books.filter(b => genreOf(b) === g).length}</b></button>`).join("");
    $("subchips").hidden = true;
  }
}
function renderNotice() {
  const n = $("notice"); const ex = S.canWrite && S.books.some(b => b.example);
  const parts = [];
  if (S.mode === "demo") parts.push(`<span><b>체험 모드</b> · 아직 서버가 연결되지 않아 이 기기의 브라우저에만 저장돼요.</span>`);
  if (S.kw) { const gs = [...new Set(S.books.filter(b => kwOf(b).some(x => x.toLowerCase() === S.kw.toLowerCase())).map(genreOf))]; parts.push(`<span>키워드 <b>#${esc(S.kw)}</b> 책만 진하게 보는 중${gs.length ? ` · ${esc(gs.join(", "))}` : ""}</span><button class="btn" data-act="kw-clear">모두 보기</button>`); }
  if (S.mode === "public") parts.push(`<span>${esc(ownerName())}님이 공개한 독서로그예요. 책을 누르면 이어진 이유와 리뷰를 볼 수 있어요.</span>${CONFIGURED ? `<a class="btn" href="/">나도 만들기</a>` : ""}`);
  if (ex) parts.push(`<span>‘예시’ 표시가 붙은 책은 사용법을 보여 드리려는 예시예요.</span><button class="btn" data-act="clear-ex">예시 모두 지우기</button>`);
  n.innerHTML = parts.join(""); n.hidden = !parts.length;
}
function renderEmpty() {
  const em = $("empty");
  if (S.books.length) { em.hidden = true; return; }
  em.hidden = false;
  em.innerHTML = S.canWrite
    ? `<div class="card"><h2>첫 책을 올려 보세요</h2><p>장르와 소장르를 정해 출발점이 된 책을 먼저 추가하고, 그 책을 눌러 <b>이어서 읽은 책 추가</b>로 다음 책을 붙이면 가지가 자랍니다. 다른 장르로 넘어간 경우는 <b>다른 책과 연결</b>로 이어 주세요.</p><div class="p-actions"><button class="btn primary" data-act="add">책 추가</button><button class="btn" data-act="import">백업 파일 가져오기</button></div></div>`
    : `<div class="card"><h2>아직 기록된 책이 없어요</h2></div>`;
}
function render() { renderHeader(); renderChips(); renderNotice(); renderMap(); renderEmpty(); }

/* navigation */
function nodeEl(bookId) { return document.querySelector(`.node[data-book="${CSS.escape(bookId)}"][data-kind="book"]`); }
function reveal(bookId) {
  const n = nodeEl(bookId); if (!n) return;
  n.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  n.classList.remove("flash"); void n.offsetWidth; n.classList.add("flash");
}
function goTo(bookId) {
  const b = byId(bookId); if (!b) return;
  const g = genreOf(b);
  if (isPhone()) S.genre = g; else if (S.hidden.has(g)) { S.hidden.delete(g); try { localStorage.setItem("rlog.hidden", JSON.stringify([...S.hidden])); } catch (x) {} }
  S.sel = bookId; S.draft = null; render(); openPanel();
  requestAnimationFrame(() => reveal(bookId));
}
function scrollToSection(key) {
  const L = S.L; if (!L) return; const s = L.sections.find(x => x.key === key); if (!s) return;
  const z = L.orient === "v" ? 1 : S.zoom;
  $("viewport").scrollTo({ top: Math.max(0, s.y * z - 8), left: 0, behavior: "smooth" });
}

/* ================= book panel ================= */
function bookOptions(excl, genre) { return S.books.filter(b => !excl.has(b.id) && genreOf(b) === genre); }
function parentOptionsHtml(excl, genre, cur) {
  const list = bookOptions(excl, genre); const groups = new Map();
  list.forEach(b => { const k = prim(b); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); });
  const order = [""].concat(subsOf(genre)).filter(k => groups.has(k));
  const opt = x => `<option value="${esc(x.id)}"${x.id === cur ? " selected" : ""}>${esc(x.title)}</option>`;
  return `<option value="">이 갈래의 출발점</option>` + order.map(k => { const xs = groups.get(k).sort((a, b) => (a.title || "").localeCompare(b.title || "", "ko")); return k ? `<optgroup label="${esc(k)}">${xs.map(opt).join("")}</optgroup>` : xs.map(opt).join(""); }).join("");
}
function trailLine(t, last) { return t.map(x => `${esc(x.title)}<span class="arr">→</span>`).join("") + `<b>${esc(last.title)}</b>`; }
function trailHtml(b) {
  const t = ancestors(b.id); const lines = [];
  if (t.length > 1) lines.push((b.subgenres || []).length > 1 ? `<span class="tg">${esc(prim(b))}</span> ${trailLine(t.slice(0, -1), b)}` : trailLine(t.slice(0, -1), b));
  (b.subgenres || []).slice(1).forEach(s => { const ap = altOf(b, s); if (ap) lines.push(`<span class="tg">${esc(s)}</span> ${trailLine(ancestors(ap.book.id), b)}`); });
  return lines.length ? `<div class="trail">이 책까지 온 길<br>${lines.join("<br>")}</div>` : "";
}
function kwSugsHtml(current) {
  const have = parseKw(current).map(x => x.toLowerCase());
  return allKeywords().filter(([k]) => !have.includes(k.toLowerCase())).slice(0, 12).map(([k]) => `<button type="button" data-act="add-kw" data-k="${esc(k)}">+ ${esc(k)}</button>`).join("");
}
function readAlts() { const o = {}; document.querySelectorAll("#f-alts .alt-row").forEach(r => { const sv = r.dataset.s; const p = r.querySelector("select").value; const rs = r.querySelector("input").value.trim(); if (p) o[sv] = { parent: p, reason: rs.slice(0, 40) }; }); return o; }
function renderAlts() {
  const box = $("f-alts"); if (!box) return;
  const subs = parseSubs($("f-sub").value), g = $("f-genre").value.trim() || "미분류";
  const cur = Object.assign({}, S._altSeed || {}, box.children.length ? readAlts() : {});
  document.querySelectorAll("#f-alts .alt-row").forEach(r => { if (!r.querySelector("select").value) delete cur[r.dataset.s]; });
  $("f-parent-lbl").textContent = subs.length > 1 ? `‘${subs[0]}’ 갈래에서 이어진 책` : "어떤 책에서 이어졌나요";
  const pool = S.books.filter(x => x.id !== S._editId && genreOf(x) === g);
  box.innerHTML = subs.slice(1).map(sv => {
    const v = (cur[sv] && cur[sv].parent) || "", rs = (cur[sv] && cur[sv].reason) || "";
    const inS = pool.filter(x => (x.subgenres || []).includes(sv)).sort((a, c) => (a.title || "").localeCompare(c.title || "", "ko"));
    const rest = pool.filter(x => !(x.subgenres || []).includes(sv)).sort((a, c) => (a.title || "").localeCompare(c.title || "", "ko"));
    const opt = x => `<option value="${esc(x.id)}"${x.id === v ? " selected" : ""}>${esc(x.title)}</option>`;
    return `<div class="alt-row field" data-s="${esc(sv)}"><label>‘${esc(sv)}’ 갈래에서 이어진 책 <span class="hint">(선택)</span></label>
      <select aria-label="${esc(sv)} 갈래에서 이어진 책"><option value="">이 갈래의 출발점</option>${inS.length ? `<optgroup label="${esc(sv)}">${inS.map(opt).join("")}</optgroup>` : ""}${rest.length ? `<optgroup label="그 밖의 책">${rest.map(opt).join("")}</optgroup>` : ""}</select>
      <input value="${esc(rs)}" maxlength="40" placeholder="이 연결의 이유 (비우면 아래 이유를 같이 써요)" autocomplete="off"></div>`;
  }).join("");
}
function subSugsHtml(genre, current) {
  const have = parseSubs(current); const subs = subsOf(genre).filter(s => !have.includes(s));
  return subs.map(s => `<button type="button" data-act="add-sub" data-s="${esc(s)}">+ ${esc(s)}</button>`).join("");
}

function openPanel() {
  const P = $("panel"); const isNew = !!S.draft; const b = isNew ? S.draft : byId(S.sel);
  if (!b) { closePanel(); return; }
  if (!S.canWrite) { openInfo(b); return; }
  const excl = isNew ? new Set() : descendants(b.id);
  P.innerHTML = `
  <div class="p-head"><h2>${isNew ? "새 책" : "책 정보"}</h2><button class="btn icon" data-act="close" aria-label="닫기">×</button></div>
  <div class="p-body">
    ${isNew ? "" : trailHtml(b)}
    <div class="field"><label for="f-q">책 검색</label><div class="sbox"><input id="f-q" type="search" value="${esc(isNew ? "" : (b.title || ""))}" placeholder="제목으로 찾아 표지까지 채우기" autocomplete="off"><button class="btn" data-act="bsearch">찾기</button></div><div class="bres" id="f-res" hidden></div></div>
    <div class="cvprev" id="f-cvprev"${coverOk(b.cover_url) ? "" : " hidden"}><img id="f-cvimg" src="${esc(coverOk(b.cover_url) ? b.cover_url : "")}" alt="표지"><button type="button" class="btn small" data-act="cover-clear">표지 지우기</button></div>
    <input type="hidden" id="f-cover" value="${esc(coverOk(b.cover_url) ? b.cover_url : "")}"><input type="hidden" id="f-publisher" value="${esc(b.publisher || "")}">
    <div class="field"><label for="f-title">제목</label><input id="f-title" class="title" value="${esc(b.title || "")}" placeholder="책 제목" autocomplete="off"></div>
    <div class="field"><label for="f-author">저자</label><input id="f-author" value="${esc(b.author || "")}" autocomplete="off"></div>
    <div class="row2">
      <div class="field"><label for="f-pub">출간년도</label><input id="f-pub" inputmode="numeric" maxlength="4" value="${esc(b.published || "")}" placeholder="예: 2021" autocomplete="off"></div>
      <div class="field"><label for="f-read">읽은 때</label><input id="f-read" type="month" value="${esc(b.read || "")}"></div>
    </div>
    <div class="field"><label for="f-genre">장르</label><div class="combo"><input id="f-genre" value="${esc(b.genre || "")}" placeholder="예: 심리, 문학 (새 이름을 쓰면 새 장르)" autocomplete="off"><button type="button" class="combo-btn" data-act="genre-list" aria-label="기존 장르에서 고르기" aria-expanded="false">▾</button><div class="combo-list" id="f-genre-list" hidden></div></div></div>
    <div class="field"><label for="f-sub">소장르 (선택)</label><input id="f-sub" value="${esc(subsText(b))}" placeholder="예: 중독, 뇌과학" autocomplete="off">
      <div class="sugs" id="f-sugs">${subSugsHtml(genreOf(b), subsText(b))}</div>
      <span class="hint">쉼표로 여러 개를 쓸 수 있어요. 처음 쓴 소장르 갈래에 책이 놓이고, 나머지 갈래에는 점선 사본이 생겨요.</span></div>
    <div class="field"><label for="f-parent" id="f-parent-lbl">${(b.subgenres || []).length > 1 ? `‘${esc(prim(b))}’ 갈래에서 이어진 책` : "어떤 책에서 이어졌나요"}</label>
      <select id="f-parent">${parentOptionsHtml(excl, genreOf(b), b.parent)}</select>
      <span class="hint">같은 장르의 책을 고를 수 있어요. 소장르가 다르면 이 책 갈래에 그 책의 점선 사본이 생기고 실선으로 이어져요.</span></div>
    <div id="f-alts" class="alts"></div>
    <div class="field"><label for="f-reason">이어진 이유 (짧게)</label><div class="sbox"><input id="f-reason" value="${esc(b.reason || "")}" placeholder="예: 저자의 전작, 책 속에서 언급됨" maxlength="40" autocomplete="off"><button type="button" class="btn small" data-act="reason-to-kw" title="이유에 적은 말을 키워드로 옮겨요">키워드로 ↓</button></div></div>
    <div class="field"><label for="f-kw">키워드</label><input id="f-kw" value="${esc(kwOf(b).join(", "))}" placeholder="예: DX, 플랫폼, 구독경제" autocomplete="off">
      <div class="sugs" id="f-kwsugs">${kwSugsHtml(kwOf(b).join(","))}</div>
      <span class="hint">쉼표로 여러 개를 쓸 수 있어요. 장르와 상관없이 같은 주제의 책을 검색하고 모아 볼 때 써요.</span></div>
    <div class="field"><label for="f-review">리뷰 링크</label><input id="f-review" type="url" inputmode="url" value="${esc(b.review_url || "")}" placeholder="블로그 리뷰 주소 (선택)" autocomplete="off">${isUrl(b.review_url) ? `<a class="hint" href="${esc(b.review_url)}" target="_blank" rel="noopener">리뷰 열기 ↗</a>` : ""}</div>
    <div class="err" id="f-err" hidden></div>
    <div class="p-actions">
      <button class="btn primary" data-act="save">${isNew ? "추가" : "저장"}</button>
      ${isNew ? "" : `<button class="btn" data-act="child">이어서 읽은 책 추가</button><button class="btn" data-act="before">앞에 읽은 책 추가</button><button class="btn danger" data-act="del">삭제</button>`}
    </div>
    ${isNew ? "" : `<div class="sec" id="p-links"></div>`}
  </div>`;
  P.hidden = false;
  if (!isNew) renderLinks();
  S._altSeed = Object.assign({}, b.alt_parents || {}); S._editId = isNew ? null : b.id;
  const refresh = () => { const g = $("f-genre").value.trim() || "미분류"; const sel = $("f-parent"); sel.innerHTML = parentOptionsHtml(excl, g, sel.value); $("f-sugs").innerHTML = subSugsHtml(g, $("f-sub").value); renderAlts(); };
  $("f-genre").addEventListener("change", refresh);
  $("f-sub").addEventListener("input", () => { $("f-sugs").innerHTML = subSugsHtml($("f-genre").value.trim() || "미분류", $("f-sub").value); renderAlts(); });
  renderAlts();
  if (isNew) setTimeout(() => { const t = $("f-title"); if (t && t.value) return; const q = $("f-q"); (q || t) && (q || t).focus(); }, 40);
}
function openInfo(b) {
  const P = $("panel");
  const myLinks = S.links.filter(l => l.from === b.id || l.to === b.id);
  P.innerHTML = `
  <div class="p-head"><h2>책 정보</h2><button class="btn icon" data-act="close" aria-label="닫기">×</button></div>
  <div class="p-body info">
    ${trailHtml(b)}
    ${coverOk(b.cover_url) ? `<img class="bigcv" src="${esc(b.cover_url)}" alt="${esc(b.title)} 표지">` : ""}
    <h2>${esc(b.title)}</h2>
    <dl>
      ${b.author ? `<dt>저자</dt><dd>${esc(b.author)}</dd>` : ""}
      ${b.published || b.publisher ? `<dt>출간</dt><dd>${esc([b.publisher, b.published && b.published + "년"].filter(Boolean).join(", "))}</dd>` : ""}
      <dt>장르</dt><dd>${esc(genreOf(b))}${(b.subgenres || []).length ? " · " + esc(subsText(b)) : ""}</dd>
      ${b.read ? `<dt>읽은 때</dt><dd>${esc(b.read.replace("-", "."))}</dd>` : ""}
      ${validParent(b) ? `<dt>이어진 책</dt><dd>${esc(validParent(b).title)}</dd>` : ""}
      ${(b.subgenres || []).slice(1).map(sv => { const ap = altOf(b, sv); return ap ? `<dt>${esc(sv)}에서</dt><dd>${esc(ap.book.title)}${ap.reason ? ` · ${esc(ap.reason)}` : ""}</dd>` : ""; }).join("")}
      ${b.reason ? `<dt>이유</dt><dd>${esc(b.reason)}</dd>` : ""}
      ${kwOf(b).length ? `<dt>키워드</dt><dd class="kwchips">${kwOf(b).map(k => `<button type="button" class="kwchip" data-act="kw-focus" data-k="${esc(k)}">#${esc(k)}</button>`).join("")}</dd>` : ""}
    </dl>
    ${isUrl(b.review_url) ? `<a class="btn" href="${esc(b.review_url)}" target="_blank" rel="noopener">리뷰 읽기 ↗</a>` : ""}
    ${myLinks.length ? `<div class="sec"><h3>다른 책과의 연결</h3>${myLinks.map(l => linkRowHtml(l, b, true)).join("")}</div>` : ""}
  </div>`;
  P.hidden = false;
}
function linkRowHtml(l, b, ro) {
  const out = l.from === b.id; const o = byId(out ? l.to : l.from);
  return `<div class="lk"><div class="txt">${out ? "이 책 → " : ""}<b>${esc(o ? o.title : "(삭제된 책)")}</b>${out ? "" : " → 이 책"}${l.note ? `<small>${esc(l.note)}</small>` : ""}</div>${o ? `<button data-act="goto" data-id="${esc(o.id)}">보기</button>` : ""}${ro ? "" : `<button data-act="unlink" data-id="${esc(l.id)}">지우기</button>`}</div>`;
}
function renderLinks() {
  const box = $("p-links"); const b = byId(S.sel); if (!box || !b) return;
  const myLinks = S.links.filter(l => l.from === b.id || l.to === b.id);
  const others = S.books.filter(x => x.id !== b.id);
  const keepTo = $("l-to") && $("l-to").value, keepDir = $("l-dir") && $("l-dir").value;
  const grouped = genres().map(gg => { const xs = others.filter(x => genreOf(x) === gg).sort((a, c) => (a.title || "").localeCompare(c.title || "", "ko")); return xs.length ? `<optgroup label="${esc(gg)}">${xs.map(x => `<option value="${esc(x.id)}">${esc(x.title)}</option>`).join("")}</optgroup>` : ""; }).join("");
  box.innerHTML = `<h3>다른 책과 연결</h3>
    ${myLinks.length ? myLinks.map(l => linkRowHtml(l, b, false)).join("") : `<span class="hint">다른 장르로 넘어간 책이나, 두 권의 영향을 받은 경우에 써요.</span>`}
    ${others.length ? `<div class="addlink">
      <div class="row2"><div class="field"><label for="l-dir">방향</label><select id="l-dir"><option value="in">그 책 → 이 책</option><option value="out">이 책 → 그 책</option></select></div>
      <div class="field"><label for="l-to">연결할 책</label><select id="l-to">${grouped}</select></div></div>
      <div class="field"><label for="l-note">메모</label><input id="l-note" maxlength="30" placeholder="예: 같은 질문이 이어짐" autocomplete="off"></div>
      <div><button class="btn" data-act="link">연결 추가</button></div></div>` : ""}`;
  if (keepTo && $("l-to")) $("l-to").value = keepTo; if (keepDir && $("l-dir")) $("l-dir").value = keepDir;
}
function closePanel() { S.sel = null; S.draft = null; $("panel").hidden = true; renderMap(); }
function select(id) { S.sel = id; S.draft = null; renderMap(); openPanel(); requestAnimationFrame(() => { const n = nodeEl(id); n && n.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }); }); }
function newBook(preset) {
  const base = { title: "", author: "", genre: "", subgenres: [], parent: "", reason: "", read: "", review_url: "" };
  if (!preset && isPhone() && S.genre) base.genre = S.genre === "미분류" ? "" : S.genre;
  S.sel = null; S.draft = Object.assign(base, preset || {}); renderMap(); openPanel();
  // keep the book you are adding from in sight (the panel now takes its own space instead of covering the map)
  const anchor = (preset && (preset._before || preset.parent)) || "";
  if (anchor) requestAnimationFrame(() => { const n = nodeEl(anchor); n && n.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }); });
}

function fail(e, what) {
  console.error(e);
  const msg = (e && (e.message || e.error_description)) || "";
  if (/JWT|session|auth/i.test(msg)) toast("로그인이 만료됐어요. 새로고침 후 다시 로그인해 주세요.");
  else if (/subgenres|feed_url|published|keywords|cover_url|publisher|alt_parents|column/i.test(msg)) toast("데이터베이스 업데이트가 필요해요. 설정 가이드대로 schema.sql을 한 번 더 실행해 주세요.");
  else toast(`${what || "저장"}하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.`);
}
async function save() {
  const v = id => ($(id) ? $(id).value : "").trim();
  const data = { title: v("f-title"), author: v("f-author"), published: v("f-pub"), genre: v("f-genre"), subgenres: parseSubs(v("f-sub")), read: v("f-read"), parent: v("f-parent"), reason: v("f-reason"), review_url: v("f-review"), cover_url: coverOk(v("f-cover")) ? v("f-cover") : "", publisher: v("f-publisher"), keywords: parseKw(v("f-kw")), alt_parents: readAlts() };
  const err = $("f-err");
  if (!data.title) { err.textContent = "제목을 입력해 주세요."; err.hidden = false; return; }
  if (data.published && !/^\d{4}$/.test(data.published)) { err.textContent = "출간년도는 2021처럼 숫자 네 자리로 넣어 주세요."; err.hidden = false; return; }
  if (data.review_url && !isUrl(data.review_url)) { err.textContent = "리뷰 링크는 https:// 로 시작하는 주소로 넣어 주세요."; err.hidden = false; return; }
  if (data.parent) { const p = byId(data.parent); if (!p || genreOf(p) !== (data.genre || "미분류")) data.parent = ""; }
  try {
    if (S.draft) {
      const inboxId = S.draft._inbox, before = S.draft._before;
      const nb = await S.store.addBook(data); S.books.push(nb);
      if (before) { await S.store.updateBook(before, { parent: nb.id }); const o = byId(before); if (o) o.parent = nb.id; }
      if (inboxId) { await S.store.updateInbox(inboxId, { status: "added", book_id: nb.id }); S.inbox = S.inbox.filter(i => i.id !== inboxId); }
      S.draft = null; S.sel = nb.id; toast("추가했어요");
      if (isPhone()) S.genre = genreOf(nb);
    } else {
      await S.store.updateBook(S.sel, data); Object.assign(byId(S.sel), data); toast("저장했어요");
      if (isPhone()) S.genre = genreOf(byId(S.sel));
    }
    render(); openPanel(); requestAnimationFrame(() => reveal(S.sel));
  } catch (e) { fail(e); }
}
async function del(btn) {
  if (!btn.classList.contains("armed")) { btn.classList.add("armed"); btn.textContent = "한 번 더 누르면 삭제"; setTimeout(() => { if (btn.isConnected) { btn.classList.remove("armed"); btn.textContent = "삭제"; } }, 3500); return; }
  const b = byId(S.sel); if (!b) return;
  try {
    const np = validParent(b) ? b.parent : "";
    for (const k of S.books.filter(x => x.parent === b.id)) { await S.store.updateBook(k.id, { parent: np }); k.parent = np; }
    await S.store.deleteBook(b.id);
    S.books = S.books.filter(x => x.id !== b.id); S.links = S.links.filter(l => l.from !== b.id && l.to !== b.id);
    if (S.genre && !genres().includes(S.genre)) S.genre = null;
    toast("삭제했어요"); closePanel(); render();
  } catch (e) { fail(e, "삭제"); }
}
async function addLink() {
  const to = $("l-to").value, dir = $("l-dir").value, note = $("l-note").value.trim(); if (!to) return;
  const from = dir === "out" ? S.sel : to, target = dir === "out" ? to : S.sel;
  if (S.links.some(l => l.from === from && l.to === target)) { toast("이미 연결되어 있어요"); return; }
  try { const l = await S.store.addLink({ from, to: target, note }); S.links.push(l); renderMap(); renderLinks(); toast("연결했어요"); } catch (e) { fail(e); }
}
async function unlink(id) { try { await S.store.deleteLink(id); S.links = S.links.filter(l => l.id !== id); renderMap(); renderLinks(); toast("연결을 지웠어요"); } catch (e) { fail(e, "삭제"); } }
async function clearExamples() {
  try {
    for (const l of S.links.filter(l => l.example)) await S.store.deleteLink(l.id);
    for (const b of S.books.filter(b => b.example)) await S.store.deleteBook(b.id);
    S.links = S.links.filter(l => !l.example); S.books = S.books.filter(b => !b.example);
    S.genre = null; if (S.sel && !byId(S.sel)) closePanel(); render(); toast("예시를 지웠어요");
  } catch (e) { fail(e, "삭제"); }
}

/* ================= book search (Kakao) ================= */
let bookHits = [];
async function bookSearch() {
  const q = ($("f-q").value || "").trim(); const box = $("f-res"); if (!box) return;
  if (!q) { box.hidden = true; return; }
  box.hidden = false;
  if (S.mode !== "own") { box.innerHTML = `<div class="none">책 검색은 서버에 연결하고 로그인한 뒤에 쓸 수 있어요.</div>`; return; }
  box.innerHTML = `<div class="none">찾는 중…</div>`;
  try {
    const s = await Supa.session();
    const r = await fetch("/api/book-search?q=" + encodeURIComponent(q), { headers: { Authorization: "Bearer " + (s ? s.access_token : "") } });
    if (r.status === 501) { box.innerHTML = `<div class="none">책 검색 설정이 아직 안 됐어요. 가이드의 ‘책 검색 켜기’를 따라 카카오 키를 넣어 주세요.</div>`; return; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status);
    bookHits = j.items || [];
    box.innerHTML = bookHits.length ? bookHits.map((it, i) => `<button type="button" data-act="pick" data-i="${i}">${coverOk(it.cover) ? `<img src="${esc(it.cover)}" alt="" loading="lazy">` : `<span class="noimg"></span>`}<span><b>${esc(it.title)}</b><small>${esc([it.author, it.published, it.publisher].filter(Boolean).join(" · "))}</small></span></button>`).join("") : `<div class="none">찾는 책이 없어요. 제목을 조금 줄여서 찾아 보세요.</div>`;
  } catch (e) { console.error(e); box.innerHTML = `<div class="none">책을 찾지 못했어요. 잠시 후 다시 시도해 주세요.</div>`; }
}
function pickBook(i) {
  const it = bookHits[i]; if (!it) return;
  $("f-title").value = it.title || $("f-title").value;
  if (it.author) $("f-author").value = it.author;
  if (/^\d{4}$/.test(it.published || "")) $("f-pub").value = it.published;
  $("f-publisher").value = it.publisher || "";
  const cv = coverOk(it.cover) ? it.cover : "";
  $("f-cover").value = cv; $("f-cvimg").src = cv; $("f-cvprev").hidden = !cv;
  $("f-res").hidden = true; $("f-q").value = it.title || "";
  toast("책 정보를 채웠어요. 저장을 눌러 주세요");
}
/* ---------- rename genres / subgenres ---------- */
function openRename() {
  const gs = genres();
  const row = (kind, g, sname, count) => {
    const cur = kind === "g" ? g : sname;
    return `<div class="rn-row${kind === "s" ? " sub" : ""}"><input value="${esc(cur === "미분류" && kind === "g" ? "" : cur)}" placeholder="${kind === "g" ? "미분류" : ""}" data-kind="${kind}" data-g="${esc(g)}" data-s="${esc(sname || "")}" maxlength="20" aria-label="${esc(cur)} 새 이름"><small>${count}권</small><button class="btn small" data-act="rn-go">바꾸기</button></div>`;
  };
  openModal(`${head("장르·소장르 이름 바꾸기")}
    <p class="hint">이름을 고치고 바꾸기를 누르면 그 이름을 쓰는 책이 모두 함께 바뀌어요. 이미 있는 이름으로 바꾸면 두 장르(또는 소장르)가 하나로 합쳐집니다. 이어진 책과 연결은 그대로 남아요.</p>
    <div class="rn-list">${gs.map(g => {
      const list = S.books.filter(b => genreOf(b) === g);
      return `<div class="rn-g" style="--gc:${gColor(g)}">${row("g", g, "", list.length)}${subsOf(g).map(sn => row("s", g, sn, list.filter(b => (b.subgenres || []).includes(sn)).length)).join("")}</div>`;
    }).join("")}</div>`, true);
}
async function renameGo(btn) {
  const inp = btn.parentElement.querySelector("input"); const kind = inp.dataset.kind, g = inp.dataset.g, old = kind === "g" ? g : inp.dataset.s;
  const nv = inp.value.trim().slice(0, 20);
  if (kind === "s" && !nv) { toast("소장르 이름을 입력해 주세요"); return; }
  if ((kind === "g" ? (nv || "미분류") : nv) === old) { toast("이름이 그대로예요"); return; }
  const targets = S.books.filter(b => genreOf(b) === g && (kind === "g" || (b.subgenres || []).includes(old)));
  btn.disabled = true; let done = 0;
  try {
    for (const b of targets) {
      const patch = kind === "g" ? { genre: nv } : { subgenres: parseSubs((b.subgenres || []).map(x => x === old ? nv : x).join(",")) };
      if (kind === "s" && b.alt_parents && b.alt_parents[old]) { const ap = Object.assign({}, b.alt_parents); if (!ap[nv]) ap[nv] = ap[old]; delete ap[old]; patch.alt_parents = ap; }
      await S.store.updateBook(b.id, patch); Object.assign(b, patch); done++; btn.textContent = `${done}/${targets.length}`;
    }
    if (kind === "g") {
      const ng = nv || "미분류";
      if (S.genre === g) S.genre = ng;
      if (S.hidden.has(g)) { S.hidden.delete(g); try { localStorage.setItem("rlog.hidden", JSON.stringify([...S.hidden])); } catch (e) {} }
    }
    render(); openRename(); toast(`${done}권의 ${kind === "g" ? "장르" : "소장르"} 이름을 바꿨어요`);
  } catch (e) { fail(e); render(); openRename(); }
}

/* ---------- bulk cover finder ---------- */
const BULK = { rows: [], run: 0 };
const normT = t => String(t || "").toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, "").replace(/[\s\-–—:·.,!?'"“”‘’「」『』<>《》]/g, "");
const queryOf = t => String(t || "").replace(/\([^)]*\)|\[[^\]]*\]/g, " ").split(/[:：|]| - /)[0].trim() || String(t || "");
function scoreHit(b, it) {
  const a = normT(b.title), h = normT(it.title);
  let s = 0;
  if (a && h === a) s = 3; else if (a && (h.startsWith(a) || a.startsWith(h))) s = 2; else if (a && (h.includes(a) || a.includes(h))) s = 1;
  const au = String(b.author || "").split(/[,\s]+/).filter(x => x.length > 1);
  const authorOk = au.length ? au.some(x => String(it.author || "").includes(x)) : null;
  return { s: s + (authorOk ? 1 : 0), sure: s === 3 && authorOk !== false || s >= 2 && authorOk === true };
}
function openBulk() {
  const list = S.books.filter(b => !coverOk(b.cover_url)).sort((a, b) => genres().indexOf(genreOf(a)) - genres().indexOf(genreOf(b)) || (a.title || "").localeCompare(b.title || "", "ko"));
  BULK.rows = list.map(b => ({ id: b.id, hits: null, k: 0, state: "wait" }));
  BULK.run++;
  openModal(`${head("표지 한꺼번에 찾기")}
    ${list.length ? `<p class="hint">표지가 없는 책 ${list.length}권을 제목으로 찾아 가장 비슷한 결과를 보여 드려요. 제목과 저자가 맞는 책은 미리 체크되고, 애매한 책은 비워 둬요. 맞는 것만 체크해서 저장하세요. 제목은 바뀌지 않고, 비어 있는 저자·출간년도만 채워져요.</p>
    <div class="p-actions"><button class="btn primary" data-act="bulk-start" id="bk-start">찾기 시작</button><span class="hint" id="bk-prog"></span></div>
    <div class="bk-list" id="bk-list"></div>
    <div class="p-actions bk-foot" id="bk-foot" hidden><button class="btn small" data-act="bulk-all" data-v="1">모두 체크</button><button class="btn small" data-act="bulk-all" data-v="0">모두 해제</button><button class="btn primary" data-act="bulk-save" id="bk-save">체크한 0권 저장</button></div>`
    : `<p class="hint">모든 책에 표지가 있어요.</p>`}`, true);
  bulkRender();
}
function bulkRowHtml(row, i) {
  const b = byId(row.id); if (!b) return "";
  const it = row.hits && row.hits[row.k];
  let right;
  if (row.state === "wait") right = `<span class="hint">대기 중</span>`;
  else if (row.state === "busy") right = `<span class="hint">찾는 중…</span>`;
  else if (row.state === "err") right = `<span class="hint">찾지 못했어요</span>`;
  else if (!it) right = `<span class="hint">검색 결과가 없어요</span>`;
  else right = `${coverOk(it.cover) ? `<img src="${esc(it.cover)}" alt="" loading="lazy">` : `<span class="noimg"></span>`}<span class="bk-hit"><b>${esc(it.title)}</b><small>${esc([it.author, it.published].filter(Boolean).join(" · "))}</small>${row.hits.length > 1 ? `<button type="button" class="btn small" data-act="bulk-next" data-i="${i}">다른 결과 ${row.k + 1}/${row.hits.length}</button>` : ""}</span>`;
  const can = !!(it && coverOk(it.cover));
  return `<label class="bk-row"><input type="checkbox" data-i="${i}" ${row.checked && can ? "checked" : ""} ${can ? "" : "disabled"}><span class="bk-mine"><b>${esc(b.title)}</b><small>${esc([genreOf(b), b.author].filter(Boolean).join(" · "))}</small></span><span class="bk-found">${right}</span></label>`;
}
function bulkRender() { const box = $("bk-list"); if (!box) return; box.innerHTML = BULK.rows.map(bulkRowHtml).join(""); box.querySelectorAll("input[type=checkbox]").forEach(x => x.addEventListener("change", () => { BULK.rows[+x.dataset.i].checked = x.checked; bulkCount(); })); bulkCount(); }
function bulkCount() { const n = document.querySelectorAll(".bk-row input[type=checkbox]:checked").length; const b = $("bk-save"); if (b) b.textContent = `체크한 ${n}권 저장`; BULK.rows.forEach((r, i) => { const x = document.querySelector(`.bk-row input[data-i="${i}"]`); if (x) r.checked = x.checked; }); }
function bulkNext(i) { const r = BULK.rows[i]; if (!r || !r.hits) return; r.k = (r.k + 1) % r.hits.length; r.checked = true; const el = document.querySelectorAll(".bk-row")[i]; if (el) { el.outerHTML = bulkRowHtml(r, i); const x = document.querySelector(`.bk-row input[data-i="${i}"]`); if (x) x.addEventListener("change", () => { r.checked = x.checked; bulkCount(); }); } bulkCount(); }
async function bulkRun() {
  const run = BULK.run, st = $("bk-start"); st.disabled = true; st.textContent = "찾는 중…"; $("bk-foot").hidden = false;
  let token = "";
  try { const s = await Supa.session(); token = s ? s.access_token : ""; } catch (e) {}
  let done = 0, next = 0, stop = false;
  const prog = () => { const p = $("bk-prog"); if (p) p.textContent = `${done} / ${BULK.rows.length}`; };
  const work = async () => {
    while (!stop && next < BULK.rows.length && BULK.run === run && !$("modal").hidden) {
      const i = next++, row = BULK.rows[i], b = byId(row.id);
      row.state = "busy"; bulkRender();
      try {
        const r = await fetch("/api/book-search?q=" + encodeURIComponent(queryOf(b.title)), { headers: { Authorization: "Bearer " + token } });
        if (r.status === 501) { stop = true; const p = $("bk-prog"); if (p) p.textContent = "책 검색 설정이 아직 안 됐어요. 가이드의 ‘책 검색과 표지 켜기’를 확인해 주세요."; row.state = "wait"; break; }
        const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
        const hits = (j.items || []).map(it => Object.assign({ sc: scoreHit(b, it) }, it)).sort((x, y) => y.sc.s - x.sc.s || (coverOk(y.cover) - coverOk(x.cover)));
        row.hits = hits; row.k = 0; row.checked = !!(hits[0] && hits[0].sc.sure && coverOk(hits[0].cover)); row.state = "done";
      } catch (e) { row.state = "err"; }
      done++; if (BULK.run === run) { bulkRender(); prog(); }
      await new Promise(res => setTimeout(res, 150));
    }
  };
  prog(); await Promise.all([work(), work(), work()]);
  if (BULK.run === run && st.isConnected) { st.textContent = "다 찾았어요"; }
}
async function bulkSave(btn) {
  const picks = BULK.rows.filter(r => r.checked && r.hits && r.hits[r.k] && coverOk(r.hits[r.k].cover));
  if (!picks.length) { toast("체크한 책이 없어요"); return; }
  btn.disabled = true; let ok = 0;
  for (const r of picks) {
    const b = byId(r.id), it = r.hits[r.k]; if (!b) continue;
    const patch = { cover_url: it.cover, publisher: b.publisher || it.publisher || "" };
    if (!b.author && it.author) patch.author = it.author;
    if (!b.published && /^\d{4}$/.test(it.published || "")) patch.published = it.published;
    try { await S.store.updateBook(b.id, patch); Object.assign(b, patch); ok++; btn.textContent = `저장 중 ${ok}/${picks.length}`; } catch (e) { fail(e); break; }
  }
  closeModal(); render(); toast(`${ok}권에 표지를 붙였어요`);
}
function setView(v) {
  S.view = v; try { localStorage.setItem("rlog.view", v); } catch (e) {}
  renderHeader(); renderMap(); if (S.sel) requestAnimationFrame(() => reveal(S.sel));
}

/* ================= search ================= */
let searchIdx = -1;
function runSearch() {
  const q = $("q").value.trim().toLowerCase(); const box = $("results");
  if (!q) { box.hidden = true; return; }
  const qq = q.replace(/^#/, "");
  const kws = allKeywords().filter(([k]) => k.toLowerCase().includes(qq)).slice(0, 4);
  const kwHit = b => kwOf(b).find(k => k.toLowerCase().includes(qq));
  const hits = S.books.filter(b => q[0] === "#" ? kwHit(b) : ((b.title || "").toLowerCase().includes(q) || (b.author || "").toLowerCase().includes(q) || kwHit(b))).slice(0, 8);
  const kwRows = kws.map(([k, n]) => `<button data-kwf="${esc(k)}" class="kwrow"><b>#${esc(k)}</b><small>키워드 · ${n}권 모아 보기</small></button>`);
  const bookRows = hits.map(b => { const k = kwHit(b); return `<button data-hit="${esc(b.id)}"><b>${esc(b.title)}</b><small>${esc([genreOf(b) + (prim(b) ? " · " + prim(b) : ""), b.author, b.read && "읽음 " + b.read.replace("-", ".")].filter(Boolean).join(" · "))}${k ? ` · #${esc(k)}` : ""}</small></button>`; });
  const rows = kwRows.concat(bookRows);
  searchIdx = rows.length ? 0 : -1;
  box.innerHTML = rows.length ? rows.join("") : `<div class="none">찾는 책이 없어요.</div>`;
  const first = box.querySelector("button"); if (first) first.classList.add("on");
  box.hidden = false;
}
function setKw(k) {
  S.kw = k || ""; $("results").hidden = true; $("q").value = ""; $("q").blur();
  if (S.kw && isPhone()) { const g = genres().find(g => S.books.some(b => genreOf(b) === g && kwOf(b).some(x => x.toLowerCase() === S.kw.toLowerCase()))); if (g && (!S.genre || !S.books.some(b => genreOf(b) === S.genre && kwOf(b).includes(S.kw)))) S.genre = g; }
  render();
  if (S.kw) { const n = S.books.filter(b => kwOf(b).some(x => x.toLowerCase() === S.kw.toLowerCase())).length; toast(`#${S.kw} 책 ${n}권을 진하게 보여 줘요`); }
}
function pickHit(id) { $("results").hidden = true; $("q").value = ""; $("q").blur(); goTo(id); }

/* ================= modal sheets ================= */
function openModal(html, wide) { const m = $("modal"); m.innerHTML = `<div class="sheet${wide ? " wide" : ""}" role="dialog" aria-modal="true">${html}</div>`; m.hidden = false; }
function closeModal() { const m = $("modal"); m.hidden = true; m.innerHTML = ""; if (S.crop) S.crop = { ratio: S.crop.ratio, header: S.crop.header }; }
const head = t => `<div class="sheet-head"><h2>${esc(t)}</h2><button class="btn icon" data-act="modal-close" aria-label="닫기">×</button></div>`;

function openMenu() {
  if (S.mode === "public") { openImage(); return; }
  openModal(`${head("공유·저장")}
  <div class="menu">
    <button data-act="m-share">공개 링크·QR 코드<small>${S.profile && S.profile.is_public ? "공개 중" : S.mode === "demo" ? "서버 연결 후 사용" : "비공개"}</small></button>
    <button data-act="m-image">이미지(JPG)로 저장<small>범위 직접 정하기</small></button>
    ${S.mode === "own" ? `<button data-act="m-bulk">표지 한꺼번에 찾기<small>표지 없는 책 ${S.books.filter(b => !coverOk(b.cover_url)).length}권</small></button>` : ""}
    <hr>
    <button data-act="m-rename">장르·소장르 이름 바꾸기</button>
    <button data-act="m-settings">닉네임·since·글 피드 설정</button>
    <button data-act="m-export">백업 파일 내려받기<small>JSON</small></button>
    <button data-act="import">백업 파일 가져오기</button>
    ${S.mode === "own" ? `<hr><button data-act="m-logout">로그아웃</button>` : ""}
  </div>`);
}

function openSettings(first) {
  const p = S.profile || {};
  const showHandle = S.mode === "own";
  openModal(`${first ? `<div class="sheet-head"><h2>독서로그 만들기</h2></div><p class="hint">공개 주소는 나중에 지인에게 보여 줄 링크에 쓰여요. 영문 소문자, 숫자, 밑줄(_)로 3~20자.</p>` : head("설정")}
  <div class="field"><label for="s-nick">닉네임</label><input id="s-nick" maxlength="20" value="${esc(p.nickname || "")}" placeholder="예: 수현"><span class="hint">제목이 ‘닉네임의 독서로그’로 표시돼요.</span></div>
  ${showHandle ? `<div class="field"><label for="s-handle">공개 주소</label><div class="urlbox"><input id="s-handle" maxlength="20" value="${esc(p.handle || "")}" placeholder="예: suereads" autocapitalize="off" autocomplete="off" spellcheck="false"></div><span class="hint">${esc(location.origin)}/u/<b id="s-handle-prev">${esc(p.handle || "주소")}</b></span></div>` : ""}
  <div class="field"><label for="s-since">since</label><input id="s-since" maxlength="10" value="${esc(p.since || "")}" placeholder="예: 2021 또는 2021-03"><span class="hint">비워 두면 가장 먼저 읽은 책의 연도로 표시돼요.</span></div>
  ${first ? "" : `<div class="sec"><h3>글 피드 연동 (선택)</h3>
    <div class="field"><label for="s-feed">블로그 주소 또는 피드(RSS) 주소</label><input id="s-feed" maxlength="300" value="${esc(feedLabel(feedOfProfile(p)))}" placeholder="예: blog.naver.com/아이디, ○○.tistory.com" autocapitalize="off" spellcheck="false" inputmode="url"></div>
    <div class="field"><label for="s-cat">카테고리 (선택)</label><input id="s-cat" maxlength="40" value="${esc(p.blog_category || "")}" placeholder="예: 독서리뷰"></div>
    <span class="hint">네이버 블로그, 티스토리, 벨로그, 서브스택, 미디엄은 블로그 주소만 넣으면 돼요. 그 밖의 곳은 그 서비스가 알려 주는 RSS 주소를 넣어 주세요. 하루 한 번 새 글을 확인해 ‘리뷰’ 알림으로 보여 드려요.</span></div>`}
  <div class="err" id="s-err" hidden></div>
  <div class="p-actions"><button class="btn primary" data-act="s-save" data-first="${first ? 1 : ""}">${first ? "시작하기" : "저장"}</button></div>`);
  const h = $("s-handle"); if (h) h.addEventListener("input", () => { h.value = h.value.toLowerCase().replace(/[^a-z0-9_]/g, ""); $("s-handle-prev").textContent = h.value || "주소"; });
}
async function saveSettings(first) {
  const v = id => ($(id) ? $(id).value.trim() : undefined);
  const p = { nickname: v("s-nick"), since: v("s-since") };
  const err = $("s-err"); const show = m => { err.textContent = m; err.hidden = false; };
  if (!p.nickname) return show("닉네임을 입력해 주세요.");
  if ($("s-handle")) { p.handle = v("s-handle"); if (!/^[a-z0-9_]{3,20}$/.test(p.handle)) return show("공개 주소는 영문 소문자, 숫자, 밑줄로 3~20자로 정해 주세요."); }
  if (p.since && !/^\d{4}(-\d{1,2})?$/.test(p.since)) return show("since는 2021 또는 2021-03 형식으로 넣어 주세요.");
  if ($("s-feed")) {
    const f = normFeed(v("s-feed"));
    if (f === null) return show("블로그나 피드 주소를 확인해 주세요. 예: blog.naver.com/아이디");
    p.feed_url = f; p.blog_id = ""; p.blog_category = v("s-cat");
  }
  try {
    S.profile = await S.store.saveProfile(p);
    closeModal();
    if (first) { $("gate").hidden = true; await loadData(); showApp(); }
    else { render(); toast("저장했어요"); }
  } catch (e) {
    if (e && (e.code === "23505" || /duplicate/i.test(e.message || ""))) show("이미 다른 사람이 쓰는 공개 주소예요. 다른 주소를 골라 주세요.");
    else if (e && /feed_url|column/i.test(e.message || "")) show("데이터베이스 업데이트가 필요해요. 설정 가이드대로 schema.sql을 한 번 더 실행해 주세요.");
    else { show("저장하지 못했어요. 잠시 후 다시 시도해 주세요."); console.error(e); }
  }
}

/* share + QR */
function openShare() {
  if (S.mode === "demo") { openModal(`${head("공개 링크·QR 코드")}<p class="hint">공개 링크는 Supabase를 연결하고 로그인한 뒤에 만들 수 있어요. 체험 모드에서는 이미지 저장만 쓸 수 있어요.</p>`); return; }
  const p = S.profile; const url = publicUrl();
  openModal(`${head("공개 링크·QR 코드")}
    <label class="switch"><input type="checkbox" id="pub" ${p.is_public ? "checked" : ""}> 링크가 있는 사람은 볼 수 있게 공개</label>
    <p class="hint">공개해도 보는 사람은 편집할 수 없어요. 끄면 링크와 QR이 바로 막힙니다.</p>
    <div id="share-body"${p.is_public ? "" : " hidden"}>
      <div style="display:grid;gap:12px">
        <div class="urlbox"><input id="share-url" readonly value="${esc(url)}"><button class="btn" data-act="copy-url">복사</button></div>
        <div class="preview"><canvas id="qr"></canvas></div>
        <div class="p-actions"><button class="btn primary" data-act="qr-save">QR 이미지 저장</button><a class="btn" href="${esc(url)}" target="_blank" rel="noopener">공개 화면 보기 ↗</a></div>
      </div>
    </div>`);
  if (p.is_public) drawQr($("qr"), url);
  $("pub").addEventListener("change", async e => {
    const on = e.target.checked;
    try { S.profile = await S.store.saveProfile({ is_public: on }); $("share-body").hidden = !on; if (on) drawQr($("qr"), url); toast(on ? "공개했어요" : "비공개로 바꿨어요"); }
    catch (er) { e.target.checked = !on; fail(er); }
  });
}
function drawQr(cv, url) {
  const q = qrcode(0, "M"); q.addData(url); q.make();
  const n = q.getModuleCount(), cell = 10, m = 4, size = (n + m * 2) * cell, foot = 96;
  cv.width = size; cv.height = size + foot;
  const c = cv.getContext("2d");
  c.fillStyle = "#FFFFFF"; c.fillRect(0, 0, cv.width, cv.height);
  c.fillStyle = "#1B231F";
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) c.fillRect((k + m) * cell, (r + m) * cell, cell, cell);
  c.textAlign = "center"; c.fillStyle = "#1B231F";
  c.font = `700 30px "Gowun Batang", serif`; c.fillText(logTitle(), size / 2, size + 30, size - 40);
  c.fillStyle = "#5A645E"; c.font = `400 17px "IBM Plex Sans KR", sans-serif`; c.fillText(url.replace(/^https?:\/\//, ""), size / 2, size + 64, size - 40);
}

/* ================= map → canvas ================= */
function theme() {
  const cs = getComputedStyle(document.documentElement); const tk = n => cs.getPropertyValue(n).trim();
  return { bg: tk("--bg"), surface: tk("--surface"), surface2: tk("--surface2"), ink: tk("--ink"), ink2: tk("--ink2"), line: tk("--line"), dot: tk("--dot"), g: [0, 1, 2, 3, 4, 5].map(i => tk(`--g${i}`)) };
}
function wrapText(c, text, maxW, maxLines) {
  // break between words first (like the cards on screen), and inside a word only when it is too long
  const tokens = String(text).split(/(\s+)/).filter(t => t.length);
  const lines = []; let cur = ""; let cut = false;
  const push = l => { if (lines.length < maxLines) lines.push(l); else cut = true; };
  for (const tk of tokens) {
    if (c.measureText(cur + tk).width <= maxW) { cur += tk; continue; }
    if (/^\s+$/.test(tk)) { push(cur); cur = ""; continue; }
    if (cur.trim()) { push(cur.trimEnd()); cur = ""; }
    if (c.measureText(tk).width <= maxW) { cur = tk; continue; }
    for (const ch of Array.from(tk)) { if (c.measureText(cur + ch).width > maxW && cur) { push(cur); cur = ch; } else cur += ch; }
  }
  if (cur.trim()) push(cur.trimEnd());
  if ((cut || lines.length > maxLines) && lines.length) {
    lines.length = Math.min(lines.length, maxLines);
    let last = lines[lines.length - 1]; while (last && c.measureText(last + "…").width > maxW) last = last.slice(0, -1);
    lines[lines.length - 1] = last + "…";
  }
  return lines;
}
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function drawMap(c, L, T) {
  const bez = cc => { c.beginPath(); c.moveTo(cc[0], cc[1]); c.bezierCurveTo(cc[2], cc[3], cc[4], cc[5], cc[6], cc[7]); c.stroke(); };
  c.lineCap = "round";
  L.edges.forEach(e => {
    if (e.type === "link") {
      c.strokeStyle = T.ink2; c.fillStyle = T.ink2; c.lineWidth = 1.4; c.globalAlpha = 1; c.setLineDash([5, 4]); bez(e.c); c.setLineDash([]);
      const ex = e.c[6], ey = e.c[7], ang = Math.atan2(ey - e.c[5], ex - e.c[4]);
      c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex - 8 * Math.cos(ang - .45), ey - 8 * Math.sin(ang - .45)); c.lineTo(ex - 8 * Math.cos(ang + .45), ey - 8 * Math.sin(ang + .45)); c.closePath(); c.fill();
      if (e.direct && e.note && L.view !== "cover") { const t = e.note.length > 18 ? e.note.slice(0, 17) + "…" : e.note; c.font = `400 11.5px "IBM Plex Sans KR", sans-serif`; c.textAlign = e.anchor === "start" ? "left" : "center"; c.lineWidth = 4; c.lineJoin = "round"; c.strokeStyle = T.bg; c.strokeText(t, e.mx, e.my - 6); c.fillText(t, e.mx, e.my - 6); c.textAlign = "left"; }
    } else { c.strokeStyle = T.g[e.gi]; c.lineWidth = 1.8; c.globalAlpha = .62; bez(e.c); c.globalAlpha = 1; }
  });
  L.pills.forEach(p => {
    const col = T.g[p.gi];
    if (p.kind === "genre") { c.fillStyle = col; rr(c, p.x, p.y, p.w, p.h, p.h / 2); c.fill(); c.fillStyle = T.surface; c.font = `600 13.5px "IBM Plex Sans KR", sans-serif`; }
    else { c.fillStyle = T.surface; rr(c, p.x, p.y, p.w, p.h, 7); c.fill(); c.strokeStyle = col; c.lineWidth = 1.5; c.stroke(); c.fillStyle = col; c.font = `600 12.5px "IBM Plex Sans KR", sans-serif`; }
    c.textAlign = "center"; c.textBaseline = "middle";
    const pl = wrapText(c, `${p.label} ${p.count}`, p.w - 16, p.kind === "sub" ? 2 : 1);
    pl.forEach((ln, k) => c.fillText(ln, p.x + p.w / 2, p.y + p.h / 2 + 1 + (k - (pl.length - 1) / 2) * 15));
    c.textAlign = "left"; c.textBaseline = "alphabetic";
  });
  L.nodes.forEach(n => {
    const info = cardInfo(n); const col = T.g[n.gi]; const ghost = n.kind !== "book";
    if (L.view === "cover") {
      const im = info.cover && imgCache.get(info.cover);
      c.fillStyle = ghost ? T.surface2 : T.surface; rr(c, n.x, n.y, n.w, n.h, 6); c.fill();
      if (im && im.complete && im.naturalWidth) { c.save(); if (ghost) c.globalAlpha = .45; rr(c, n.x + 2, n.y + 2, n.w - 4, n.h - 4, 5); c.clip(); c.drawImage(im, n.x + 2, n.y + 2, n.w - 4, n.h - 4); c.restore(); }
      else { c.fillStyle = T.ink; c.font = `700 10.5px "Gowun Batang", serif`; let ty = n.y + 16; wrapText(c, info.title, n.w - 8, 5).forEach(l => { c.fillText(l, n.x + 4, ty); ty += 13; }); }
      c.lineWidth = ghost ? 1 : 2; c.strokeStyle = col; if (ghost) c.setLineDash([4, 3]); rr(c, n.x, n.y, n.w, n.h, 6); c.stroke(); c.setLineDash([]);
      return;
    }
    c.fillStyle = ghost ? T.surface2 : T.surface; rr(c, n.x, n.y, n.w, n.h, 10); c.fill();
    c.lineWidth = 1; c.strokeStyle = ghost ? col : T.line; if (ghost) c.setLineDash([4, 3]); c.stroke(); c.setLineDash([]);
    const im = info.cover && imgCache.get(info.cover);
    let tx = n.x + 12;
    if (im && im.complete && im.naturalWidth) {
      const ch = n.h - 16, cw = Math.round(ch * 0.69);
      c.save(); if (ghost) c.globalAlpha = .5; rr(c, n.x + 8, n.y + 8, cw, ch, 3); c.clip(); c.drawImage(im, n.x + 8, n.y + 8, cw, ch); c.restore();
      tx = n.x + 8 + cw + 9;
    } else if (!ghost) { c.fillStyle = col; c.fillRect(n.x, n.y + 10, 3, n.h - 20); }
    const tw = n.x + n.w - 10 - tx;
    c.font = ghost ? `400 13px "Gowun Batang", serif` : `700 14px "Gowun Batang", serif`;
    const tl = wrapText(c, info.title, tw, 2);
    const blockH = tl.length * 17 + (info.meta ? 16 : 0);
    let ty = n.y + (n.h - blockH) / 2 + 13;
    c.fillStyle = T.ink; tl.forEach(line => { c.fillText(line, tx, ty); ty += 17; });
    if (info.meta) { c.fillStyle = T.ink2; c.font = `400 11.5px "IBM Plex Sans KR", sans-serif`; c.fillText(wrapText(c, info.meta, tw, 1)[0] || "", tx, ty + 1); }
  });
}
const imgCache = new Map();
function loadCovers(L) {
  const urls = [...new Set(L.nodes.map(n => cardInfo(n).cover).filter(Boolean))];
  return Promise.all(urls.map(u => new Promise(res => {
    let im = imgCache.get(u);
    if (im && im.complete) return res();
    if (!im) { im = new Image(); im.decoding = "async"; im.src = u; imgCache.set(u, im); }
    im.addEventListener("load", res, { once: true }); im.addEventListener("error", res, { once: true });
    setTimeout(res, 6000);
  })));
}
function contentBox(L, filter) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  L.nodes.concat(filter ? [] : L.pills).forEach(n => { if (filter && !filter(n)) return; x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y); x2 = Math.max(x2, n.x + n.w); y2 = Math.max(y2, n.y + n.h); });
  if (x1 === Infinity) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/* ================= image crop ================= */
const RATIOS = { "1:1": [1080, 1080], "4:5": [1080, 1350], "9:16": [1080, 1920], "full": null };
const HEAD_PX = 170;           // header band height in a 1080-wide image
function openImage() {
  if (!S.books.length) { toast("저장할 책이 아직 없어요"); return; }
  const L = S.L || (isPhone() ? layoutH(S.genre || genres()[0]) : layoutH());
  if (!L || !L.nodes.length) { toast("지도에 보이는 책이 없어요. 장르를 켜 주세요."); return; }
  const prev = S.crop || {};
  S.crop = { L, ratio: prev.ratio || "4:5", header: prev.header !== false, z: 1, tx: 0, ty: 0, preset: S.sel ? "path" : "all", lock: false };
  const r = S.crop.ratio;
  openModal(`${head("이미지로 저장")}
    <div class="seg" role="group" aria-label="비율">
      ${[["1:1", "1:1"], ["4:5", "4:5 게시물"], ["9:16", "9:16 스토리"], ["full", "지도 전체"]].map(([k, t]) => `<button data-act="crop-ratio" data-k="${k}" aria-pressed="${r === k}">${t}</button>`).join("")}
    </div>
    <div class="presets" id="crop-presets">
      <button class="btn small" data-act="crop-preset" data-p="all">보이는 범위 전체</button>
      <button class="btn small" data-act="crop-preset" data-p="path">선택한 책까지의 길</button>
      <button class="btn small" data-act="crop-preset" data-p="screen">지금 화면</button>
    </div>
    <div class="cropwrap"><div class="cropframe" id="cf"><div class="cf-head" id="cfh"><b id="cfh-t"></b><small id="cfh-s"></small></div><div class="cf-map" id="cfm"><canvas id="cfc"></canvas></div></div></div>
    <p class="hint" id="crop-hint">틀 안의 지도를 끌어서 옮기고, 두 손가락이나 마우스 휠로 확대·축소해 범위를 맞춰요.</p>
    <p class="warn" id="crop-warn" hidden>글씨가 작아요. 확대하거나 범위를 좁히면 SNS에서 더 잘 읽혀요.</p>
    <label class="switch"><input type="checkbox" id="crop-head" ${S.crop.header ? "checked" : ""}> 위쪽에 ‘${esc(logTitle())}’ 제목 넣기</label>
    <div class="p-actions"><button class="btn primary" data-act="crop-save">JPG 저장</button></div>`, true);
  const T = theme(); const cv = $("cfc");
  const ps = Math.min(2, 5000 / Math.max(L.w, L.h));
  cv.width = Math.ceil(L.w * ps); cv.height = Math.ceil(L.h * ps); cv.style.width = L.w + "px"; cv.style.height = L.h + "px";
  const c = cv.getContext("2d"); c.scale(ps, ps);
  const draw = () => { c.clearRect(0, 0, L.w, L.h); drawMap(c, L, T); };
  draw(); if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw).catch(() => {});
  loadCovers(L).then(draw);
  $("crop-head").addEventListener("change", e => { S.crop.header = e.target.checked; layoutCrop(true); });
  bindCropGestures($("cfm"));
  layoutCrop(false);
}
function cropSize() { const k = S.crop.ratio; if (k !== "full") return RATIOS[k]; const L = S.crop.L; const hh = S.crop.header ? 96 : 0; return [L.w, L.h + hh]; }
function headFrac() { if (!S.crop.header) return 0; const H = cropSize()[1]; return S.crop.ratio === "full" ? 96 / H : HEAD_PX / H; }
function layoutCrop(keep) {
  const C = S.crop; const [W, H] = cropSize(); const cf = $("cf"); if (!cf) return;
  const wrapW = cf.parentElement.clientWidth - 20, maxH = Math.min(window.innerHeight * 0.52, 560);
  let fw = wrapW, fh = fw * H / W; if (fh > maxH) { fh = maxH; fw = fh * W / H; }
  cf.style.width = fw + "px"; cf.style.height = fh + "px";
  const hh = fh * headFrac();
  const h = $("cfh"); h.hidden = !C.header; h.style.height = hh + "px";
  $("cfh-t").textContent = logTitle(); $("cfh-t").style.fontSize = Math.max(10, fw * (C.ratio === "full" ? 0.03 : 0.054)) + "px";
  $("cfh-s").textContent = headerSub(); $("cfh-s").style.fontSize = Math.max(9, fw * (C.ratio === "full" ? 0.016 : 0.024)) + "px";
  const m = $("cfm"); m.style.top = hh + "px";
  C.lock = C.ratio === "full";
  m.classList.toggle("lock", C.lock); $("crop-presets").hidden = C.lock; $("crop-hint").hidden = C.lock;
  if (C.lock || !keep || !C.preset) applyPreset(C.lock ? "all" : (C.preset || "all"), true); else applyPreset(C.preset, true);
}
function headerSub() { const since = sinceText(); const L = S.crop && S.crop.L ? S.crop.L : S.L; const ids = new Set((L ? L.nodes : []).filter(n => n.kind === "book").map(n => n.bookId)); return ["책의 계보", since ? "since " + since : "", ids.size ? `${ids.size}권` : ""].filter(Boolean).join("  ·  "); }
function applyPreset(p, silent) {
  const C = S.crop, L = C.L, m = $("cfm"); if (!m) return;
  const vw = m.clientWidth, vh = m.clientHeight;
  let bb = null;
  if (C.lock) bb = { x: 0, y: 0, w: L.w, h: L.h };
  else if (p === "path") {
    if (!S.sel) { if (!silent) toast("먼저 지도에서 책을 하나 골라 주세요"); p = "all"; }
    else { const path = new Set(ancestors(S.sel).map(b => b.id)); bb = contentBox(L, n => path.has(n.bookId) && n.kind !== "link"); if (!bb) p = "all"; }
  } else if (p === "screen") {
    const v = $("viewport"); const z = L.orient === "v" ? 1 : S.zoom;
    bb = { x: v.scrollLeft / z, y: v.scrollTop / z, w: Math.min(L.w, v.clientWidth / z), h: Math.min(L.h, v.clientHeight / z) };
  }
  if (!bb) bb = contentBox(L) || { x: 0, y: 0, w: L.w, h: L.h };
  C.preset = p;
  const pad = C.lock ? 0 : 18;
  const z = Math.min(vw / (bb.w + pad * 2), vh / (bb.h + pad * 2));
  C.z = C.lock ? z : Math.min(z, 3);
  C.tx = (vw - bb.w * C.z) / 2 - bb.x * C.z; C.ty = (vh - bb.h * C.z) / 2 - bb.y * C.z;
  document.querySelectorAll('[data-act="crop-preset"]').forEach(b => b.classList.toggle("primary", b.dataset.p === p && !C.lock));
  applyCrop();
}
function applyCrop() {
  const C = S.crop; const cv = $("cfc"); if (!cv) return;
  cv.style.transform = `translate(${C.tx}px,${C.ty}px) scale(${C.z})`;
  const m = $("cfm"); const W = cropSize()[0];
  const outW = C.ratio === "full" ? Math.min(2, 7000 / Math.max(C.L.w, C.L.h + 96)) * C.L.w : W;
  const titlePx = 14 * C.z * (outW / m.clientWidth);
  $("crop-warn").hidden = titlePx >= 28;
}
function bindCropGestures(m) {
  const pts = new Map(); let start = null;
  const snap = () => { const a = [...pts.values()]; if (a.length === 1) return { x: a[0].x, y: a[0].y, d: 0 }; const [p, q] = a; return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, d: Math.hypot(p.x - q.x, p.y - q.y) }; };
  const begin = () => { const C = S.crop; start = Object.assign(snap(), { tx: C.tx, ty: C.ty, z: C.z }); };
  const clearPreset = () => { S.crop.preset = null; document.querySelectorAll('[data-act="crop-preset"]').forEach(b => b.classList.remove("primary")); };
  m.addEventListener("pointerdown", e => { if (S.crop.lock) return; m.setPointerCapture(e.pointerId); const r = m.getBoundingClientRect(); pts.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top }); begin(); });
  m.addEventListener("pointermove", e => {
    if (!pts.has(e.pointerId) || !start) return; const r = m.getBoundingClientRect(); pts.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
    const C = S.crop, s = snap();
    let z = start.z; if (pts.size > 1 && start.d > 0 && s.d > 0) z = Math.min(4, Math.max(0.05, start.z * s.d / start.d));
    C.z = z; C.tx = s.x - (start.x - start.tx) * (z / start.z); C.ty = s.y - (start.y - start.ty) * (z / start.z);
    clearPreset(); applyCrop();
  });
  const end = e => { pts.delete(e.pointerId); if (pts.size) begin(); else start = null; };
  m.addEventListener("pointerup", end); m.addEventListener("pointercancel", end);
  m.addEventListener("wheel", e => {
    if (S.crop.lock) return; e.preventDefault();
    const C = S.crop, r = m.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const z = Math.min(4, Math.max(0.05, C.z * Math.exp(-e.deltaY * 0.0015)));
    C.tx = x - (x - C.tx) * (z / C.z); C.ty = y - (y - C.ty) * (z / C.z); C.z = z; clearPreset(); applyCrop();
  }, { passive: false });
}
function renderCropOutput() {
  const C = S.crop, L = C.L, T = theme(); const m = $("cfm");
  const cv = document.createElement("canvas"); const c = cv.getContext("2d");
  let W, H, hh;
  if (C.ratio === "full") {
    const head = C.header ? 96 : 0; const s = Math.min(2, 7000 / Math.max(L.w, L.h + head));
    W = Math.round(L.w * s); H = Math.round((L.h + head) * s); hh = head * s;
    cv.width = W; cv.height = H; paintBg(c, W, H, T, 22 * s);
    if (C.header) paintHeader(c, W, hh, T, s * 0.55);
    c.save(); c.translate(0, hh); c.scale(s, s); drawMap(c, L, T); c.restore();
  } else {
    [W, H] = RATIOS[C.ratio]; hh = C.header ? HEAD_PX : 0;
    cv.width = W; cv.height = H; paintBg(c, W, H, T, 24);
    const k = W / m.clientWidth;
    c.save(); c.beginPath(); c.rect(0, hh, W, H - hh); c.clip();
    c.translate(0, hh); c.scale(k, k); c.translate(C.tx, C.ty); c.scale(C.z, C.z); drawMap(c, L, T); c.restore();
    if (C.header) paintHeader(c, W, hh, T, 1);
    if (S.profile && S.profile.is_public && publicUrl()) { c.fillStyle = T.ink2; c.font = `400 22px "IBM Plex Sans KR", sans-serif`; c.textAlign = "right"; c.fillText(publicUrl().replace(/^https?:\/\//, ""), W - 48, H - 32); c.textAlign = "left"; }
  }
  return cv;
}
function paintBg(c, W, H, T, gs) { c.fillStyle = T.bg; c.fillRect(0, 0, W, H); c.fillStyle = T.dot; const d = Math.max(1.5, gs / 11); for (let x = gs / 2; x < W; x += gs) for (let y = gs / 2; y < H; y += gs) c.fillRect(x, y, d, d); }
function paintHeader(c, W, hh, T, k) {
  c.fillStyle = T.bg; c.fillRect(0, 0, W, hh);
  c.textAlign = "left"; c.fillStyle = T.ink; c.font = `700 ${58 * k}px "Gowun Batang", serif`; c.fillText(logTitle(), 60 * k, hh * 0.56, W - 120 * k);
  c.fillStyle = T.ink2; c.font = `400 ${26 * k}px "IBM Plex Sans KR", sans-serif`; c.fillText(headerSub(), 62 * k, hh * 0.56 + 42 * k, W - 120 * k);
  c.fillStyle = T.line; c.fillRect(60 * k, hh - 2 * k, W - 120 * k, 2 * k);
}
async function saveCrop() {
  try { await document.fonts.ready; } catch (e) {}
  await loadCovers(S.crop.L);
  const cv = renderCropOutput();
  cv.toBlob(b => { if (b) saveBlob(b, `${logTitle()}-${fileStamp()}.jpg`); else toast("이미지를 만들지 못했어요"); }, "image/jpeg", 0.92);
}
async function saveBlob(blob, name) {
  try {
    const file = new File([blob], name, { type: blob.type });
    if (coarse() && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: logTitle() }); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast("저장했어요");
}
const fileStamp = () => new Date().toISOString().slice(0, 10);

/* ================= review inbox ================= */
function guessTitle(t) {
  t = String(t || "");
  const m = t.match(/[『《〈「<]\s*([^』》〉」>]+?)\s*[』》〉」>]/); if (m) return m[1].trim();
  return t.replace(/^\s*((\[[^\]]*\]|\([^)]*\)|【[^】]*】)\s*)+/, "").split(/\s[-–|:]\s|\s*\/\s*/)[0].trim();
}
function openInbox() {
  const p = S.profile || {}; const feed = feedOfProfile(p);
  const items = S.inbox;
  openModal(`${head("리뷰 알림")}
    ${feed ? `<p class="hint">${esc(feedLabel(feed))}${p.blog_category ? ` · ‘${esc(p.blog_category)}’ 카테고리` : ""}의 새 글이에요. 하루 한 번 자동으로 확인해요.</p>`
      : `<p class="hint">아직 블로그가 연결되지 않았어요. <button class="btn small" data-act="m-settings">설정에서 블로그 주소 넣기</button></p>`}
    ${items.length ? items.map(it => `<div class="inbox-item" data-iid="${esc(it.id)}">
        <div class="tt">${esc(it.title)}</div>
        <div class="meta">${it.published_at ? esc(new Date(it.published_at).toLocaleDateString("ko-KR")) : ""}${it.category ? " · " + esc(it.category) : ""} · <a href="${esc(it.url)}" target="_blank" rel="noopener">글 보기 ↗</a></div>
        <div class="acts"><button class="btn primary" data-act="ib-new" data-id="${esc(it.id)}">새 책으로 추가</button><button class="btn" data-act="ib-attach" data-id="${esc(it.id)}">기존 책에 붙이기</button><button class="btn" data-act="ib-skip" data-id="${esc(it.id)}">넘기기</button></div>
        <div class="ib-attach" hidden></div>
      </div>`).join("") : `<p class="hint">새로 확인할 리뷰가 없어요.</p>`}
    ${feed ? `<div class="p-actions"><button class="btn" data-act="ib-sync">지금 새 글 확인</button></div>` : ""}`);
}
async function syncNow(btn) {
  btn.disabled = true; btn.textContent = "확인하는 중…";
  try {
    const s = await Supa.session();
    const r = await fetch("/api/sync-blogs", { headers: { Authorization: "Bearer " + (s ? s.access_token : "") } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status);
    S.inbox = await Supa.inbox(); renderHeader(); openInbox();
    toast(j.added ? `새 리뷰 ${j.added}개를 찾았어요` : "새 리뷰가 없어요");
  } catch (e) { console.error(e); toast("글을 가져오지 못했어요. 블로그 주소와 공개 설정을 확인해 주세요."); btn.disabled = false; btn.textContent = "지금 새 글 확인"; }
}
const inboxItem = id => S.inbox.find(i => i.id === id);

/* ================= export / import ================= */
function exportJson() {
  const data = { app: "reading-log", version: 2, exported: new Date().toISOString(), profile: { nickname: (S.profile || {}).nickname || "", since: (S.profile || {}).since || "" },
    books: S.books.map(b => ({ id: b.id, title: b.title, author: b.author, published: b.published || "", genre: b.genre, subgenres: b.subgenres || [], parent: b.parent || "", reason: b.reason, read: b.read, review_url: b.review_url || "", cover_url: b.cover_url || "", publisher: b.publisher || "", keywords: kwOf(b), alt_parents: b.alt_parents || {} })),
    links: S.links.map(l => ({ from: l.from, to: l.to, note: l.note })) };
  saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `독서로그-백업-${fileStamp()}.json`);
}
function pickImport() {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json,application/json";
  inp.onchange = async () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!d || !Array.isArray(d.books)) throw new Error("format");
      const map = new Map(); d.books.forEach(b => map.set(String(b.id), uid()));
      const books = d.books.filter(b => b && b.title).map(b => ({ id: map.get(String(b.id)), title: String(b.title).slice(0, 200), author: String(b.author || ""), published: /^\d{4}$/.test(String(b.published || "")) ? String(b.published) : "", genre: String(b.genre || ""), subgenres: Array.isArray(b.subgenres) ? parseSubs(b.subgenres.join(",")) : [], parent: b.parent ? (map.get(String(b.parent)) || "") : "", reason: String(b.reason || ""), read: String(b.read || ""), review_url: isUrl(b.review_url) ? b.review_url : "", cover_url: coverOk(b.cover_url) ? b.cover_url : "", publisher: String(b.publisher || "").slice(0, 100), keywords: Array.isArray(b.keywords) ? parseKw(b.keywords.join(",")) : [], alt_parents: Object.fromEntries(Object.entries((b.alt_parents && typeof b.alt_parents === "object") ? b.alt_parents : {}).map(([k, v]) => [String(k).slice(0, 20), { parent: v && map.get(String(v.parent)) || "", reason: String((v && v.reason) || "").slice(0, 40) }]).filter(([, v]) => v.parent)) }));
      const done = new Set(), ordered = []; let guard = 0;
      while (ordered.length < books.length && guard++ < books.length + 2) books.forEach(b => { if (!done.has(b.id) && (!b.parent || done.has(b.parent) || !books.some(x => x.id === b.parent))) { done.add(b.id); ordered.push(b); } });
      books.forEach(b => { if (!done.has(b.id)) { b.parent = ""; ordered.push(b); } });
      const links = (d.links || []).map(l => ({ from: map.get(String(l.from)), to: map.get(String(l.to)), note: String(l.note || "") })).filter(l => l.from && l.to && done.has(l.from) && done.has(l.to));
      await S.store.importAll(ordered, links);
      closeModal(); await loadData(); render(); toast(`${ordered.length}권을 가져왔어요`);
    } catch (e) { console.error(e); toast("가져오지 못했어요. 이 앱에서 만든 백업 파일인지 확인해 주세요."); }
  };
  inp.click();
}

/* ================= events ================= */
document.addEventListener("click", async e => {
  const hit = e.target.closest("[data-hit]"); if (hit) { pickHit(hit.dataset.hit); return; }
  const kwf = e.target.closest("[data-kwf]"); if (kwf) { setKw(kwf.dataset.kwf); return; }
  if (!e.target.closest(".search")) $("results").hidden = true;
  if (!e.target.closest(".combo") && $("f-genre-list")) $("f-genre-list").hidden = true;
  const n = e.target.closest(".node");
  if (n) { if (n.dataset.kind === "book") select(n.dataset.book); else goTo(n.dataset.book); return; }
  const gc = e.target.closest(".gcard"); if (gc) { S.genre = gc.dataset.genre; S.sel = null; $("panel").hidden = true; render(); $("viewport").scrollTo(0, 0); return; }
  const c = e.target.closest(".chip");
  if (c) {
    if (c.dataset.home) { S.genre = null; S.sel = null; $("panel").hidden = true; render(); return; }
    if ("sec" in c.dataset) { scrollToSection(c.dataset.sec); return; }
    const g = c.dataset.g;
    if (isPhone()) { S.genre = S.genre === g ? null : g; S.sel = null; $("panel").hidden = true; render(); $("viewport").scrollTo(0, 0); }
    else { S.hidden.has(g) ? S.hidden.delete(g) : S.hidden.add(g); try { localStorage.setItem("rlog.hidden", JSON.stringify([...S.hidden])); } catch (x) {} render(); }
    return;
  }
  if (e.target === $("modal")) { closeModal(); return; }
  const a = e.target.closest("[data-act]"); if (!a) return;
  const act = a.dataset.act, id = a.dataset.id;
  switch (act) {
    case "close": closePanel(); break;
    case "add": newBook(); break;
    case "save": save(); break;
    case "del": del(a); break;
    case "child": { const b = byId(S.sel); newBook({ genre: b.genre || "", subgenres: prim(b) ? [prim(b)] : [], parent: b.id }); break; }
    case "before": { const b = byId(S.sel); newBook({ genre: b.genre || "", subgenres: prim(b) ? [prim(b)] : [], parent: validParent(b) ? b.parent : "", _before: b.id }); break; }
    case "bsearch": bookSearch(); break;
    case "genre-list": {
      const box = $("f-genre-list"); const open = box.hidden;
      box.innerHTML = genres().filter(g => g !== "미분류").map(g => `<button type="button" data-act="pick-genre" data-g="${esc(g)}" style="--gc:${gColor(g)}"><i></i>${esc(g)} <small>${S.books.filter(b => genreOf(b) === g).length}권</small></button>`).join("") || `<div class="none">아직 만든 장르가 없어요. 칸에 새 이름을 써 주세요.</div>`;
      box.hidden = !open; a.setAttribute("aria-expanded", open);
      break;
    }
    case "pick-genre": { const i = $("f-genre"); i.value = a.dataset.g; $("f-genre-list").hidden = true; i.dispatchEvent(new Event("change")); break; }
    case "pick": pickBook(+a.dataset.i); break;
    case "cover-clear": $("f-cover").value = ""; $("f-cvprev").hidden = true; break;
    case "m-bulk": openBulk(); break;
    case "m-rename": openRename(); break;
    case "add-kw": { const i = $("f-kw"); i.value = parseKw(i.value + "," + a.dataset.k).join(", "); $("f-kwsugs").innerHTML = kwSugsHtml(i.value); break; }
    case "reason-to-kw": { const rv = $("f-reason").value.trim(); if (!rv) { toast("이유 칸이 비어 있어요"); break; } const i = $("f-kw"); i.value = parseKw(i.value + "," + rv).join(", "); $("f-reason").value = ""; $("f-kwsugs").innerHTML = kwSugsHtml(i.value); toast("키워드로 옮겼어요. 저장을 눌러 주세요"); break; }
    case "kw-focus": setKw(a.dataset.k); break;
    case "kw-clear": setKw(""); break;
    case "rn-go": renameGo(a); break;
    case "bulk-start": bulkRun(); break;
    case "bulk-next": bulkNext(+a.dataset.i); break;
    case "bulk-all": document.querySelectorAll(".bk-row input[type=checkbox]:not(:disabled)").forEach(x => x.checked = a.dataset.v === "1"); bulkCount(); break;
    case "bulk-save": bulkSave(a); break;
    case "add-sub": { const i = $("f-sub"); const cur = parseSubs(i.value); cur.push(a.dataset.s); i.value = parseSubs(cur.join(",")).join(", "); $("f-sugs").innerHTML = subSugsHtml($("f-genre").value.trim() || "미분류", i.value); renderAlts(); break; }
    case "link": addLink(); break;
    case "unlink": unlink(id); break;
    case "goto": goTo(id); break;
    case "clear-ex": clearExamples(); break;
    case "modal-close": closeModal(); break;
    case "m-share": openShare(); break;
    case "m-image": openImage(); break;
    case "m-settings": openSettings(false); break;
    case "m-export": closeModal(); exportJson(); break;
    case "import": pickImport(); break;
    case "m-logout": await sb.auth.signOut(); location.href = "/"; break;
    case "s-save": saveSettings(!!a.dataset.first); break;
    case "copy-url": { const v = $("share-url").value; try { await navigator.clipboard.writeText(v); toast("링크를 복사했어요"); } catch (x) { $("share-url").select(); } break; }
    case "qr-save": $("qr").toBlob(b => b && saveBlob(b, `독서로그-QR-${S.profile.handle}.png`), "image/png"); break;
    case "crop-ratio": S.crop.ratio = a.dataset.k; document.querySelectorAll('[data-act="crop-ratio"]').forEach(x => x.setAttribute("aria-pressed", x.dataset.k === S.crop.ratio)); layoutCrop(false); break;
    case "crop-preset": applyPreset(a.dataset.p); break;
    case "crop-save": saveCrop(); break;
    case "ib-sync": syncNow(a); break;
    case "ib-skip": { try { await S.store.updateInbox(id, { status: "dismissed" }); S.inbox = S.inbox.filter(i => i.id !== id); renderHeader(); openInbox(); } catch (x) { fail(x); } break; }
    case "ib-new": { const it = inboxItem(id); if (!it) break; closeModal(); newBook({ title: guessTitle(it.title), review_url: it.url, read: it.published_at ? it.published_at.slice(0, 7) : "", _inbox: it.id }); break; }
    case "ib-attach": {
      const box = a.closest(".inbox-item").querySelector(".ib-attach"); box.hidden = false;
      const guess = guessTitle(inboxItem(id).title);
      const opts = S.books.slice().sort((x, y) => (x.title === guess ? -1 : y.title === guess ? 1 : x.title.localeCompare(y.title, "ko")));
      box.innerHTML = `<div class="urlbox"><select id="ib-sel-${esc(id)}" class="btn" style="flex:1;min-width:0">${opts.map(b => `<option value="${esc(b.id)}">${esc(b.title)}</option>`).join("")}</select><button class="btn primary" data-act="ib-attach-go" data-id="${esc(id)}">붙이기</button></div>`;
      break;
    }
    case "ib-attach-go": {
      const it = inboxItem(id), bid = $("ib-sel-" + id).value; if (!it || !bid) break;
      try { await S.store.updateBook(bid, { review_url: it.url }); byId(bid).review_url = it.url; await S.store.updateInbox(id, { status: "added", book_id: bid }); S.inbox = S.inbox.filter(i => i.id !== id); render(); openInbox(); toast("리뷰 링크를 붙였어요"); } catch (x) { fail(x); }
      break;
    }
    case "login": {
      a.disabled = true;
      const { error } = await sb.auth.signInWithOAuth({ provider: a.dataset.p, options: { redirectTo: location.origin + "/" } });
      if (error) { a.disabled = false; toast("로그인을 시작하지 못했어요. 설정을 확인해 주세요."); console.error(error); }
      break;
    }
  }
});
$("addBtn").addEventListener("click", () => newBook());
$("menuBtn").addEventListener("click", openMenu);
$("viewSel").addEventListener("change", e => setView(e.target.value));
$("inboxBtn").addEventListener("click", openInbox);
$("q").addEventListener("input", runSearch);
$("q").addEventListener("focus", runSearch);
$("q").addEventListener("keydown", e => {
  const items = [...$("results").querySelectorAll("[data-hit],[data-kwf]")];
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!items.length) return; searchIdx = (searchIdx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; items.forEach((x, i) => x.classList.toggle("on", i === searchIdx)); }
  else if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); const it = items[searchIdx]; if (it) it.dataset.kwf !== undefined ? setKw(it.dataset.kwf) : pickHit(it.dataset.hit); }
  else if (e.key === "Escape") { $("results").hidden = true; $("q").blur(); }
});
$("period").addEventListener("change", e => { S.period = e.target.value; render(); });
const ZMIN = 0.3, ZMAX = 2;
function saveZoom() { try { localStorage.setItem(isPhone() ? "rlog.zoom.phone" : "rlog.zoom", S.zoom); } catch (x) {} }
function setZoom(z) { S.zoom = Math.min(ZMAX, Math.max(ZMIN, Math.round(z * 10) / 10)); saveZoom(); renderMap(); }
// zoom around a point on screen (fx, fy relative to the viewport) without rebuilding the map
function zoomAt(z, fx, fy, from) {
  const L = S.L; if (!L || L.orient === "v") return;
  const v = $("viewport"), z0 = from || S.zoom; z = Math.min(ZMAX, Math.max(ZMIN, z));
  const cx = (v.scrollLeft + fx) / z0, cy = (v.scrollTop + fy) / z0;
  S.zoom = z;
  $("canvas").style.transform = `scale(${z})`; $("stage").style.width = L.w * z + "px"; $("stage").style.height = L.h * z + "px";
  v.scrollLeft = cx * z - fx; v.scrollTop = cy * z - fy;
}
(function pinch() {
  const v = $("viewport"); let st = null;
  const mid = t => { const r = v.getBoundingClientRect(); return { x: (t[0].clientX + t[1].clientX) / 2 - r.left, y: (t[0].clientY + t[1].clientY) / 2 - r.top, d: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) }; };
  v.addEventListener("touchstart", e => { if (e.touches.length === 2 && S.L && S.L.orient === "h") { const m = mid(e.touches); st = { d: m.d, z: S.zoom, x: m.x, y: m.y }; } }, { passive: true });
  v.addEventListener("touchmove", e => {
    if (!st || e.touches.length !== 2) return; e.preventDefault();
    const m = mid(e.touches); const z0 = S.zoom; zoomAt(st.z * m.d / st.d, m.x, m.y, z0);
    v.scrollLeft -= m.x - st.x; v.scrollTop -= m.y - st.y; st.x = m.x; st.y = m.y;
  }, { passive: false });
  const end = e => { if (st && e.touches.length < 2) { st = null; saveZoom(); } };
  v.addEventListener("touchend", end); v.addEventListener("touchcancel", end);
  ["gesturestart", "gesturechange"].forEach(t => v.addEventListener(t, e => e.preventDefault(), { passive: false }));
  // trackpad pinch / ctrl + wheel on computers
  v.addEventListener("wheel", e => { if (!e.ctrlKey || !S.L || S.L.orient !== "h") return; e.preventDefault(); const r = v.getBoundingClientRect(); zoomAt(S.zoom * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top); clearTimeout(pinch._t); pinch._t = setTimeout(saveZoom, 300); }, { passive: false });
})();
$("zoomIn").addEventListener("click", () => setZoom(S.zoom + .1));
$("zoomOut").addEventListener("click", () => setZoom(S.zoom - .1));
try { new ResizeObserver(() => document.documentElement.style.setProperty("--bar-h", $("bar").offsetHeight + "px")).observe($("bar")); } catch (e) {}
// while the book panel is open, shrink the map area so no card hides behind the panel
(function panelSpace() {
  const P = $("panel");
  const sync = () => { document.body.classList.toggle("panel-open", !P.hidden); document.documentElement.style.setProperty("--panel-h", P.hidden ? "0px" : P.offsetHeight + "px"); };
  try { new MutationObserver(sync).observe(P, { attributes: true, attributeFilter: ["hidden"] }); new ResizeObserver(sync).observe(P); } catch (e) {}
  sync();
})();
let lastPhone = isPhone(), rsT;
window.addEventListener("resize", () => {
  clearTimeout(rsT); rsT = setTimeout(() => {
    if ($("bar").hidden) return;
    const p = isPhone();
    if (p !== lastPhone) { lastPhone = p; try { const zz = parseFloat(localStorage.getItem(p ? "rlog.zoom.phone" : "rlog.zoom")); S.zoom = zz > 0 ? zz : (p ? 0.8 : 1); } catch (e) {} if (p && S.sel && byId(S.sel)) S.genre = genreOf(byId(S.sel)); render(); }
    else if (p && S.genre) renderMap();
    if (S.crop && S.crop.L && !$("modal").hidden) layoutCrop(true);
  }, 150);
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { if (!$("modal").hidden) closeModal(); else if (!$("panel").hidden) closePanel(); }
  if (e.key === "Enter" && !e.isComposing && e.target.matches("#panel input")) { e.preventDefault(); if (e.target.id === "l-note") addLink(); else if (e.target.id === "f-q") bookSearch(); else save(); }
  if (e.key === "/" && !e.target.matches("input,select,textarea") && !$("bar").hidden) { e.preventDefault(); $("q").focus(); }
});
document.addEventListener("visibilitychange", async () => {
  if (document.hidden || S.mode !== "own" || S.draft || !$("modal").hidden) return;
  try { await loadData(); render(); if (S.sel && byId(S.sel)) { if ($("p-links")) renderLinks(); } else if (S.sel) closePanel(); } catch (e) {}
});

/* ================= screens & boot ================= */
function showGate(html) { const g = $("gate"); g.innerHTML = html; g.hidden = false; }
function showApp() { $("gate").hidden = true; ["bar", "viewport"].forEach(id => $(id).hidden = false); render(); }
const PROVIDER_LABEL = { google: "Google로 시작하기", kakao: "카카오로 시작하기", github: "GitHub로 시작하기", apple: "Apple로 시작하기" };
const BOOK_ICON = `<svg viewBox="0 0 46 42" aria-hidden="true"><rect x="3" y="6" width="10" height="32" rx="2" style="fill:var(--g0)"/><rect x="5.5" y="11" width="5" height="1.6" rx=".8" style="fill:var(--bg)"/><rect x="15" y="10" width="9" height="28" rx="2" style="fill:var(--g1)"/><rect x="17" y="15" width="5" height="1.6" rx=".8" style="fill:var(--bg)"/><g transform="rotate(14 33 38)"><rect x="27" y="7" width="9" height="31" rx="2" style="fill:var(--accent)"/><rect x="29" y="12" width="5" height="1.6" rx=".8" style="fill:var(--bg)"/></g><rect x="1" y="38" width="43" height="2.4" rx="1.2" style="fill:var(--ink)"/></svg>`;
function landing() {
  S._landing = true;
  showGate(`<div class="landing">
    <h1 class="mark">${esc(APP_NAME)}${BOOK_ICON}</h1>
    <p class="lede">한 권을 읽고 나면 다음 책이 따라옵니다. 어떤 책이 어떤 책으로 이어졌는지, 장르와 소장르의 갈래로 남겨 보세요.</p>
    <div class="sample" aria-hidden="true">
      <svg viewBox="0 0 400 150">
        <g fill="none" stroke-width="2" style="stroke:var(--g0)" opacity=".7"><path d="M72 75 C96 75 96 38 116 38"/><path d="M72 75 C96 75 96 112 116 112"/><path d="M178 38 C196 38 196 38 206 38"/><path d="M178 112 C196 112 196 112 206 112"/><path d="M300 38 C315 38 315 38 322 38"/><path d="M300 112 C312 112 312 112 322 112"/></g>
        <rect x="6" y="61" width="66" height="28" rx="14" style="fill:var(--g0)"/><text x="39" y="79" text-anchor="middle" font-size="12" font-weight="600" style="fill:var(--surface)" font-family="IBM Plex Sans KR, sans-serif">심리</text>
        <rect x="116" y="27" width="62" height="22" rx="6" style="fill:var(--surface);stroke:var(--g0)" stroke-width="1.4"/><text x="147" y="42" text-anchor="middle" font-size="11" font-weight="600" style="fill:var(--g0)" font-family="IBM Plex Sans KR, sans-serif">중독</text>
        <rect x="116" y="101" width="62" height="22" rx="6" style="fill:var(--surface);stroke:var(--g0)" stroke-width="1.4"/><text x="147" y="116" text-anchor="middle" font-size="11" font-weight="600" style="fill:var(--g0)" font-family="IBM Plex Sans KR, sans-serif">뇌과학</text>
        <g font-family="Gowun Batang, serif" font-size="12" font-weight="700">
          <rect x="206" y="22" width="94" height="32" rx="7" style="fill:var(--surface);stroke:var(--line)"/><rect x="206" y="28" width="3" height="20" style="fill:var(--g0)"/><text x="216" y="42" style="fill:var(--ink)">첫 번째 책</text>
          <rect x="322" y="22" width="72" height="32" rx="7" style="fill:var(--surface);stroke:var(--line)"/><rect x="322" y="28" width="3" height="20" style="fill:var(--g0)"/><text x="331" y="42" style="fill:var(--ink)">다음 책</text>
          <rect x="206" y="96" width="94" height="32" rx="7" style="fill:var(--surface2);stroke:var(--g0)" stroke-dasharray="4 3"/><text x="216" y="116" font-weight="400" style="fill:var(--ink2)">첫 번째 책 ↗</text>
          <rect x="322" y="96" width="72" height="32" rx="7" style="fill:var(--surface);stroke:var(--line)"/><rect x="322" y="102" width="3" height="20" style="fill:var(--g0)"/><text x="331" y="116" style="fill:var(--ink)">갈라진 책</text>
        </g>
      </svg>
    </div>
    <ul class="feats">
      <li><svg viewBox="0 0 24 24"><path d="M5 6h4v12H5zM12 6h3v12h-3zM18 7l2 .5-2.5 11-2-.5z"/></svg><span>책마다 어디서 이어졌는지, 이유를 한 줄로 남겨요.</span></li>
      <li><svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.3 11l7.4-4M8.3 13l7.4 4"/></svg><span>장르와 소장르 갈래로 독서 흐름이 한눈에 보여요.</span></li>
      <li><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 15l4.5-4 4 3.5 3-2.5L20 15"/></svg><span>공개 링크·QR·이미지로 지인과 SNS에 나눠요.</span></li>
    </ul>
    <div style="display:grid;gap:8px">${PROVIDERS.map(p => `<button class="btn provider ${p === "google" ? "primary" : esc(p)}" data-act="login" data-p="${esc(p)}">${esc(PROVIDER_LABEL[p] || p)}</button>`).join("")}</div>
    <p class="fine">처음 로그인하면 닉네임과 공개 주소를 정해요.<br>공개를 켜기 전까지 기록은 나만 볼 수 있어요.</p>
  </div>`);
}
function fatal(title, msg) { showGate(`<div class="card"><h2>${esc(title)}</h2><p>${esc(msg)}</p><div><a class="btn" href="/">처음 화면으로</a></div></div>`); }

async function loadData() {
  if (S.mode === "public") { S.books = await Supa.books(S.profile.id); S.links = await Supa.links(S.profile.id); return; }
  const owner = S.user ? S.user.id : null;
  S.books = await S.store.books(owner); S.links = await S.store.links(owner);
  if (S.genre && !genres().includes(S.genre)) S.genre = null;
  if (S.mode === "own") { try { S.inbox = await Supa.inbox(); } catch (e) { S.inbox = []; } }
}

async function boot() {
  const m = location.pathname.match(/^\/u\/([^/]+)\/?$/);
  try {
    if (m) {
      S.mode = "public"; S.canWrite = false;
      if (!CONFIGURED) return fatal("아직 준비 중이에요", "이 독서로그는 아직 서버에 연결되지 않았어요.");
      S.profile = await Supa.profileByHandle(decodeURIComponent(m[1]).toLowerCase());
      if (!S.profile) return fatal("독서로그를 찾을 수 없어요", "주소가 맞는지, 주인이 공개를 꺼 두지 않았는지 확인해 주세요.");
      await loadData(); showApp(); return;
    }
    if (!CONFIGURED) { S.mode = "demo"; S.store = Local; S.profile = await Local.profileOf(); await loadData(); showApp(); return; }
    S.mode = "own"; S.store = Supa;
    const s = await Supa.session();
    if (!s) { landing(); return; }
    S.user = s.user;
    S.profile = await Supa.profileOf(S.user.id);
    if (!S.profile || !S.profile.handle) {
      const name = (S.user.user_metadata && (S.user.user_metadata.full_name || S.user.user_metadata.name)) || "";
      S.profile = Object.assign({ nickname: name.split(" ")[0] || "", handle: "", since: "" }, S.profile || {});
      showGate(""); openSettings(true); return;
    }
    await loadData(); showApp();
  } catch (e) {
    console.error(e);
    fatal("불러오지 못했어요", "인터넷 연결을 확인하고 새로고침해 주세요. 계속되면 config.js의 Supabase 주소와 키를 확인해 주세요.");
  }
}
if (sb) sb.auth.onAuthStateChange(ev => { if (ev === "SIGNED_IN" && S._landing) { S._landing = false; boot(); } });
boot();
})();
