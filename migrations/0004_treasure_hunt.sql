ALTER TABLE reference_images ADD COLUMN vector_json TEXT;

CREATE TABLE missions (
  artifact_id TEXT PRIMARY KEY REFERENCES artifacts(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  clue TEXT NOT NULL DEFAULT '',
  hint TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  story TEXT NOT NULL DEFAULT '',
  observation TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1))
);
CREATE TABLE player_sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  busy_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE collected_stamps (
  session_id TEXT NOT NULL REFERENCES player_sessions(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  collected_at INTEGER NOT NULL,
  PRIMARY KEY(session_id, artifact_id)
);
CREATE TABLE scan_attempts (
  session_id TEXT NOT NULL REFERENCES player_sessions(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('processing','complete','failed')),
  response_json TEXT,
  response_status INTEGER NOT NULL DEFAULT 200,
  created_at INTEGER NOT NULL,
  duration_ms INTEGER,
  cached INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(session_id, request_id)
);
CREATE INDEX idx_scan_created ON scan_attempts(created_at);
CREATE TABLE recognition_cache (
  session_id TEXT NOT NULL REFERENCES player_sessions(id) ON DELETE CASCADE,
  digest TEXT NOT NULL,
  signature TEXT NOT NULL,
  revision INTEGER NOT NULL,
  result_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(session_id, digest)
);
CREATE TABLE usage_buckets (
  key TEXT PRIMARY KEY,
  used INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE catalog_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
INSERT INTO catalog_state VALUES(1,1);
CREATE TRIGGER refs_insert_revision AFTER INSERT ON reference_images BEGIN
  UPDATE catalog_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER refs_update_revision AFTER UPDATE ON reference_images BEGIN
  UPDATE catalog_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER refs_delete_revision AFTER DELETE ON reference_images BEGIN
  UPDATE catalog_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER mission_update_revision AFTER UPDATE ON missions BEGIN
  UPDATE catalog_state SET revision=revision+1 WHERE id=1;
END;
