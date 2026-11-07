export const GAME_TIME_ZONE = 'Asia/Ho_Chi_Minh';
export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;
const VIETNAM_OFFSET_MS = 7 * 60 * MINUTE_MS;

export function timestamp(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= Date.UTC(9999, 11, 30)
    ? value : null;
}

export function today(epoch = Date.now()) {
  return new Date((timestamp(epoch) ?? Date.now()) + VIETNAM_OFFSET_MS).toISOString().slice(0, 10);
}

export function dateStart(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [year, month, day] = key.split('-').map(Number);
  if (year < 1970) return null;
  const result = Date.UTC(year, month - 1, day) - VIETNAM_OFFSET_MS;
  if (result < 0 || timestamp(result) === null || today(result) !== key) return null;
  return result;
}

export function offsetDay(key, offset) {
  const start = dateStart(key);
  if (start === null || !Number.isInteger(offset)) return null;
  const result = start + offset * DAY_MS;
  return timestamp(result) === null ? null : today(result);
}

export const nextDay = key => offsetDay(key, 1);
