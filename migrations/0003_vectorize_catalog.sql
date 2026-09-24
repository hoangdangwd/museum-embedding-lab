CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reference_images (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  digest TEXT NOT NULL UNIQUE,
  r2_key TEXT NOT NULL UNIQUE,
  vector_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  error TEXT,
  signature TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reference_images_artifact ON reference_images(artifact_id);
CREATE INDEX IF NOT EXISTS idx_reference_images_status ON reference_images(status);
