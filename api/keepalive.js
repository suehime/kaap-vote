// Supabase 무료 프로젝트가 일주일 동안 쉬면 일시 정지되는 것을 막는 '생존 신호'
// - Vercel이 매일 한 번 자동 호출 (vercel.json)
// - 예비로 cron-job.org 같은 무료 서비스가 며칠마다 이 주소를 불러도 됩니다.
// 기록 한 줄만 남기고 다른 정보는 주고받지 않으므로 누구나 불러도 안전합니다.
import { touchHeartbeat } from "./_supabase.js";

export default async function handler(req, res) {
  try {
    const at = await touchHeartbeat();
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, at });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
