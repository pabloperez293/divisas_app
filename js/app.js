import { request, hasSession, logout } from "./api.js";
import { fmt, summarize, positions, csvExport } from "./calculations.js";
/* Toda la lógica de pantalla está aquí; no se mezclan cálculos con acceso a datos. */
const $ = (id) => document.getElementById(id);
let rows = [],
  currencies = ["ARS", "USD", "EUR", "BRL", "UYU", "GBP"];
function msg(text) {
  $("status").textContent = text;
}
function optionList(select, values, chosen) {
  select.replaceChildren(
    ...values.map((v) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      return o;
    }),
  );
  if (values.includes(chosen)) select.value = chosen;
}
function setupCurrencies() {
  for (const id of ["currency", "quote"])
    optionList(
      $(id),
      currencies,
      $(id).value || (id === "currency" ? "USD" : "ARS"),
    );
  if ($("currency").value === $("quote").value && currencies.includes("ARS"))
    $("quote").value = "ARS";
}
function metric(label, value) {
  const d = document.createElement("div");
  d.className = "metric";
  const s = document.createElement("small");
  s.textContent = label;
  const b = document.createElement("strong");
  b.textContent = value;
  d.append(s, b);
  return d;
}
function render() {
  const pairs = [
    ...new Set(rows.map((r) => `${r.currency}/${r.quote}`)),
  ].sort();
  optionList($("filter"), pairs, $("filter").value);
  const pair = $("filter").value;
  const summary = $("summary");
  summary.replaceChildren();
  if (pair) {
    const s = summarize(rows, pair);
    summary.append(
      metric("Comprado", `${fmt(s.buy.amount, 6)} ${pair.split("/")[0]}`),
      metric("Promedio compra", fmt(s.buy.average, 6)),
      metric("Vendido", `${fmt(s.sell.amount, 6)} ${pair.split("/")[0]}`),
      metric("Promedio venta", fmt(s.sell.average, 6)),
      metric("Posición neta del par", fmt(s.position, 6)),
      metric(
        "Flujo moneda de pago",
        `${fmt(s.cashFlow)} ${pair.split("/")[1]}`,
      ),
    );
  } else
    summary.append(metric("Sin movimientos", "Registrá tu primera operación"));
  const pos = $("positions");
  pos.replaceChildren();
  for (const [currency, balance] of positions(rows))
    pos.append(metric(currency, fmt(balance, 6)));
  if (!rows.length) pos.append(metric("Sin posiciones", "—"));
  const history = $("history");
  history.replaceChildren();
  for (const r of rows.slice(0, 100)) {
    const card = document.createElement("div");
    card.className = "movement";
    const left = document.createElement("div"),
      right = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${r.type === "buy" ? "Compra" : "Venta"} · ${fmt(r.amount, 6)} ${r.currency}`;
    const detail = document.createElement("div");
    detail.className = "text-xs text-slate-400";
    detail.textContent = `${r.person} · ${new Date(r.createdAt).toLocaleString("es-AR")}`;
    left.append(title, detail);
    right.textContent = `${fmt(r.price, 6)} ${r.quote}/unidad`;
    card.append(left, right);
    history.append(card);
  }
  if (rows.length > 100) {
    const p = document.createElement("p");
    p.className = "text-xs text-slate-400";
    p.textContent =
      "Se muestran los 100 movimientos más recientes. Exportá CSV para ver todos.";
    history.append(p);
  }
}
async function load() {
  msg("Cargando datos…");
  try {
    const data = await request("list");
    rows = data.rows || [];
    currencies = [
      ...new Set([
        ...currencies,
        ...(data.currencies || []),
        ...rows.flatMap((r) => [r.currency, r.quote]),
      ]),
    ].sort();
    setupCurrencies();
    render();
    msg("Datos sincronizados con Google Sheets.");
  } catch (e) {
    msg(e.message);
    if (!hasSession()) showLogin();
  }
}
function showLogin() {
  $("loginView").classList.remove("hidden");
  $("appView").classList.add("hidden");
  $("logout").classList.add("hidden");
}
function showApp() {
  $("loginView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  $("logout").classList.remove("hidden");
  load();
}
$("showPassword").addEventListener(
  "change",
  (e) => ($("password").type = e.target.checked ? "text" : "password"),
);
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginButton").disabled = true;
  $("loginMessage").textContent = "Verificando acceso…";
  try {
    await request("login", { password: $("password").value });
    $("password").value = "";
    $("loginMessage").textContent = "";
    showApp();
  } catch (err) {
    $("loginMessage").textContent = err.message;
  } finally {
    $("loginButton").disabled = false;
  }
});
$("logout").addEventListener("click", () => {
  logout();
  rows = [];
  showLogin();
});
$("addCurrency").addEventListener("click", () => {
  const c = $("newCurrency").value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) {
    msg("Ingresá un código de moneda de 3 letras.");
    return;
  }
  currencies = [...new Set([...currencies, c])].sort();
  setupCurrencies();
  $("currency").value = c;
  $("newCurrency").value = "";
  msg("Moneda agregada. Se guardará al registrar una operación.");
});
$("getRate").addEventListener("click", async () => {
  const base = $("currency").value,
    quote = $("quote").value;
  if (base === quote) {
    msg("Elegí dos monedas diferentes.");
    return;
  }
  $("getRate").disabled = true;
  $("rateInfo").textContent = "Consultando referencia…";
  try {
    const data = await request("rate", { base, quote });
    $("price").value = data.rate;
    $("rateInfo").textContent =
      `Referencia ${data.date || "sin fecha"} (${data.source}). Precio editable; no es una oferta de compra/venta.`;
    updateTotal();
  } catch (e) {
    $("rateInfo").textContent =
      `No disponible: ${e.message}. Ingresá el precio manualmente.`;
  } finally {
    $("getRate").disabled = false;
  }
});
function updateTotal() {
  const total = Number($("amount").value) * Number($("price").value);
  $("operationTotal").textContent =
    Number.isFinite(total) && total > 0
      ? `Total: ${fmt(total, 6)} ${$("quote").value}`
      : "";
}
for (const id of ["amount", "price", "currency", "quote"])
  $(id).addEventListener("input", updateTotal);
$("operationForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    type: $("type").value,
    person: $("person").value.trim(),
    currency: $("currency").value,
    quote: $("quote").value,
    amount: $("amount").value,
    price: $("price").value,
  };
  if (payload.currency === payload.quote) {
    msg("Las monedas deben ser distintas.");
    return;
  }
  $("saveButton").disabled = true;
  msg("Guardando…");
  try {
    await request("create", { operation: payload });
    $("person").value = "";
    $("amount").value = "";
    $("price").value = "";
    $("rateInfo").textContent =
      "Cotización orientativa; ingresá el precio o consultá una referencia.";
    updateTotal();
    await load();
    msg("Operación guardada correctamente.");
  } catch (err) {
    msg(err.message);
  } finally {
    $("saveButton").disabled = false;
  }
});
$("refresh").addEventListener("click", load);
$("export").addEventListener("click", () => {
  const blob = new Blob([csvExport(rows)], { type: "text/csv;charset=utf-8" }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `divisas-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});
setupCurrencies();
if (hasSession()) showApp();
else showLogin();
