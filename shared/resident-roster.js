const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");

const DEFAULT_COEFFICIENT = 0.003367;
const DEFAULT_EMAIL_DOMAIN = "vegasdelrio.com";
const FIRST_DATA_ROW = 3;
const QUORUM_MIN_HOMES = 150;
const ROSTER_FILE_NAME = "LISTA ASISTENCIA REUNION ASAMBLEA 2026.xls";

const normalizeUnit = (value) =>
  typeof value === "string" ? value.trim().toUpperCase() : "";

const buildResidentEmail = (unit) =>
  `${normalizeUnit(unit).toLowerCase()}@${DEFAULT_EMAIL_DOMAIN}`;

const buildResidentPassword = (unit) => normalizeUnit(unit);

const buildLegacyResidentPassword = (unit) => `VR-${normalizeUnit(unit)}`;

const isEmbeddedHeaderRow = (unit, fullName) =>
  normalizeUnit(unit) === "CASA" &&
  typeof fullName === "string" &&
  fullName.trim().toUpperCase() === "NOMBRE";

const resolveRosterPath = (baseDir = process.cwd()) => {
  const candidates = [
    path.resolve(baseDir, "doc", ROSTER_FILE_NAME),
    path.resolve(baseDir, ROSTER_FILE_NAME),
    path.resolve(baseDir, "..", "doc", ROSTER_FILE_NAME),
    path.resolve(baseDir, "..", ROSTER_FILE_NAME),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
};

const readRosterOwners = (xlsPath) => {
  const workbook = xlsx.readFile(xlsPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
  const seenUnits = new Set();

  return rows
    .slice(FIRST_DATA_ROW)
    .map((row) => {
      const unit = normalizeUnit(row?.[0]?.toString());
      const fullName =
        typeof row?.[1] === "string" ? row[1].trim() : row?.[1]?.toString().trim();

      if (!unit || !fullName || isEmbeddedHeaderRow(unit, fullName)) {
        return null;
      }

      if (seenUnits.has(unit)) {
        return null;
      }

      seenUnits.add(unit);

      return { unit, fullName };
    })
    .filter(Boolean);
};

module.exports = {
  DEFAULT_COEFFICIENT,
  DEFAULT_EMAIL_DOMAIN,
  FIRST_DATA_ROW,
  QUORUM_MIN_HOMES,
  ROSTER_FILE_NAME,
  buildLegacyResidentPassword,
  buildResidentEmail,
  buildResidentPassword,
  normalizeUnit,
  readRosterOwners,
  resolveRosterPath,
};
