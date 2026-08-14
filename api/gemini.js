/* ══════════════════════════════════════════════════════════════
   Gemini 프록시 (Vercel 서버리스 함수)

   · 실제 API 키는 Vercel 환경변수(GEMINI_API_KEY)에만 있습니다.
   · 모델이 붐비면(503 등) 자동으로 재시도하고, 그래도 안 되면
     예비 모델로 갈아타서 전시회 중에 멈추지 않도록 합니다.
   ══════════════════════════════════════════════════════════════ */

const UPSTREAM = "https://generativelanguage.googleapis.com/v1beta/interactions";
const LEGACY = (m) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

// 허용 모델 + 예비 모델 순서 (앞에서부터 시도)
const ALLOWED = new Set([
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-2.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash-lite",
]);
const DEFAULT_MODEL = "gemini-3.5-flash";
const FALLBACK_ORDER = [
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash-lite",
];

/* 호출 제한
   전시회에서는 참가자 폰이 모두 같은 와이파이(=같은 IP)로 묶이므로
   IP 제한을 넉넉히 두고, 대신 전체 총량으로 사용량을 보호합니다. */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_IP = 250;    // 한 IP가 10분에 250번 (부스 전체가 써도 충분)
const MAX_TOTAL = 900;     // 서버 전체가 10분에 900번 (폭주 방지)
const hits = new Map();
let globalHits = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safeParse = (t) => {
  try {
    return JSON.parse(t);
  } catch (e) {
    return null;
  }
};

function rateLimited(ip) {
  const now = Date.now();
  globalHits = globalHits.filter((t) => now - t < WINDOW_MS);
  globalHits.push(now);
  if (globalHits.length > MAX_TOTAL) return "total";

  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > MAX_PER_IP ? "ip" : false;
}

/** 잠깐 붐비는 것이라 다시 시도하면 될 오류인가? */
function isTransient(status, text) {
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504)
    return true;
  const t = (text || "").toLowerCase();
  return (
    t.includes("high demand") ||
    t.includes("overloaded") ||
    t.includes("unavailable") ||
    t.includes("try again") ||
    t.includes("rate limit") ||
    t.includes("resource_exhausted")
  );
}

async function askUpstream(model, input, systemText, KEY) {
  const payload = { model, input };
  if (systemText) payload.system_instruction = systemText;

  let r = await fetch(UPSTREAM, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
    body: JSON.stringify(payload),
  });
  let text = await r.text();
  if (r.ok) return { ok: true, status: 200, text };

  // 구 generateContent 로 한 번 더 (모델이 신 API에 없을 때 대비)
  if (!isTransient(r.status, text)) {
    const legacyBody = {
      contents: [
        {
          role: "user",
          parts: input.map((p) =>
            p.type === "text"
              ? { text: p.text }
              : { inline_data: { mime_type: p.mime_type, data: p.data } }
          ),
        },
      ],
    };
    if (systemText) legacyBody.system_instruction = { parts: [{ text: systemText }] };
    const r2 = await fetch(LEGACY(model), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify(legacyBody),
    });
    const t2 = await r2.text();
    if (r2.ok) return { ok: true, status: 200, text: t2 };
  }
  return { ok: false, status: r.status, text };
}

export default async function handler(req, res) {
  const KEY = process.env.GEMINI_API_KEY;

  if (req.method === "GET") return res.status(200).json({ proxy: Boolean(KEY) });
  if (req.method !== "POST")
    return res.status(405).json({ error: "POST 요청만 지원합니다." });
  if (!KEY)
    return res.status(500).json({
      error:
        "서버에 GEMINI_API_KEY 환경변수가 없습니다. Vercel 프로젝트 설정에서 추가한 뒤 Redeploy 해 주세요.",
    });

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  const limited = rateLimited(ip);
  if (limited)
    return res.status(429).json({
      error:
        limited === "total"
          ? "지금 이용하는 사람이 아주 많아요. 1~2분 뒤에 다시 눌러 주세요."
          : "잠시 후 다시 시도해 주세요. 짧은 시간에 요청이 너무 많았습니다.",
    });

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  if (!Array.isArray(body.input) || body.input.length === 0)
    return res.status(400).json({ error: "요청 형식이 올바르지 않습니다." });

  const wanted = ALLOWED.has(body.model) ? body.model : DEFAULT_MODEL;
  const chain = [wanted, ...FALLBACK_ORDER.filter((m) => m !== wanted)];

  let last = null;
  try {
    for (let i = 0; i < chain.length; i++) {
      const model = chain[i];
      // 같은 모델로 최대 2번 (0.8초 쉬고 재시도)
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await askUpstream(model, body.input, body.system_instruction, KEY);
        if (r.ok) {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("X-Model-Used", model);
          return res.status(200).send(r.text);
        }
        last = r;
        if (!isTransient(r.status, r.text)) break; // 다음 모델로
        if (attempt === 0) await sleep(800);
      }
    }
  } catch (e) {
    return res
      .status(502)
      .json({ error: "AI 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." });
  }

  // 모든 모델 실패
  const j = safeParse(last && last.text);
  const raw = (j && j.error && j.error.message) || "";
  const friendly = isTransient(last && last.status, raw)
    ? "지금 AI가 많이 붐빕니다. 20초쯤 뒤에 버튼을 한 번 더 눌러 주세요."
    : raw || `AI 서버 오류 (${(last && last.status) || "?"})`;
  return res.status((last && last.status) || 502).json({ error: friendly });
}
