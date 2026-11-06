// 책 표지 이미지를 같은 주소(내 독서로그)에서 보여 주기 위한 중계
// - 표지가 들어간 이미지를 JPG로 저장할 때 브라우저가 막지 않도록 합니다.
// - 카카오(다음) 이미지 서버의 그림만 중계합니다.
const ALLOWED = [/\.kakaocdn\.net$/i, /\.daumcdn\.net$/i];

export default async function handler(req, res) {
  let url;
  try { url = new URL(String(req.query.u || "")); } catch { return res.status(400).end(); }
  if (url.protocol !== "https:" || !ALLOWED.some(r => r.test(url.hostname))) return res.status(400).end();
  try {
    const r = await fetch(url.toString(), { headers: { "User-Agent": "Mozilla/5.0 (reading-log)" } });
    const type = r.headers.get("content-type") || "";
    if (!r.ok || !type.startsWith("image/")) return res.status(404).end();
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 2_000_000) return res.status(413).end();
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "public, max-age=2592000, s-maxage=2592000, immutable");
    return res.status(200).send(buf);
  } catch {
    return res.status(502).end();
  }
}
