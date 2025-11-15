import { parseCsv, rowsToObjects } from "./sqlInsertGenerator.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

const COLUMN_CANDIDATES = {
  idtrack: ["IDTRACK", "TRACK", "CIRCUIT"],
  raceName: ["NAME", "RACE", "EVENT", "GRAND_PRIX"],
  date: ["DATE", "DAY"],
  time: ["TIME", "HOUR"],
  mainFlag: ["MAIN", "IS_MAIN", "MAINFLAG"],
  parent: ["MAIN_ID", "PARENT", "ROUND", "RACE_NAME"],
};

function cleanText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  return String(value).trim();
}

function normalizeKey(value) {
  return cleanText(value).toLowerCase();
}

function createHeaderLookup(headers = []) {
  const lookup = Object.create(null);
  headers.forEach((name) => {
    lookup[normalizeKey(name)] = name;
  });
  return lookup;
}

function hasCandidateColumn(lookup, candidates) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  return list.some((candidate) => !!lookup[normalizeKey(candidate)]);
}

function fetchField(row, lookup, candidates) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  for (const candidate of list) {
    const header = lookup[normalizeKey(candidate)];
    if (header && Object.prototype.hasOwnProperty.call(row, header)) {
      return row[header];
    }
  }
  return "";
}

function parseMainFlag(value) {
  const str = cleanText(value).toLowerCase();
  if (!str) return false;
  if (str === "1" || str === "true" || str === "yes" || str === "y") return true;
  if (str === "0" || str === "false" || str === "no" || str === "n") return false;
  const num = Number(str);
  if (Number.isFinite(num)) return num !== 0;
  return false;
}

function excelSerialToDate(value) {
  const str = cleanText(value);
  if (!str) return null;
  const num = Number(str.replace(",", "."));
  if (!Number.isFinite(num)) return null;
  const days = Math.floor(num);
  if (!Number.isFinite(days)) return null;
  const date = new Date(EXCEL_EPOCH_MS + days * MS_PER_DAY);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function isoFromDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateValue(value) {
  const str = cleanText(value);
  if (!str) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const excelDate = excelSerialToDate(str);
  if (excelDate) return isoFromDate(excelDate);

  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    const rawYear = Number(slashMatch[3]);
    const year = rawYear < 100 ? (rawYear >= 70 ? rawYear + 1900 : rawYear + 2000) : rawYear;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(date.getTime())) return isoFromDate(date);
  }

  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) return isoFromDate(parsed);

  return "";
}

function formatTimeValue(value) {
  const str = cleanText(value);
  if (!str) return "";
  if (/^\d{1,2}:\d{2}$/.test(str)) {
    const [hours, minutes] = str.split(":");
    const hh = Math.min(Math.max(parseInt(hours, 10) || 0, 0), 23);
    const mm = Math.min(Math.max(parseInt(minutes, 10) || 0, 0), 59);
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(str)) {
    const parts = str.split(":");
    const hh = Math.min(Math.max(parseInt(parts[0], 10) || 0, 0), 23);
    const mm = Math.min(Math.max(parseInt(parts[1], 10) || 0, 0), 59);
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  const num = Number(str.replace(",", "."));
  if (!Number.isFinite(num)) return "";
  if (num >= 1 && num <= 24 && Number.isInteger(num)) {
    return `${String(num).padStart(2, "0")}:00`;
  }
  const rawFraction = num - Math.trunc(num);
  const fraction = rawFraction >= 0 ? rawFraction : rawFraction + 1;
  const totalMinutes = Math.round(fraction * 1440) % 1440;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function collectParentKeys(record) {
  const keys = [];
  const add = (value) => {
    const key = normalizeKey(value);
    if (key && !keys.includes(key)) {
      keys.push(key);
    }
  };
  add(record.parentHint);
  add(record.idtrack);
  return keys;
}

function normalizeRows(rows, headerLookup) {
  return rows.map((row, idx) => {
    const nameRaw = fetchField(row, headerLookup, COLUMN_CANDIDATES.raceName);
    const parentRaw = fetchField(row, headerLookup, COLUMN_CANDIDATES.parent);
    const normalized = {
      rowNumber: idx + 2,
      idtrack: cleanText(fetchField(row, headerLookup, COLUMN_CANDIDATES.idtrack)),
      name: cleanText(nameRaw),
      parentHint: cleanText(parentRaw),
      date: formatDateValue(fetchField(row, headerLookup, COLUMN_CANDIDATES.date)),
      time: formatTimeValue(fetchField(row, headerLookup, COLUMN_CANDIDATES.time)),
      main: parseMainFlag(fetchField(row, headerLookup, COLUMN_CANDIDATES.mainFlag)),
    };
    normalized.parentKeys = collectParentKeys(normalized);
    if (normalized.main && normalized.name) {
      const raceKey = normalizeKey(normalized.name);
      if (raceKey && !normalized.parentKeys.includes(raceKey)) {
        normalized.parentKeys.push(raceKey);
      }
    }
    return normalized;
  });
}

function normalizeChampionship(value) {
  const text = cleanText(value);
  return text || "Formula 1";
}

function normalizeYearValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = cleanText(value);
  if (!text) return new Date().getFullYear();
  const parsed = Number(text);
  if (Number.isFinite(parsed)) return parsed;
  return text;
}

function createEmptyCalendar(options = {}) {
  return {
    championship: normalizeChampionship(options.championship),
    year: normalizeYearValue(options.year),
    races: [],
  };
}

export function buildCalendarFromCsv(csvText, options = {}) {
  const parsed = parseCsv(csvText || "", {
    delimiter: (options.delimiter || "").trim(),
    hasHeader: true,
  });

  if (!parsed.headers.length) {
    throw new Error("CSV appears empty or lacks headers.");
  }

  const headerLookup = createHeaderLookup(parsed.headers);

  const required = [
    { label: "NAME", candidates: COLUMN_CANDIDATES.raceName },
    { label: "DATE", candidates: COLUMN_CANDIDATES.date },
    { label: "TIME", candidates: COLUMN_CANDIDATES.time },
    { label: "MAIN", candidates: COLUMN_CANDIDATES.mainFlag },
  ];
  required.forEach((entry) => {
    if (!hasCandidateColumn(headerLookup, entry.candidates)) {
      throw new Error(`${entry.label} column is required.`);
    }
  });

  if (!parsed.rows.length) {
    return {
      calendar: createEmptyCalendar(options),
      stats: { races: 0, sessions: 0, unmatchedSessions: 0 },
      unmatchedSessions: [],
      detectedDelimiter: parsed.delimiter,
    };
  }

  const objects = rowsToObjects(parsed.headers, parsed.rows);
  const normalized = normalizeRows(objects, headerLookup);

  const races = [];
  const raceLookup = new Map();

  normalized.forEach((record) => {
    if (!record.main) return;
    if (!record.name) {
      throw new Error(`Row ${record.rowNumber}: missing race name for a main entry.`);
    }
    if (!record.date) {
      throw new Error(`Row ${record.rowNumber}: invalid DATE value.`);
    }
    const race = {
      idtrack: record.idtrack,
      name: record.name,
      date: record.date,
      time: record.time,
      additionalInfo: { sessions: [] },
    };
    races.push(race);
    record.parentKeys.forEach((key) => {
      if (key && !raceLookup.has(key)) {
        raceLookup.set(key, race);
      }
    });
  });

  const unmatchedSessions = [];

  normalized.forEach((record) => {
    if (record.main) return;
    const parent = record.parentKeys
      .map((key) => (key ? raceLookup.get(key) : null))
      .find(Boolean);
    if (!parent) {
      unmatchedSessions.push({
        rowNumber: record.rowNumber,
        session: record.name || "(no name)",
        target: record.parentHint || record.idtrack || "unknown",
      });
      return;
    }
    parent.additionalInfo.sessions.push({
      name: record.name || "Session",
      date: record.date,
      time: record.time,
    });
  });

  const stats = {
    races: races.length,
    sessions: races.reduce((sum, race) => sum + race.additionalInfo.sessions.length, 0),
    unmatchedSessions: unmatchedSessions.length,
  };

  return {
    calendar: {
      championship: normalizeChampionship(options.championship),
      year: normalizeYearValue(options.year),
      races,
    },
    stats,
    unmatchedSessions,
    detectedDelimiter: parsed.delimiter,
  };
}

export default {
  buildCalendarFromCsv,
};
