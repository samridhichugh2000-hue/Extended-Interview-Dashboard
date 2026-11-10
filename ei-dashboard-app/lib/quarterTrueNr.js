// The ONE definition of target achievement across the dashboard (PA Algo quarter targets, the alert modal, PA/PIP
// progress, the quarterly Performance Summary email): the employee's True NR from Koenig's API for ALL THREE months
// of the quarter — nothing else, no formula of ours.
//   - months up to the current month: employees.true_nr_details (synced from the API)
//   - later months of the quarter:    employees.true_nr_future_details (the same API call, end date = quarter end;
//                                     Koenig returns its own True NR for months with revenue already booked)
// Pure (no DB, no network): safe for server and client.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function quarterMonthKeys(q) {
  const start = (Number(q.name.slice(1)) - 1) * 3;
  return [0, 1, 2].map((i) => `${MON[start + i]}-${q.year}`);
}

// -> { months: [{ month, trueNr|null, isFuture }], total, monthsAvailable }
// A month the API returned nothing for has trueNr null and adds nothing to the total.
export function quarterTrueNr(e, q) {
  const actual = new Map((e.trueNrDetails || []).filter((m) => m.trueNr != null).map((m) => [m.month, m.trueNr]));
  const future = new Map((e.trueNrFutureDetails || []).filter((m) => m.trueNr != null).map((m) => [m.month, m.trueNr]));
  const months = quarterMonthKeys(q).map((month) => {
    if (actual.has(month)) return { month, trueNr: actual.get(month), isFuture: false };
    if (future.has(month)) return { month, trueNr: future.get(month), isFuture: true };
    return { month, trueNr: null, isFuture: false };
  });
  const have = months.filter((m) => m.trueNr != null);
  return { months, total: have.reduce((s, m) => s + m.trueNr, 0), monthsAvailable: have.length };
}
