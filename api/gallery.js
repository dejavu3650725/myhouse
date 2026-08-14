/* ══════════════════════════════════════════════════════════════
   전시회 갤러리 (Vercel Blob 저장소)

   POST : 참가자의 기념 카드(PNG)를 서버에 저장
   GET  : 저장된 카드 목록을 최신순으로 반환

   Vercel 프로젝트에 Blob 저장소를 연결하면 BLOB_READ_WRITE_TOKEN 이
   자동으로 주입됩니다. 없으면 조용히 꺼진 상태로 동작합니다.
   ══════════════════════════════════════════════════════════════ */

const HAS_BLOB = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

// 업로드 폭주 방지 (10분에 300장)
const WINDOW_MS = 10 * 60 * 1000;
const MAX_UPLOADS = 300;
let uploads = [];

function tooMany() {
  const now = Date.now();
  uploads = uploads.filter((t) => now - t < WINDOW_MS);
  uploads.push(now);
  return uploads.length > MAX_UPLOADS;
}

function safeName(s) {
  return String(s || "익명")
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .trim()
    .slice(0, 24) || "익명";
}

export default async function handler(req, res) {
  // 갤러리 기능이 켜져 있는지 확인용
  if (req.method === "GET" && req.query && req.query.status === "1") {
    return res.status(200).json({ gallery: HAS_BLOB() });
  }

  if (!HAS_BLOB()) {
    return res.status(200).json({
      gallery: false,
      items: [],
      error:
        "갤러리가 아직 켜지지 않았습니다. Vercel 프로젝트에 Blob 저장소를 연결해 주세요.",
    });
  }

  let blob;
  try {
    blob = await import("@vercel/blob");
  } catch (e) {
    return res.status(500).json({ error: "저장소 모듈을 불러오지 못했습니다." });
  }

  /* ── 목록 보기 ───────────────────────────────────────── */
  if (req.method === "GET") {
    try {
      const { blobs } = await blob.list({ prefix: "cards/", limit: 1000 });
      const items = blobs
        .map((b) => ({
          url: b.url,
          name: decodeURIComponent(b.pathname.replace(/^cards\//, "")),
          at: b.uploadedAt,
        }))
        .sort((a, b) => new Date(b.at) - new Date(a.at));
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ gallery: true, count: items.length, items });
    } catch (e) {
      return res.status(500).json({ error: "목록을 불러오지 못했습니다." });
    }
  }

  /* ── 카드 저장 ───────────────────────────────────────── */
  if (req.method === "POST") {
    if (tooMany())
      return res
        .status(429)
        .json({ error: "잠시 후 다시 시도해 주세요. 업로드가 너무 많습니다." });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const dataUrl = String(body.image || "");
    if (!/^data:image\/png;base64,/.test(dataUrl))
      return res.status(400).json({ error: "이미지 형식이 올바르지 않습니다." });

    const b64 = dataUrl.split(",")[1] || "";
    if (b64.length > 8_000_000)
      return res.status(413).json({ error: "이미지가 너무 큽니다." });

    const buf = Buffer.from(b64, "base64");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const path = `cards/${stamp}__${safeName(body.team)}__${safeName(body.house)}.png`;

    try {
      const out = await blob.put(path, buf, {
        access: "public",
        contentType: "image/png",
        addRandomSuffix: true,
      });
      return res.status(200).json({ ok: true, url: out.url });
    } catch (e) {
      return res.status(500).json({ error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    }
  }

  return res.status(405).json({ error: "GET 또는 POST만 지원합니다." });
}
