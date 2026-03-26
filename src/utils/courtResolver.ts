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

const HIGH_COURT_PATTERNS: HighCourtPattern[] = [
  {
    code: "ALLAHABAD_HC",
    state: "uttar pradesh",
    aliases: ["allahabad high court", "allahabad", "uttar pradesh high court"],
  },
  {
    code: "ANDHRA_PRADESH_HC",
    state: "andhra pradesh",
    aliases: ["andhra pradesh high court", "high court of andhra pradesh", "andhra pradesh"],
  },
  {
    code: "BOMBAY_HC",
    state: "maharashtra",
    aliases: ["bombay high court", "bombay", "mumbai high court", "maharashtra high court"],
  },
  {
    code: "CALCUTTA_HC",
    state: "west bengal",
    aliases: ["calcutta high court", "calcutta", "kolkata high court", "west bengal high court"],
  },
  {
    code: "CHHATTISGARH_HC",
    state: "chhattisgarh",
    aliases: ["chhattisgarh high court", "high court of chhattisgarh", "chhattisgarh"],
  },
  {
    code: "DELHI_HC",
    state: "delhi",
    aliases: ["delhi high court", "high court of delhi", "delhi"],
  },
  {
    code: "GAUHATI_HC",
    state: "assam",
    aliases: ["gauhati high court", "gauhati", "guwahati high court", "assam high court"],
  },
  {
    code: "GUJARAT_HC",
    state: "gujarat",
    aliases: ["gujarat high court", "high court of gujarat", "gujarat"],
  },
  {
    code: "HIMACHAL_PRADESH_HC",
    state: "himachal pradesh",
    aliases: ["himachal pradesh high court", "high court of himachal pradesh", "himachal pradesh"],
  },
  {
    code: "JAMMU_KASHMIR_LADAKH_HC",
    state: "jammu and kashmir",
    aliases: [
      "high court of jammu and kashmir and ladakh",
      "high court of jammu kashmir and ladakh",
      "jammu and kashmir and ladakh high court",
      "jammu kashmir and ladakh high court",
      "jammu and kashmir high court",
      "jammu kashmir high court",
      "ladakh high court",
    ],
  },
  {
    code: "JHARKHAND_HC",
    state: "jharkhand",
    aliases: ["jharkhand high court", "high court of jharkhand", "jharkhand"],
  },
  {
    code: "KARNATAKA_HC",
    state: "karnataka",
    aliases: ["karnataka high court", "high court of karnataka", "karnataka"],
  },
  {
    code: "KERALA_HC",
    state: "kerala",
    aliases: ["kerala high court", "high court of kerala", "kerala"],
  },
  {
    code: "MADHYA_PRADESH_HC",
    state: "madhya pradesh",
    aliases: ["madhya pradesh high court", "high court of madhya pradesh", "madhya pradesh"],
  },
  {
    code: "MADRAS_HC",
    state: "tamil nadu",
    aliases: ["madras high court", "madras", "chennai high court", "tamil nadu high court"],
  },
  {
    code: "MANIPUR_HC",
    state: "manipur",
    aliases: ["manipur high court", "high court of manipur", "manipur"],
  },
  {
    code: "MEGHALAYA_HC",
    state: "meghalaya",
    aliases: ["meghalaya high court", "high court of meghalaya", "meghalaya"],
  },
  {
    code: "ORISSA_HC",
    state: "odisha",
    aliases: ["orissa high court", "high court of orissa", "odisha high court", "odisha"],
  },
  {
    code: "PATNA_HC",
    state: "bihar",
    aliases: ["patna high court", "patna", "bihar high court"],
  },
  {
    code: "PUNJAB_HARYANA_HC",
    state: "punjab",
    aliases: [
      "punjab and haryana high court",
      "high court of punjab and haryana",
      "punjab haryana high court",
      "chandigarh high court",
    ],
  },
  {
    code: "RAJASTHAN_HC",
    state: "rajasthan",
    aliases: ["rajasthan high court", "high court of rajasthan", "rajasthan"],
  },
  {
    code: "SIKKIM_HC",
    state: "sikkim",
    aliases: ["sikkim high court", "high court of sikkim", "sikkim"],
  },
  {
    code: "TELANGANA_HC",
    state: "telangana",
    aliases: ["telangana high court", "high court for the state of telangana", "telangana"],
  },
  {
    code: "TRIPURA_HC",
    state: "tripura",
    aliases: ["tripura high court", "high court of tripura", "tripura"],
  },
  {
    code: "UTTARAKHAND_HC",
    state: "uttarakhand",
    aliases: ["uttarakhand high court", "high court of uttarakhand", "uttarakhand", "nainital high court"],
  },
];

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
  const prefix = fileName.charAt(0);

  const prefixMap: Record<string, CanonicalCourt> = {
    "1": { code: "SC", level: "SC", state: null, rawCourt },
    "2": { code: "DELHI_HC", level: "HC", state: "delhi", rawCourt },
    "3": { code: "BOMBAY_HC", level: "HC", state: "maharashtra", rawCourt },
    "4": { code: "GUJARAT_HC", level: "HC", state: "gujarat", rawCourt },
  };

  return prefixMap[prefix] || { code: null, level: null, state: null, rawCourt };
}

function inferCourtFromText(rawCourt: string): CanonicalCourt | null {
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