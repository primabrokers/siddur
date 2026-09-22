// db/schema.js
// SQLite schema and migrations.

export const MIGRATIONS = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tradition TEXT,
  revision_hash TEXT NOT NULL,
  format TEXT NOT NULL,
  excerpt INTEGER NOT NULL DEFAULT 0,
  label TEXT,
  source_label TEXT,
  book_count INTEGER NOT NULL DEFAULT 0,
  verse_count INTEGER NOT NULL DEFAULT 0,
  letter_count INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER NOT NULL DEFAULT 0,
  original TEXT NOT NULL,
  consonant TEXT,
  books TEXT,
  verses TEXT,
  unusual_letters TEXT,
  warnings TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  reference_height_mm REAL NOT NULL,
  letter_height_mm REAL NOT NULL,
  stroke_mm REAL NOT NULL,
  unit_mm REAL NOT NULL,
  min_nib_mm REAL NOT NULL,
  letter_widths TEXT NOT NULL,
  stroke_factors TEXT,
  gaps TEXT NOT NULL,
  non_stretchable TEXT NOT NULL,
  max_stretch TEXT NOT NULL,
  stretch_position TEXT NOT NULL DEFAULT 'anywhere',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS geometries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lines_per_amud INTEGER NOT NULL,
  baseline_pitch_mm REAL NOT NULL,
  top_margin_mm REAL NOT NULL,
  bottom_margin_mm REAL NOT NULL,
  inter_column_gap_mm REAL NOT NULL,
  outer_margin_mm REAL NOT NULL,
  line_width_mm REAL NOT NULL,
  max_letters_per_line INTEGER NOT NULL,
  amudim_per_yeria INTEGER NOT NULL,
  partial_final_yeria TEXT NOT NULL DEFAULT 'round_up',
  setuma_gap_mm REAL,
  setuma_reference_letter TEXT,
  min_inter_letter_gap_mm REAL,
  min_inter_word_gap_mm REAL,
  max_inter_word_gap_mm REAL,
  small_letter_reference TEXT,
  vavei_haamudim INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS patterns (
  id TEXT PRIMARY KEY,
  passage_name TEXT NOT NULL,
  scheme_name TEXT NOT NULL,
  version TEXT,
  provenance TEXT,
  status TEXT NOT NULL DEFAULT 'unverified',
  slots TEXT NOT NULL,
  range TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS layouts (
  id TEXT PRIMARY KEY,
  name TEXT,
  source_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  geometry_id TEXT NOT NULL,
  pattern_ids TEXT,
  annotations TEXT,
  source_hash TEXT NOT NULL,
  profile_snapshot TEXT NOT NULL,
  geometry_snapshot TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  locked_at TEXT,
  summary TEXT,
  validation TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS layout_lines (
  id TEXT PRIMARY KEY,
  layout_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  line_index INTEGER NOT NULL,
  amud INTEGER NOT NULL,
  tokens TEXT NOT NULL,
  text TEXT NOT NULL,
  consonant_text TEXT,
  width_mm REAL NOT NULL,
  leftover_mm REAL NOT NULL,
  stretch_decisions TEXT NOT NULL,
  letter_occurrence_ids TEXT NOT NULL,
  shem INTEGER NOT NULL DEFAULT 0,
  uncertain_shem INTEGER NOT NULL DEFAULT 0,
  first_word TEXT,
  last_word TEXT,
  verse_refs TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  parent_layout_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  geometry_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  diff TEXT,
  lines_snapshot TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sources_hash ON sources(revision_hash);
CREATE INDEX IF NOT EXISTS idx_layout_lines_layout ON layout_lines(layout_id, line_index);
CREATE INDEX IF NOT EXISTS idx_layout_lines_stable ON layout_lines(line_id);
CREATE INDEX IF NOT EXISTS idx_candidates_parent ON candidates(parent_layout_id);
`,
  },
  {
    version: 2,
    sql: `
ALTER TABLE layout_lines ADD COLUMN words TEXT;
ALTER TABLE layout_lines ADD COLUMN items TEXT;
ALTER TABLE layout_lines ADD COLUMN base_leftover_mm REAL;
ALTER TABLE sources ADD COLUMN canonical TEXT;
ALTER TABLE sources ADD COLUMN has_qere_ketiv INTEGER NOT NULL DEFAULT 0;
`,
  },
  {
    version: 3,
    sql: `
ALTER TABLE profiles ADD COLUMN min_letter_height_mm REAL;
ALTER TABLE layout_lines ADD COLUMN stretched_width_mm REAL;
ALTER TABLE candidates ADD COLUMN summary TEXT;
ALTER TABLE candidates ADD COLUMN validation TEXT;
ALTER TABLE candidates ADD COLUMN pattern_ids TEXT;
ALTER TABLE candidates ADD COLUMN annotations TEXT;
`,
  },
  {
    version: 4,
    sql: `
ALTER TABLE layout_lines ADD COLUMN line_key TEXT;
ALTER TABLE sources ADD COLUMN partial_corpus INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_layout_lines_key ON layout_lines(line_key);
`,
  },
  {
    version: 5,
    sql: `
ALTER TABLE geometries ADD COLUMN max_inter_word_gap_factor REAL;
`,
  },
  {
    version: 6,
    sql: `ALTER TABLE layout_lines ADD COLUMN layout_flags TEXT;`,
  },
  {
    version: 7,
    sql: `ALTER TABLE profiles ADD COLUMN stretch_policy TEXT;
ALTER TABLE profiles ADD COLUMN units_per_row REAL;
ALTER TABLE profiles ADD COLUMN unit_basis TEXT;
ALTER TABLE profiles ADD COLUMN layout_mode TEXT;`,
  },
  { version: 8, sql: `ALTER TABLE profiles ADD COLUMN letter_height_units REAL;` },
  { version: 9, sql: `CREATE TABLE geometry_options (geometry_id TEXT PRIMARY KEY REFERENCES geometries(id), options TEXT NOT NULL);` },
];

export function applyMigrations(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const getVersion = () => db.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get();
  let current = getVersion() ? getVersion().version : 0;
  for (const m of MIGRATIONS.sort((a, b) => a.version - b.version)) {
    if (m.version <= current) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(m.version, new Date().toISOString());
    })();
    current = m.version;
  }
  return current;
}

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
