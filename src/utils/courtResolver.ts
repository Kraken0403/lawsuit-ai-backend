import type { CaseGroup, ClassifiedQuery } from "../types/search.js";

export type CanonicalCourt = {
  code: string | null;
  level: "SC" | "HC" | "OTHER" | null;
  state: string | null;
  rawCourt: string;
};

type HighCourtPattern = {
  code: string;
  state: string;
  aliases: string[];
};

function compact(text: string | null | undefined): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

function normalizeLooseSimple(text: string | null | undefined): string {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function normalizeCourtText(text: string | null | undefined): string {
  return (text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function toCanonicalCourt(entry: CourtIdEntry, rawCourt: string): CanonicalCourt {
  return {
    code: entry.code,
    level: entry.level,
    state: entry.state,
    rawCourt,
  };
}

function parseCourtId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const text = String(value ?? "").trim();
  if (!text) return null;

  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function findCourtEntriesByText(input: string): CourtIdEntry[] {
  const wanted = normalizeCourtText(input);
  if (!wanted) return [];

  return Object.values(COURT_ID_MAP).filter((entry) =>
    entry.aliases.some((alias) => {
      const normalizedAlias = normalizeCourtText(alias);
      return (
        normalizedAlias === wanted ||
        normalizedAlias.includes(wanted) ||
        wanted.includes(normalizedAlias)
      );
    })
  );
}

function inferCourtFromCourtId(payload: Record<string, unknown>): CanonicalCourt | null {
  const rawCourt = compact(
    [String(payload.court ?? ""), String(payload.courtName ?? "")]
      .filter(Boolean)
      .join(" ")
  );

  const numericCourtId = parseCourtId(payload.courtId);
  if (!numericCourtId) return null;

  const entry = COURT_ID_MAP[numericCourtId];
  if (!entry) return null;

  return toCanonicalCourt(entry, rawCourt);
}

export function getCourtIdsForFilter(courtFilter: string): number[] {
  const directTextMatches = findCourtEntriesByText(courtFilter);
  if (directTextMatches.length) {
    return unique(directTextMatches.map((entry) => entry.id));
  }

  const resolved = canonicalizeCourt({ court: courtFilter });
  if (!resolved.code) return [];

  return COURT_CODE_TO_IDS[resolved.code] || [];
}

type CourtIdEntry = {
  id: number;
  code: string;
  level: "SC" | "HC" | "OTHER";
  state: string | null;
  aliases: string[];
};

const COURT_ID_MAP: Record<number, CourtIdEntry> = {
  1: {
    id: 1,
    code: "SC",
    level: "SC",
    state: null,
    aliases: ["supreme court", "supreme court of india", "sc"],
  },

  2: {
    id: 2,
    code: "DELHI_HC",
    level: "HC",
    state: "delhi",
    aliases: ["delhi high court", "high court of delhi", "delhi"],
  },
  3: {
    id: 3,
    code: "BOMBAY_HC",
    level: "HC",
    state: "maharashtra",
    aliases: ["bombay high court", "bombay", "mumbai high court", "maharashtra high court"],
  },
  4: {
    id: 4,
    code: "GUJARAT_HC",
    level: "HC",
    state: "gujarat",
    aliases: ["gujarat high court", "high court of gujarat", "gujarat"],
  },
  5: {
    id: 5,
    code: "ALLAHABAD_HC",
    level: "HC",
    state: "uttar pradesh",
    aliases: ["allahabad high court", "allahabad", "uttar pradesh high court"],
  },
  6: {
    id: 6,
    code: "GAUHATI_HC",
    level: "HC",
    state: "assam",
    aliases: ["gauhati high court", "gauhati", "guwahati high court", "assam high court"],
  },
  7: {
    id: 7,
    code: "PUNJAB_HARYANA_HC",
    level: "HC",
    state: "punjab",
    aliases: [
      "punjab and haryana high court",
      "high court of punjab and haryana",
      "punjab haryana high court",
      "chandigarh high court",
    ],
  },
  8: {
    id: 8,
    code: "MADRAS_HC",
    level: "HC",
    state: "tamil nadu",
    aliases: ["madras high court", "madras", "chennai high court", "tamil nadu high court"],
  },
  9: {
    id: 9,
    code: "ANDHRA_PRADESH_HC",
    level: "HC",
    state: "andhra pradesh",
    aliases: ["andhra pradesh high court", "high court of andhra pradesh", "andhra pradesh"],
  },
  10: {
    id: 10,
    code: "KARNATAKA_HC",
    level: "HC",
    state: "karnataka",
    aliases: ["karnataka high court", "high court of karnataka", "karnataka"],
  },
  11: {
    id: 11,
    code: "CALCUTTA_HC",
    level: "HC",
    state: "west bengal",
    aliases: ["calcutta high court", "calcutta", "kolkata high court", "west bengal high court"],
  },
  12: {
    id: 12,
    code: "MADHYA_PRADESH_HC",
    level: "HC",
    state: "madhya pradesh",
    aliases: ["madhya pradesh high court", "high court of madhya pradesh", "madhya pradesh"],
  },
  13: {
    id: 13,
    code: "KERALA_HC",
    level: "HC",
    state: "kerala",
    aliases: ["kerala high court", "high court of kerala", "kerala"],
  },
  14: {
    id: 14,
    code: "PATNA_HC",
    level: "HC",
    state: "bihar",
    aliases: ["patna high court", "patna", "bihar high court"],
  },
  15: {
    id: 15,
    code: "ORISSA_HC",
    level: "HC",
    state: "odisha",
    aliases: ["orissa high court", "high court of orissa", "odisha high court", "odisha"],
  },
  16: {
    id: 16,
    code: "RAJASTHAN_HC",
    level: "HC",
    state: "rajasthan",
    aliases: ["rajasthan high court", "high court of rajasthan", "rajasthan"],
  },
  17: {
    id: 17,
    code: "JHARKHAND_HC",
    level: "HC",
    state: "jharkhand",
    aliases: ["jharkhand high court", "high court of jharkhand", "jharkhand"],
  },
  18: {
    id: 18,
    code: "HIMACHAL_PRADESH_HC",
    level: "HC",
    state: "himachal pradesh",
    aliases: ["himachal pradesh high court", "high court of himachal pradesh", "himachal pradesh"],
  },
  19: {
    id: 19,
    code: "JAMMU_KASHMIR_LADAKH_HC",
    level: "HC",
    state: "jammu and kashmir",
    aliases: [
      "jammu and kashmir high court",
      "jammu kashmir high court",
      "high court of jammu and kashmir",
      "high court of jammu & kashmir",
    ],
  },
  20: {
    id: 20,
    code: "SIKKIM_HC",
    level: "HC",
    state: "sikkim",
    aliases: ["sikkim high court", "high court of sikkim", "sikkim"],
  },
  21: {
    id: 21,
    code: "CHHATTISGARH_HC",
    level: "HC",
    state: "chhattisgarh",
    aliases: ["chhattisgarh high court", "high court of chhattisgarh", "chhattisgarh"],
  },
  22: {
    id: 22,
    code: "UTTARAKHAND_HC",
    level: "HC",
    state: "uttarakhand",
    aliases: [
      "uttaranchal high court",
      "uttarakhand high court",
      "high court of uttarakhand",
      "high court of uttaranchal",
      "nainital high court",
      "uttaranchal",
      "uttarakhand",
    ],
  },

  24: {
    id: 24,
    code: "PRIVY_COUNCIL",
    level: "OTHER",
    state: null,
    aliases: ["privy council"],
  },
  25: {
    id: 25,
    code: "FEDERAL_COURT",
    level: "OTHER",
    state: null,
    aliases: ["federal court"],
  },
  26: {
    id: 26,
    code: "NAGPUR_HC",
    level: "OTHER",
    state: null,
    aliases: ["nagpur high court", "nagpur"],
  },
  27: {
    id: 27,
    code: "LAHORE_HC",
    level: "OTHER",
    state: null,
    aliases: ["lahore high court", "lahore"],
  },
  28: {
    id: 28,
    code: "SINDH_HC",
    level: "OTHER",
    state: null,
    aliases: ["sindh high court", "sindh"],
  },
  29: {
    id: 29,
    code: "RANGOON_HC",
    level: "OTHER",
    state: null,
    aliases: ["rangoon high court", "rangoon"],
  },
  30: {
    id: 30,
    code: "PESHAWAR_HC",
    level: "OTHER",
    state: null,
    aliases: ["peshawar high court", "peshawar"],
  },
  40: {
    id: 40,
    code: "OUDH",
    level: "OTHER",
    state: null,
    aliases: ["oudh", "oudh chief court", "chief court of oudh"],
  },

  82: {
    id: 82,
    code: "MEGHALAYA_HC",
    level: "HC",
    state: "meghalaya",
    aliases: ["meghalaya high court", "high court of meghalaya", "meghalaya"],
  },
  83: {
    id: 83,
    code: "TRIPURA_HC",
    level: "HC",
    state: "tripura",
    aliases: ["tripura high court", "high court of tripura", "tripura"],
  },
  84: {
    id: 84,
    code: "MANIPUR_HC",
    level: "HC",
    state: "manipur",
    aliases: ["manipur high court", "high court of manipur", "manipur"],
  },

  91: {
    id: 91,
    code: "TRAVANCORE_COCHIN_HC",
    level: "OTHER",
    state: "kerala",
    aliases: ["travancore cochin high court", "travancore-cochin", "travancore cochin"],
  },
  97: {
    id: 97,
    code: "SAURASHTRA_HC",
    level: "OTHER",
    state: "gujarat",
    aliases: ["saurashtra high court", "saurashtra"],
  },
  98: {
    id: 98,
    code: "KUTCH_HC",
    level: "OTHER",
    state: "gujarat",
    aliases: ["kutch high court", "kutch"],
  },

  104: {
    id: 104,
    code: "TELANGANA_HC",
    level: "HC",
    state: "telangana",
    aliases: ["telangana high court", "high court for the state of telangana", "telangana"],
  },
};

const HIGH_COURT_PATTERNS: HighCourtPattern[] = Object.values(COURT_ID_MAP)
  .filter(
    (entry): entry is CourtIdEntry & { level: "HC"; state: string } =>
      entry.level === "HC" && typeof entry.state === "string" && entry.state.length > 0
  )
  .map((entry) => ({
    code: entry.code,
    state: entry.state,
    aliases: entry.aliases,
  }));

const COURT_CODE_TO_IDS: Record<string, number[]> = Object.values(COURT_ID_MAP).reduce(
  (acc, entry) => {
    if (!acc[entry.code]) acc[entry.code] = [];
    acc[entry.code].push(entry.id);
    return acc;
  },
  {} as Record<string, number[]>
);

const STATE_ALIAS_MAP: Record<string, string> = {
  india: "india",
  "supreme court of india": "india",

  gujarat: "gujarat",
  delhi: "delhi",
  bombay: "maharashtra",
  mumbai: "maharashtra",
  maharashtra: "maharashtra",

  allahabad: "uttar pradesh",
  "uttar pradesh": "uttar pradesh",

  madras: "tamil nadu",
  chennai: "tamil nadu",
  "tamil nadu": "tamil nadu",

  calcutta: "west bengal",
  kolkata: "west bengal",
  "west bengal": "west bengal",

  karnataka: "karnataka",
  kerala: "kerala",
  rajasthan: "rajasthan",
  bihar: "bihar",
  patna: "bihar",
  telangana: "telangana",

  andhra: "andhra pradesh",
  "andhra pradesh": "andhra pradesh",

  odisha: "odisha",
  orissa: "odisha",

  punjab: "punjab",
  haryana: "haryana",
  chandigarh: "punjab",

  assam: "assam",
  gauhati: "assam",
  guwahati: "assam",

  jharkhand: "jharkhand",
  chhattisgarh: "chhattisgarh",

  himachal: "himachal pradesh",
  "himachal pradesh": "himachal pradesh",

  uttarakhand: "uttarakhand",
  sikkim: "sikkim",
  manipur: "manipur",
  meghalaya: "meghalaya",
  tripura: "tripura",

  ladakh: "jammu and kashmir",
  "jammu and kashmir": "jammu and kashmir",
  "jammu kashmir": "jammu and kashmir",
};

const STATE_TO_HC: Record<string, { code: string; state: string }> = Object.fromEntries(
  HIGH_COURT_PATTERNS.map((item) => [item.state, { code: item.code, state: item.state }])
);

const REPORTER_CODE_MAP: Record<string, { code: string; level: "SC" | "HC"; state: string | null }> =
  {
    sc: { code: "SC", level: "SC", state: null },
    guj: { code: "GUJARAT_HC", level: "HC", state: "gujarat" },
    del: { code: "DELHI_HC", level: "HC", state: "delhi" },
    bom: { code: "BOMBAY_HC", level: "HC", state: "maharashtra" },
    cal: { code: "CALCUTTA_HC", level: "HC", state: "west bengal" },
    mad: { code: "MADRAS_HC", level: "HC", state: "tamil nadu" },
    ker: { code: "KERALA_HC", level: "HC", state: "kerala" },
    kar: { code: "KARNATAKA_HC", level: "HC", state: "karnataka" },
    mp: { code: "MADHYA_PRADESH_HC", level: "HC", state: "madhya pradesh" },
    raj: { code: "RAJASTHAN_HC", level: "HC", state: "rajasthan" },
    pat: { code: "PATNA_HC", level: "HC", state: "bihar" },
    ori: { code: "ORISSA_HC", level: "HC", state: "odisha" },
    all: { code: "ALLAHABAD_HC", level: "HC", state: "uttar pradesh" },
    ap: { code: "ANDHRA_PRADESH_HC", level: "HC", state: "andhra pradesh" },
    tel: { code: "TELANGANA_HC", level: "HC", state: "telangana" },
    jhar: { code: "JHARKHAND_HC", level: "HC", state: "jharkhand" },
    chh: { code: "CHHATTISGARH_HC", level: "HC", state: "chhattisgarh" },
    hp: { code: "HIMACHAL_PRADESH_HC", level: "HC", state: "himachal pradesh" },
    jk: { code: "JAMMU_KASHMIR_LADAKH_HC", level: "HC", state: "jammu and kashmir" },
    ph: { code: "PUNJAB_HARYANA_HC", level: "HC", state: "punjab" },
    sik: { code: "SIKKIM_HC", level: "HC", state: "sikkim" },
    man: { code: "MANIPUR_HC", level: "HC", state: "manipur" },
    megh: { code: "MEGHALAYA_HC", level: "HC", state: "meghalaya" },
    tri: { code: "TRIPURA_HC", level: "HC", state: "tripura" },
    gau: { code: "GAUHATI_HC", level: "HC", state: "assam" },
    utt: { code: "UTTARAKHAND_HC", level: "HC", state: "uttarakhand" },
  };

function normalizeReporterCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function extractReporterCodes(text: string): string[] {
  const raw = compact(text);
  if (!raw) return [];

  const out: string[] = [];
  const patterns = [
    /\bLawSuit\(([^)]+)\)/gi,
    /\bAIR\(([^)]+)\)/gi,
    /\bAIR\s+([A-Za-z&.]+)\s+\d+/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(raw))) {
      const code = normalizeReporterCode(match[1] || "");
      if (code) out.push(code);
    }
  }

  return [...new Set(out)];
}

function inferCourtFromReporterValues(values: string[]): CanonicalCourt | null {
  for (const value of values) {
    for (const code of extractReporterCodes(value)) {
      const resolved = REPORTER_CODE_MAP[code];
      if (resolved) {
        return {
          code: resolved.code,
          level: resolved.level,
          state: resolved.state,
          rawCourt: "",
        };
      }
    }
  }
  return null;
}

function inferCourtFromPrefix(payload: Record<string, unknown>): CanonicalCourt {
  const rawCourt = String(payload.court ?? "").trim();
  const fileName = String(payload.fileName ?? payload.caseId ?? "").trim();

  const numeric = parseCourtId(fileName);
  if (numeric && numeric > 0) {
    const inferredCourtId = Math.floor(numeric / 100000);
    const entry = COURT_ID_MAP[inferredCourtId];
    if (entry) {
      return toCanonicalCourt(entry, rawCourt);
    }
  }

  return { code: null, level: null, state: null, rawCourt };
}
function inferCourtFromText(rawCourt: string): CanonicalCourt | null {
  const directMatches = findCourtEntriesByText(rawCourt);
  if (directMatches.length) {
    return toCanonicalCourt(directMatches[0], rawCourt);
  }

  const normalized = normalizeCourtText(rawCourt);
  if (!normalized) return null;

  if (normalized.includes("supreme court")) {
    return {
      code: "SC",
      level: "SC",
      state: null,
      rawCourt,
    };
  }

  for (const item of HIGH_COURT_PATTERNS) {
    for (const alias of item.aliases) {
      if (normalized.includes(normalizeCourtText(alias))) {
        return {
          code: item.code,
          level: "HC",
          state: item.state,
          rawCourt,
        };
      }
    }
  }

  return null;
}

export function canonicalizeJurisdictionName(input: string): string {
  const normalized = normalizeLooseSimple(input);
  return STATE_ALIAS_MAP[normalized] || normalized;
}

export function normalizeLatestJurisdictions(classified: ClassifiedQuery): string[] {
  const raw = (classified.filters?.jurisdiction || [])
    .map((j) => canonicalizeJurisdictionName(j))
    .filter(Boolean);

  const specific = raw.filter((j) => j !== "india");
  return specific.length ? [...new Set(specific)] : [...new Set(raw)];
}

export function canonicalizeCourt(payload: Record<string, unknown>): CanonicalCourt {
  const rawCourt = compact(
    [
      String(payload.court ?? ""),
      String(payload.courtName ?? ""),
    ]
      .filter(Boolean)
      .join(" ")
  );

  const fromCourtId = inferCourtFromCourtId(payload);
  if (fromCourtId) return fromCourtId;

  const fromText = inferCourtFromText(rawCourt);
  if (fromText) return fromText;

  const stateField = canonicalizeJurisdictionName(String(payload.state ?? ""));
  if (stateField && stateField !== "india") {
    const stateCourt = STATE_TO_HC[stateField];
    if (stateCourt && normalizeCourtText(rawCourt).includes("high court")) {
      return {
        code: stateCourt.code,
        level: "HC",
        state: stateCourt.state,
        rawCourt,
      };
    }
  }

  const citationValues = [
    String(payload.citation ?? ""),
    ...((Array.isArray(payload.equivalentCitations) ? payload.equivalentCitations : []).map((x) =>
      String(x)
    )),
  ].filter(Boolean);

  const fromReporter = inferCourtFromReporterValues(citationValues);
  if (fromReporter) {
    return {
      ...fromReporter,
      rawCourt,
    };
  }


  const fromPrefix = inferCourtFromPrefix(payload);
  if (fromPrefix.code) return fromPrefix;

  return {
    code: null,
    level: rawCourt ? "OTHER" : null,
    state: stateField && stateField !== "india" ? stateField : null,
    rawCourt,
  };
}

function groupCourtText(group: CaseGroup): string {
  return normalizeCourtText(
    [
      ...(group.chunks || []).map((c) =>
        [
          String(c.payload?.court ?? ""),
          String(c.payload?.courtName ?? ""),
          String(c.payload?.state ?? ""),
          String(c.payload?.jurisdiction ?? ""),
          String(c.payload?.citation ?? ""),
          Array.isArray(c.payload?.equivalentCitations)
            ? c.payload.equivalentCitations.join(" ")
            : "",
        ].join(" ")
      ),
    ].join(" ")
  );
}

function getGroupCourts(group: CaseGroup): CanonicalCourt[] {
  const out: CanonicalCourt[] = [];
  const seen = new Set<string>();

  for (const chunk of group.chunks || []) {
    const resolved = canonicalizeCourt((chunk.payload || {}) as Record<string, unknown>);
    const key = `${resolved.code || ""}|${resolved.level || ""}|${resolved.state || ""}|${normalizeCourtText(
      resolved.rawCourt
    )}`;

    if (!seen.has(key)) {
      seen.add(key);
      out.push(resolved);
    }
  }

  return out;
}

export function matchesCourtConstraint(group: CaseGroup, courtFilter: string): boolean {
  const target = canonicalizeCourt({ court: courtFilter });
  const groupCourts = getGroupCourts(group);

  if (target.code) {
    return groupCourts.some((court) => court.code === target.code);
  }

  const wanted = normalizeCourtText(courtFilter);
  if (!wanted) return true;

  return groupCourts.some((court) => normalizeCourtText(court.rawCourt).includes(wanted)) ||
    groupCourtText(group).includes(wanted);
}

export function matchesJurisdictionConstraint(group: CaseGroup, jurisdiction: string): boolean {
  const target = canonicalizeJurisdictionName(jurisdiction);
  if (!target || target === "india") return true;

  const groupCourts = getGroupCourts(group);
  if (groupCourts.some((court) => court.state === target)) {
    return true;
  }

  return groupCourtText(group).includes(target);
}

export function getLatestForumBoost(group: CaseGroup, classified: ClassifiedQuery): number {
  const requestedCourts = (classified.filters?.courts || [])
    .map((c) => canonicalizeCourt({ court: c }))
    .filter((c) => c.code);

  const requestedJurisdictions = normalizeLatestJurisdictions(classified);
  const resolvedCourts = getGroupCourts(group).filter((c) => c.code);

  if (!resolvedCourts.length) return 0;

  if (requestedCourts.length) {
    const matched = resolvedCourts.some((resolved) =>
      requestedCourts.some((requested) => requested.code === resolved.code)
    );
    return matched ? 2.5 : -1.25;
  }

  if (requestedJurisdictions.length) {
    let best = 0;

    for (const court of resolvedCourts) {
      if (court.state && requestedJurisdictions.includes(court.state)) {
        if (court.level === "HC") best = Math.max(best, 2.0);
        else if (court.code === "SC") best = Math.max(best, -1.0);
      }
    }

    if (best !== 0) return best;

    const specific = requestedJurisdictions.filter((j) => j !== "india");
    if (specific.length) {
      const hasStateHC = resolvedCourts.some((court) => court.level === "HC");
      const hasSC = resolvedCourts.some((court) => court.code === "SC");

      if (hasSC && !hasStateHC) return -0.75;
    }
  }

  return 0;
}