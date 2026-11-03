# 디베이트 투표 — Supabase + Vercel

QR 접속 → 6점 척도 투표 → 실시간 결과 시각화. 서버 코드 없이 정적 파일만 올립니다. 전부 무료입니다.

**독서로그 만드실 때와 같은 흐름입니다.** Supabase에 테이블 만들고, GitHub에 올리고, Vercel에 연결. 다른 점은 로그인이 없다는 것뿐입니다 — 투표는 익명이어야 하니까요.

| 파일 | 용도 |
| --- | --- |
| `index.html` | 참가자 화면 — QR이 여기로 |
| `host.html` | 진행자 조작판 — 노트북 |
| `screen.html` | 프로젝터 화면 |
| `check.html` | 연결 진단 |
| `loadtest.html` | 200명 부하 테스트 |
| `schema.sql` | Supabase에 붙여넣을 SQL |
| `config.js` | **여기만 수정** |
| `style.css`, `app.js` | 손대지 않으셔도 됩니다 |

---

## 1단계 · Supabase 프로젝트

1. [supabase.com](https://supabase.com) → **New project**
2. 이름 아무거나, **Region은 Northeast Asia (Seoul)** 또는 Tokyo
3. 데이터베이스 비밀번호는 아무거나 (이 앱에서는 안 씁니다)
4. 프로젝트가 준비되면 왼쪽 **SQL Editor** → `schema.sql` 내용을 통째로 붙여넣고 **Run**

성공하면 **Table Editor**에 `votes`와 `state` 두 테이블이 보입니다. `state`에는 행이 하나 있어야 합니다.

## 2단계 · 키 복사

**Settings → API** 에서 두 개를 복사해 `config.js`에 넣으십시오.

```js
SUPABASE_URL: "https://xxxxx.supabase.co",   // Project URL
SUPABASE_KEY: "eyJhbGci...",                  // anon public  ← service_role 아님
PIN: "원하시는 비밀번호",
```

> **service_role 키는 절대 쓰지 마십시오.** 그 키는 RLS를 무시하므로 공개 페이지에 넣으면 데이터베이스 전체가 열립니다. 반드시 **anon public** 쪽입니다.

## 3단계 · GitHub → Vercel

```bash
git init
git add .
git commit -m "디베이트 투표 앱"
git branch -M main
git remote add origin https://github.com/<계정>/kaap-vote.git
git push -u origin main
```

Vercel에서 **Add New → Project → 그 저장소 선택 → Deploy**. 빌드 설정은 건드릴 필요 없습니다 (Framework Preset은 **Other**, 나머지 비워두면 됩니다).

주소 세 개가 생깁니다.

- 참가자 → `kaap-vote.vercel.app`
- 진행자 → `kaap-vote.vercel.app/host.html`
- 프로젝터 → `kaap-vote.vercel.app/screen.html`

Settings → Domains에서 짧은 이름으로 바꾸시면 QR 없이 손으로 치기도 편합니다.

## 4단계 · 확인

1. `/check.html` — 전부 "정상"이 떠야 합니다
2. `/loadtest.html` — 200명 동시 투표 테스트, "통과" 확인
3. 노트북에서 `/host.html`, 휴대폰에서 참가자 주소를 열고 한 바퀴
4. 끝나면 진행자 화면 맨 아래 **전체 투표 지우기**

---

## 당일 운영

**시작 전**
- 프로젝터에 `screen.html`을 전체화면(F11)으로
- 진행자 화면에서 **참여 안내 · QR**
- 참가자는 들어와서 직군을 한 번 고릅니다. 이후 다시 묻지 않습니다

**각 세션**

| 순서 | 진행자 화면에서 | 프로젝터에 보이는 것 |
| --- | --- | --- |
| 1 | 세션 n 선택 | — |
| 2 | **사전 투표 열기** (30초) | 명제 + 응답 수만. **결과는 숨겨집니다** |
| 3 | **투표 마감** | 〃 |
| 4 | 찬반 발표 10분 | 명제 그대로 두거나 발표자 슬라이드로 |
| 5 | **사후 투표 열기** (2분) | 명제 + 응답 수 |
| 6 | **투표 마감** | 〃 |
| 7 | **결과 · 사전 대 사후** | 여기서 처음 공개 |
| 8 | **결과 · 이동 흐름** | 누가 어디서 어디로 갔는지 |
| 9 | **결과 · 직군별** | 직군별 찬성 비율과 이동폭 |

7~9번이 결과 해설 5분입니다. 8번에서 대개 반응이 나옵니다.

세션 2는 사전 투표를 열기 직전에 상황 고정 문구를 읽어 주십시오. `config.js`의 `note`에 넣어두면 참가자 화면과 프로젝터에 함께 뜹니다.

---

## 알아두실 점

**익명입니다.** 기기마다 무작위 문자열 하나가 브라우저에 저장되고, 서버에는 그 문자열과 직군·선택지 번호만 올라갑니다. 이름·전화번호·IP를 수집하지 않습니다. 그 문자열 덕분에 사전과 사후를 연결할 수 있습니다.

**같은 사람이 다시 누르면 덮어씁니다.** `(세션, 사전/사후, 사람)` 조합에 유일 제약이 걸려 있어 중복으로 쌓이지 않습니다. 마감 전까지 표를 바꾸실 수 있습니다.

**시크릿 모드나 다른 브라우저로 다시 들어오면 새 사람으로 잡힙니다.** 시작할 때 "창을 닫지 마십시오"만 안내하시면 됩니다.

**이동 흐름은 양쪽에 다 응답한 사람만 셉니다.** 진행자 화면의 "양쪽 다 응답" 숫자로 확인하실 수 있습니다.

**진행자 주소를 화면에 띄우지 마십시오.** `config.js`는 누구나 열어볼 수 있어 PIN도 보입니다. 실제 방어선은 주소를 노출하지 않는 것입니다.

**끝난 뒤.** Table Editor에서 CSV로 내려받으시거나, `schema.sql` 맨 아래 조회 쿼리를 쓰시면 됩니다. 이동 행렬을 뽑는 SQL도 거기 적어뒀습니다. 그리고 '잠그기' 두 줄을 실행해 RLS 정책을 지워두십시오.
