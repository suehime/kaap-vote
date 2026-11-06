// 블로그·글 피드(RSS/Atom)에서 새 독서 리뷰를 찾아 '리뷰 알림'에 넣는 서버 기능
// - Vercel이 매일 한 번 자동 실행 (vercel.json의 crons)
// - 앱의 '지금 새 글 확인' 버튼으로 본인 피드만 즉시 확인
// 필요한 환경 변수 (Vercel → Settings → Environment Variables):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
import { SB, KEY, rest, touchHeartbeat } from "./_supabase.js";

const unwrap = s => String(s || "").replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim();
const decode = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i")); return m ? decode(unwrap(m[1])) : ""; };
const attr = (xml, name, a) => { const m = xml.match(new RegExp(`<${name}\\s[^>]*${a}=["']([^"']+)["'][^>]*>`, "i")); return m ? decode(m[1]) : ""; };
const iso = s => { const t = Date.parse(s); return isNaN(t) ? null : new Date(t).toISOString(); };
const cleanLink = u => { try { const x = new URL(u); ["fromRss", "trackingCode", "utm_source", "utm_medium", "utm_campaign"].forEach(k => x.searchParams.delete(k)); return x.toString().replace(/\?$/, ""); } catch { return u; } };

// RSS(<item>)와 Atom(<entry>) 모두 읽습니다.
export function parseFeed(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)) {
    const it = m[1];
    const link = cleanLink(tag(it, "link") || tag(it, "guid"));
    const title = tag(it, "title");
    if (!link || !title) continue;
    items.push({ url: link, title: title.slice(0, 300), category: tag(it, "category").slice(0, 100), published_at: iso(tag(it, "pubDate") || tag(it, "dc:date")) });
  }
  if (items.length) return items;
  for (const m of xml.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/gi)) {
    const it = m[1];
    const alt = it.match(/<link\s[^>]*rel=["']alternate["'][^>]*>/i);
    const link = cleanLink(alt ? (alt[0].match(/href=["']([^"']+)["']/i) || [])[1] || "" : attr(it, "link", "href"));
    const title = tag(it, "title");
    if (!link || !title) continue;
    items.push({ url: decode(link), title: title.slice(0, 300), category: (attr(it, "category", "term") || tag(it, "category")).slice(0, 100), published_at: iso(tag(it, "published") || tag(it, "updated")) });
  }
  return items;
}

// 피드 주소가 안전한 공개 https 주소인지 확인
export function feedOf(p) {
  let f = (p.feed_url || "").trim();
  if (!f && /^[A-Za-z0-9_-]{3,40}$/.test(p.blog_id || "")) f = `https://rss.blog.naver.com/${p.blog_id}.xml`;
  if (!f) return null;
  try {
    const u = new URL(f);
    if (u.protocol !== "https:") return null;
    const h = u.hostname;
    if (h === "localhost" || /^[\d.]+$/.test(h) || h.includes(":") || h.endsWith(".local") || h.endsWith(".internal")) return null;
    return u.toString();
  } catch { return null; }
}

async function syncProfile(p) {
  const feed = feedOf(p);
  if (!feed) return 0;
  const r = await fetch(feed, { headers: { "User-Agent": "Mozilla/5.0 (reading-log)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" }, redirect: "follow" });
  if (!r.ok) throw new Error(`feed ${r.status}`);
  const text = (await r.text()).slice(0, 3_000_000);
  let items = parseFeed(text);
  const cat = (p.blog_category || "").trim();
  if (cat) items = items.filter(i => i.category.replace(/\s/g, "") === cat.replace(/\s/g, ""));
  if (!items.length) return 0;
  const rows = items.slice(0, 100).map(i => ({ ...i, user_id: p.id }));
  const res = await rest("review_inbox?on_conflict=user_id,url", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(rows)
  });
  if (!res.ok) throw new Error(`insert ${res.status} ${await res.text()}`);
  return (await res.json()).length;
}

export default async function handler(req, res) {
  // 무엇보다 먼저 생존 신호를 남깁니다. 아래 설정이 잘못되어 있어도 일시 정지는 막힙니다.
  try { await touchHeartbeat(); } catch (e) { /* keepalive.js가 따로 한 번 더 시도합니다 */ }
  try {
    if (!SB || !KEY) return res.status(500).json({ error: "server not configured" });
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    let profiles;
    const cols = "id,feed_url,blog_id,blog_category";

    if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) {
      const r = await rest(`profiles?select=${cols}&or=(feed_url.neq.,blog_id.neq.)`);
      profiles = await r.json();
    } else if (token) {
      const u = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: KEY, Authorization: `Bearer ${token}` } });
      if (!u.ok) return res.status(401).json({ error: "login required" });
      const user = await u.json();
      const r = await rest(`profiles?select=${cols}&id=eq.${encodeURIComponent(user.id)}`);
      profiles = await r.json();
    } else {
      return res.status(401).json({ error: "login required" });
    }

    let added = 0; const errors = [];
    for (const p of Array.isArray(profiles) ? profiles : []) {
      try { added += await syncProfile(p); } catch (e) { errors.push(String(e.message || e)); }
    }
    if (errors.length && profiles.length === 1) return res.status(502).json({ error: "feed fetch failed", added });
    return res.status(200).json({ checked: (profiles || []).length, added, failed: errors.length });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
