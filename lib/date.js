export function londonNow() {
  return new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Europe/London",
    })
  );
}

export function todayStr() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const get = (type) => parts.find((p) => p.type === type).value;

  return `${get("year")}-${get("month")}-${get("day")}`;
}