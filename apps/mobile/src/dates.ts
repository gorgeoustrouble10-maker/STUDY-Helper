export const TIME_ZONE = "Asia/Shanghai"; // 中国北京时间，UTC+8。
const offset = 8 * 60 * 60 * 1000;

/** Wire instants are UTC; an editable date is always a Shanghai wall-clock value. */
export function dateInput(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  const text = String(value);
  // Keep partial input intact while typing instead of parsing/reformatting it.
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) return text;
  const time = new Date(text).getTime();
  if (!Number.isFinite(time)) return text;
  const local = new Date(time + offset).toISOString();
  const day = local.slice(0, 10);
  const clock = local.slice(11, 19);
  if (clock === "00:00:00") return day;
  return `${day} ${clock.endsWith(":00") ? clock.slice(0, 5) : clock}`;
}

/** Parse only on save. Blank clears a field; impossible dates must not roll over. */
export function dateToISO(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("日期格式不正确");
  const text = value.trim();
  if (!text) return null;
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?$/i.exec(
      text,
    );
  if (!parts) throw new Error("请使用 YYYY-MM-DD 或 YYYY-MM-DD HH:mm 格式");
  const [
    ,
    year,
    month,
    day,
    hour = "00",
    minute = "00",
    second = "00",
    fraction = "",
    zone,
  ] = parts;
  const y = Number(year),
    m = Number(month),
    d = Number(day);
  if (
    y < 1 ||
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > new Date(Date.UTC(y, m, 0)).getUTCDate() ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    (zone &&
      zone.toUpperCase() !== "Z" &&
      (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))
  ) {
    throw new Error("日期或时间不存在，请检查年月日与时分");
  }
  const result = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}${fraction ? `.${fraction}` : ""}${zone || "+08:00"}`,
  );
  if (!Number.isFinite(result.getTime())) throw new Error("日期格式不正确");
  return result.toISOString();
}
