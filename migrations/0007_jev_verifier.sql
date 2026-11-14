-- Separate reject-only verifier accounting; never changes catalog, API quota or guards.
CREATE TABLE jev_attempts (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL,
  finished_at INTEGER,
  state TEXT NOT NULL,
  charged_microusd INTEGER NOT NULL CHECK(charged_microusd>=0),
  cost_known INTEGER NOT NULL DEFAULT 0 CHECK(cost_known IN (0,1)),
  elapsed_ms INTEGER
);
CREATE INDEX idx_jev_day ON jev_attempts(day);
CREATE INDEX idx_jev_lease ON jev_attempts(lease_until) WHERE finished_at IS NULL;
CREATE TABLE jev_circuit (
  id INTEGER PRIMARY KEY CHECK(id=1),
  failures INTEGER NOT NULL DEFAULT 0,
  blocked_until INTEGER NOT NULL DEFAULT 0
);
INSERT INTO jev_circuit(id) VALUES(1);
