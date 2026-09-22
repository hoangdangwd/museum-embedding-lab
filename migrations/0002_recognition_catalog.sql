-- Only developer tools write this catalog. The public Worker reads it.
CREATE TABLE IF NOT EXISTS recognition_references (
  signature TEXT NOT NULL,
  digest TEXT NOT NULL,
  artifact TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector TEXT NOT NULL,
  PRIMARY KEY (signature, digest)
);
