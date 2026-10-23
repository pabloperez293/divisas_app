/* Único punto de acceso al backend. No guardar contraseñas ni secretos aquí. */
const endpoint = "/.netlify/functions/operaciones";
let sessionToken = sessionStorage.getItem("divisas_session") || "";
export function hasSession() {
  return !!sessionToken;
}
export function logout() {
  sessionToken = "";
  sessionStorage.removeItem("divisas_session");
}
export async function request(action, data = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    body: JSON.stringify({ action, ...data }),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Respuesta inesperada del servidor");
  }
  if (!response.ok || !result.ok) {
    if (response.status === 401 && action !== "login") logout();
    throw new Error(result.error || "Error de conexión");
  }
  if (action === "login") {
    sessionToken = result.token;
    sessionStorage.setItem("divisas_session", sessionToken);
  }
  return result.data;
}
