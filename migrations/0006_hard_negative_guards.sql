CREATE TABLE recognition_hard_negatives (
  id TEXT PRIMARY KEY,
  target_artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  signature TEXT NOT NULL,
  group_key TEXT NOT NULL,
  digest TEXT NOT NULL,
  vector TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (target_artifact_id, signature, group_key, digest)
);

CREATE INDEX idx_hard_negatives_lookup
  ON recognition_hard_negatives(target_artifact_id, signature, enabled);
