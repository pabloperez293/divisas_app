/* Funciones puras: compras/ventas se separan por par y precio ponderado. */
export const fmt = (value, digits = 2) =>
  Number(value || 0).toLocaleString("es-AR", { maximumFractionDigits: digits });
export function summarize(rows, pair) {
  const selected = rows.filter((r) => `${r.currency}/${r.quote}` === pair);
  function side(type) {
    const subset = selected.filter((r) => r.type === type),
      amount = subset.reduce((s, r) => s + Number(r.amount), 0),
      cash = subset.reduce((s, r) => s + Number(r.amount) * Number(r.price), 0);
    return { amount, cash, average: amount ? cash / amount : 0 };
  }
  const buy = side("buy"),
    sell = side("sell");
  return {
    buy,
    sell,
    position: buy.amount - sell.amount,
    cashFlow: sell.cash - buy.cash,
  };
}
export function positions(rows) {
  const totals = {};
  for (const r of rows) {
    const amount = Number(r.amount),
      cash = amount * Number(r.price),
      sign = r.type === "buy" ? 1 : -1;
    totals[r.currency] = (totals[r.currency] || 0) + sign * amount;
    totals[r.quote] = (totals[r.quote] || 0) - sign * cash;
  }
  return Object.entries(totals).sort((a, b) => a[0].localeCompare(b[0]));
}
export function csvExport(rows) {
  const cells = [
    [
      "Fecha",
      "Tipo",
      "Persona",
      "Moneda",
      "Moneda pago",
      "Cantidad",
      "Precio",
      "Total",
      "ID",
    ],
    ...rows.map((r) => [
      r.createdAt,
      r.type === "buy" ? "Compra" : "Venta",
      r.person,
      r.currency,
      r.quote,
      r.amount,
      r.price,
      Number(r.amount) * Number(r.price),
      r.id,
    ]),
  ];
  const quote = (v) => '"' + String(v ?? "").replaceAll('"', '""') + '"';
  return "\ufeff" + cells.map((row) => row.map(quote).join(";")).join("\r\n");
}
