// 책 검색: 제목으로 카카오 책 검색을 불러 표지·저자·출간년도를 돌려줍니다.
// 필요한 환경 변수 (Vercel → Settings → Environment Variables):
//   KAKAO_REST_API_KEY  (카카오 개발자 사이트 → 내 애플리케이션 → 앱 키 → REST API 키)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (로그인한 사람만 쓰도록 확인할 때 사용)
import { SB, KEY } from "./_supabase.js";

const coverPath = u => (u ? "/api/cover?u=" + encodeURIComponent(u.replace(/^http:/, "https:")) : "");

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const kakao = process.env.KAKAO_REST_API_KEY;
  if (!kakao) return res.status(501).json({ error: "search not configured" });

  // 로그인한 사람만 (다른 사람이 내 카카오 키를 쓰지 못하게)
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token || !SB || !KEY) return res.status(401).json({ error: "login required" });
  const u = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: KEY, Authorization: `Bearer ${token}` } });
  if (!u.ok) return res.status(401).json({ error: "login required" });

  const q = String(req.query.q || "").trim().slice(0, 80);
  if (!q) return res.status(200).json({ items: [] });
  try {
    const r = await fetch(`https://dapi.kakao.com/v3/search/book?target=title&size=12&query=${encodeURIComponent(q)}`, {
      headers: { Authorization: `KakaoAK ${kakao}` }
    });
    if (!r.ok) return res.status(502).json({ error: `kakao ${r.status}` });
    const j = await r.json();
    const items = (j.documents || []).map(d => ({
      title: d.title || "",
      author: (d.authors || []).join(", "),
      published: (d.datetime || "").slice(0, 4),
      publisher: d.publisher || "",
      cover: coverPath(d.thumbnail || "")
    }));
    return res.status(200).json({ items });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}
