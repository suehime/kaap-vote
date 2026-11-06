// 서버 기능들이 함께 쓰는 Supabase 연결 도구 (파일 이름이 _로 시작하면 주소로 열리지 않습니다)
export const SB = process.env.SUPABASE_URL || "";
export const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const rest = (path, init = {}) => fetch(`${SB}/rest/v1/${path}`, {
  ...init,
  headers: {
    apikey: KEY,
    ...(KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${KEY}` }),
    "Content-Type": "application/json",
    ...(init.headers || {})
  }
});

// 데이터베이스에 '살아 있음' 기록을 한 줄 남깁니다.
export async function touchHeartbeat() {
  if (!SB || !KEY) throw new Error("server not configured");
  const r = await rest("rpc/touch_heartbeat", { method: "POST", body: "{}" });
  if (!r.ok) throw new Error(`heartbeat ${r.status} ${await r.text()}`);
  return r.json();
}
