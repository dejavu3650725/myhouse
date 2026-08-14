/* ══════════════════════════════════════════════════════════════
   Gemini 프록시 (Vercel 서버리스 함수)

   브라우저는 이 주소(/api/gemini)로만 요청하고,
   실제 API 키는 Vercel 환경변수(GEMINI_API_KEY)에만 있습니다.
   따라서 전시회 참가자는 키를 입력할 필요가 없고,
   키가 외부에 노출되지도 않습니다.
   ══════════════════════════════════════════════════════════════ */

const UPSTREAM = "https://generativelanguage.googleapis.com/v1beta/interactions";
const LEGACY = (m) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

// 허용 모델 (다른 모델로 악용되는 것을 막습니다)
const ALLOWED = new Set([
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-2.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash-lite",
]);
const DEFAULT_MODEL = "gemini-3.5-flash";

// 아주 단순한 IP별 호출 제한 (10분에 40번)
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 40;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear(); // 메모리 보호
  return arr.length > MAX_HITS;
}

export default async function handler(req, res) {
  const KEY = process.env.GEMINI_API_KEY;

  // 상태 확인용 : 앱이 시작할 때 프록시가 준비됐는지 물어봅니다
  if (req.method === "GET") {
    return res.status(200).json({ proxy: Boolean(KEY) });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST 요청만 지원합니다." });
  }
  if (!KEY) {
    return res.status(500).json({
      error:
        "서버에 GEMINI_API_KEY 환경변수가 설정되어 있지 않습니다. Vercel 프로젝트 설정에서 추가해 주세요.",
    });
  }

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  if (rateLimited(ip)) {
    return res.status(429).json({
      error: "잠시 후 다시 시도해 주세요. 짧은 시간에 요청이 너무 많았습니다.",
    });
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  if (!Array.isArray(body.input) || body.input.length === 0) {
    return res.status(400).json({ error: "요청 형식이 올바르지 않습니다." });
  }
  const model = ALLOWED.has(body.model) ? body.model : DEFAULT_MODEL;

  const payload = { model, input: body.input };
  if (body.system_instruction) payload.system_instruction = body.system_instruction;

  try {
    // 1차 : Interactions API
    let r = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify(payload),
    });
    let text = await r.text();

    // 2차 : 구 generateContent 로 자동 대체
    if (!r.ok) {
      const legacyBody = {
        contents: [
          {
            role: "user",
            parts: body.input.map((p) =>
              p.type === "text"
                ? { text: p.text }
                : { inline_data: { mime_type: p.mime_type, data: p.data } }
            ),
          },
        ],
      };
      if (body.system_instruction) {
        legacyBody.system_instruction = { parts: [{ text: body.system_instruction }] };
      }
      const r2 = await fetch(LEGACY(model), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
        body: JSON.stringify(legacyBody),
      });
      const t2 = await r2.text();
      if (r2.ok) {
        r = r2;
        text = t2;
      }
    }

    if (!r.ok) {
      const j = safeParse(text);
      const msg = (j && j.error && j.error.message) || `AI 서버 오류 (${r.status})`;
      return res.status(r.status).json({ error: msg });
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(text);
  } catch (e) {
    return res
      .status(502)
      .json({ error: "AI 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." });
  }
}

function safeParse(t) {
  try {
    return JSON.parse(t);
  } catch (e) {
    return null;
  }
}
