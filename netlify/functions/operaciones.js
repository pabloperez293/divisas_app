/* Backend privado. Node 18+ en Netlify. No colocar secretos en archivos públicos. */
const crypto = require("node:crypto");
const json = (status, body) => ({
  statusCode: status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  },
  body: JSON.stringify(body),
});
const sign = (value, secret) =>
  crypto.createHmac("sha256", secret).update(value).digest("base64url");
function createToken(secret) {
  const payload = Buffer.from(
    JSON.stringify({
      exp: Date.now() + 8 * 60 * 60 * 1000,
      nonce: crypto.randomBytes(12).toString("hex"),
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}
function validToken(token, secret) {
  try {
    const [payload, mac] = token.split(".");
    if (!payload || !mac) return false;
    const expected = sign(payload, secret);
    if (
      mac.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
    )
      return false;
    return (
      JSON.parse(Buffer.from(payload, "base64url").toString()).exp > Date.now()
    );
  } catch {
    return false;
  }
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.handler = async (event) => {
  if (event.httpMethod !== "POST")
    return json(405, { ok: false, error: "Método no permitido" });
  const {
    ADMIN_PASSWORD,
    SESSION_SECRET,
    APPS_SCRIPT_URL,
    APPS_SCRIPT_SECRET,
  } = process.env;
  if (
    !ADMIN_PASSWORD ||
    !SESSION_SECRET ||
    !APPS_SCRIPT_URL ||
    !APPS_SCRIPT_SECRET ||
    SESSION_SECRET.length < 32
  )
    return json(503, {
      ok: false,
      error: "Falta configurar las variables seguras de Netlify",
    });
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { ok: false, error: "JSON inválido" });
  }
  if (body.action === "login") {
    const received = String(body.password || "");
    const a = crypto.createHash("sha256").update(received).digest(),
      b = crypto.createHash("sha256").update(ADMIN_PASSWORD).digest();
    if (!crypto.timingSafeEqual(a, b)) {
      await wait(350);
      return json(401, { ok: false, error: "Contraseña incorrecta" });
    }
    return json(200, {
      ok: true,
      token: createToken(SESSION_SECRET),
      data: { authenticated: true },
    });
  }
  const token = (
    event.headers.authorization ||
    event.headers.Authorization ||
    ""
  ).replace(/^Bearer\s+/i, "");
  if (!validToken(token, SESSION_SECRET))
    return json(401, { ok: false, error: "Sesión vencida. Volvé a ingresar." });
  if (body.action === "rate") {
    const base = String(body.base || "").toUpperCase(),
      quote = String(body.quote || "").toUpperCase();
    if (!/^[A-Z]{3}$/.test(base) || !/^[A-Z]{3}$/.test(quote) || base === quote)
      return json(400, { ok: false, error: "Par de monedas inválido" });
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);
      let response;
      try {
        response = await fetch(
          `https://api.frankfurter.dev/v2/rate/${base}/${quote}`,
          { signal: controller.signal },
        );
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw Error("Sin cotización para este par");
      const result = await response.json();
      if (!Number.isFinite(Number(result.rate)) || Number(result.rate) <= 0)
        throw Error("Cotización inválida");
      return json(200, {
        ok: true,
        data: {
          rate: Number(result.rate),
          date: result.date,
          source: "Frankfurter (tipo medio de referencia)",
        },
      });
    } catch {
      return json(502, {
        ok: false,
        error: "La API no tiene una cotización disponible para ese par",
      });
    }
  }
  if (!["list", "create"].includes(body.action))
    return json(400, { ok: false, error: "Acción no permitida" });
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let response;
    try {
      response = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          secret: APPS_SCRIPT_SECRET,
          action: body.action,
          operation: body.action === "create" ? body.operation : undefined,
        }),
        signal: controller.signal,
        redirect: "follow",
      });
    } finally {
      clearTimeout(timeout);
    }
    const result = await response.json();
    if (!result.ok)
      return json(400, {
        ok: false,
        error: result.error || "Error del registro",
      });
    return json(200, { ok: true, data: result.data });
  } catch {
    return json(502, {
      ok: false,
      error: "No se pudo conectar con Google Apps Script",
    });
  }
};
