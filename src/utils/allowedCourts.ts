export type AllowedCourtOption = {
  id: number;
  groupId: number | null;
  title: string | null;
  subtitle: string | null;
  label: string;
};

function toInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string | null {
  const out = String(value ?? "").trim();
  return out || null;
}

export function normalizeAllowedCourts(value: unknown): AllowedCourtOption[] {
  let raw: unknown = value;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];

    try {
      raw = JSON.parse(trimmed);
    } catch {
      raw = trimmed
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item));
    }
  }

  const map = new Map<number, AllowedCourtOption>();

  const push = (item: AllowedCourtOption) => {
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
      return;
    }

    map.set(item.id, {
      ...existing,
      groupId: existing.groupId ?? item.groupId,
      title: existing.title ?? item.title,
      subtitle: existing.subtitle ?? item.subtitle,
      label: existing.label || item.label,
    });
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "number" || typeof item === "string") {
        const id = toInt(item);
        if (id == null) continue;

        push({
          id,
          groupId: null,
          title: null,
          subtitle: null,
          label: `Court ${id}`,
        });
        continue;
      }

      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        const subid = toInt(obj.subid);
        const groupId = toInt(obj.id);
        const id = subid ?? groupId;

        if (id == null) continue;

        const title = text(obj.title);
        const subtitle = text(obj.subtitle);

        push({
          id,
          groupId: groupId ?? null,
          title,
          subtitle,
          label: subtitle || title || `Court ${id}`,
        });
      }
    }
  }

  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function getAllowedCourtIds(value: unknown): number[] {
  return normalizeAllowedCourts(value).map((item) => item.id);
}

export function normalizeCourtIdList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];

  return [...new Set(
    value
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item))
  )];
}

export function restrictSelectedCourtIds(
  value: unknown,
  allowedCourtIds: number[]
): number[] {
  const allowed = new Set(allowedCourtIds);
  return normalizeCourtIdList(value).filter((id) => allowed.has(id));
}