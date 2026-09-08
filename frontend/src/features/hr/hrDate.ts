const MOSCOW_TIME_ZONE = "Europe/Moscow";

const moscowDateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: MOSCOW_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const moscowPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: MOSCOW_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function zonedParts(date: Date): DateTimeParts | null {
  const values = Object.fromEntries(
    moscowPartsFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Partial<DateTimeParts>;
  if (
    !values.year ||
    !values.month ||
    !values.day ||
    values.hour == null ||
    values.minute == null ||
    values.second == null
  ) {
    return null;
  }
  return values as DateTimeParts;
}

function partsAsUtc(parts: DateTimeParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

export function formatMoscowDateTime(value: string | null): string {
  if (!value) return "Не указано";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Не указано";
  return `${moscowDateTimeFormatter.format(date)} МСК`;
}

export function instantToMoscowInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = zonedParts(date);
  if (!parts) return "";
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function moscowInputToInstant(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const desired: DateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: 0,
  };
  let instant = partsAsUtc(desired);
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const rendered = zonedParts(new Date(instant));
    if (!rendered) return null;
    instant += partsAsUtc(desired) - partsAsUtc(rendered);
  }
  const verified = zonedParts(new Date(instant));
  if (!verified || partsAsUtc(verified) !== partsAsUtc(desired)) return null;
  return new Date(instant).toISOString();
}

export const MOSCOW_ZONE_LABEL = MOSCOW_TIME_ZONE;
