export function toJsonString(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return "";
    }

    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      return JSON.stringify(trimmed);
    }
  }

  return JSON.stringify(value ?? null);
}

export function toNullableJsonInput(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  return toJsonString(value);
}

export function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value == null) {
    return fallback;
  }

  if (typeof value !== "string") {
    return value as T;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return fallback;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return fallback;
  }
}

export function parseJsonArray<T = unknown>(value: unknown): T[] {
  const parsed = parseJsonField<unknown>(value, []);

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed as T[];
}
