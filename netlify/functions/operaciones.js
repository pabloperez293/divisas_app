/**
 * Control de Divisas - Netlify Function
 * Buenas prácticas:
 * - Mantener credenciales SOLO en variables de entorno de Netlify.
 * - No registrar contraseñas, tokens ni respuestas completas de Google.
 * - Validar entradas y devolver errores acotados y comprensibles.
 * - Mantener la API del frontend: login, list, create y rate.
 * - Usar Node.js 18+ (fetch nativo).
 */
const crypto = require("node:crypto");

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(payload),
  };
}

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
    if (typeof token !== "string") return false;
    const [payload, mac, extra] = token.split(".");
    if (!payload || !mac || extra) return false;
    const expected = sign(payload, secret);
    if (
      mac.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
    )
      return false;
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    return typeof parsed.exp === "number" && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithTimeout(url, options, milliseconds) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), milliseconds);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timeout);
  }
}

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
  ) {
    return json(503, {
      ok: false,
      error: "Falta configurar las variables seguras de Netlify",
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { ok: false, error: "JSON inválido" });
  }

  if (body.action === "login") {
    const received = String(body.password || "");
    const a = crypto.createHash("sha256").update(received).digest();
    const b = crypto.createHash("sha256").update(ADMIN_PASSWORD).digest();
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
    const base = String(body.base || "").toUpperCase();
    const quote = String(body.quote || "").toUpperCase();
    if (
      !/^[A-Z]{3}$/.test(base) ||
      !/^[A-Z]{3}$/.test(quote) ||
      base === quote
    ) {
      return json(400, { ok: false, error: "Par de monedas inválido" });
    }
    try {
      const response = await fetchWithTimeout(
        `https://api.frankfurter.dev/v2/rate/${encodeURIComponent(base)}/${encodeURIComponent(quote)}`,
        {},
        7000,
      );
      if (!response.ok) throw new Error("Cotización no disponible");
      const result = await response.json();
      if (!Number.isFinite(Number(result.rate)) || Number(result.rate) <= 0)
        throw new Error("Cotización inválida");
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

  let response;
  try {
    response = await fetchWithTimeout(
      APPS_SCRIPT_URL.trim(),
      {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          secret: APPS_SCRIPT_SECRET,
          action: body.action,
          operation: body.action === "create" ? body.operation : undefined,
        }),
      },
      20000,
    );
  } catch (error) {
    console.error(
      "Apps Script fetch failure:",
      error.name === "AbortError" ? "timeout" : error.message,
    );
    return json(502, {
      ok: false,
      error:
        "No se pudo conectar con Google Apps Script (red o tiempo de espera)",
    });
  }

  const contentType = response.headers.get("content-type") || "";
  const responseText = await response.text();
  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    // No imprimir HTML: podría incluir datos internos de Google.
    console.error("Apps Script unexpected response:", {
      status: response.status,
      contentType,
      finalHost: (() => {
        try {
          return new URL(response.url).hostname;
        } catch {
          return "unknown";
        }
      })(),
      bytes: responseText.length,
    });
    return json(502, {
      ok: false,
      error:
        "Apps Script devolvió una respuesta no válida. Verificá APPS_SCRIPT_URL, permisos e implementación activa.",
    });
  }

  if (!response.ok) {
    console.error("Apps Script HTTP error:", response.status);
    return json(502, {
      ok: false,
      error: `Apps Script respondió con HTTP ${response.status}`,
    });
  }
  if (!result || typeof result !== "object" || typeof result.ok !== "boolean") {
    return json(502, {
      ok: false,
      error: "Respuesta inesperada de Apps Script",
    });
  }
  if (!result.ok)
    return json(400, {
      ok: false,
      error: result.error || "Error del registro",
    });
  return json(200, { ok: true, data: result.data });
};
