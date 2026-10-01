ALTER TABLE reference_images ADD COLUMN description TEXT;
ALTER TABLE reference_images ADD COLUMN description_signature TEXT;
ALTER TABLE artifacts ADD COLUMN external_object_id TEXT;
CREATE UNIQUE INDEX idx_artifacts_external_object_id ON artifacts(external_object_id) WHERE external_object_id IS NOT NULL;

CREATE TABLE recognition_requests (
  request_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('processing','complete')),
  response_json TEXT,
  response_status INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_recognition_requests_expiry ON recognition_requests(expires_at);
CREATE TRIGGER artifact_mapping_revision AFTER UPDATE OF external_object_id ON artifacts BEGIN
  UPDATE catalog_state SET revision=revision+1 WHERE id=1;
END;
