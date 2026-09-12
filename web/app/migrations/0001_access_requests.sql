-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE IF NOT EXISTS access_requests (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  organization TEXT,
  use_case TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('hero', 'nav', 'docs', 'direct')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS access_requests_status_created_at
  ON access_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS access_request_capacity (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  accepted_count INTEGER NOT NULL DEFAULT 0
    CHECK (accepted_count BETWEEN 0 AND 10000)
);

INSERT OR IGNORE INTO access_request_capacity (id, accepted_count) VALUES (1, 0);

-- Keep the cohort bounded without scanning the request table on every write.
-- Trigger changes and the originating statement are atomic in SQLite, so
-- concurrent Worker isolates cannot race past the 10,000-record ceiling.
CREATE TRIGGER IF NOT EXISTS access_requests_capacity
BEFORE INSERT ON access_requests
WHEN NOT EXISTS (SELECT 1 FROM access_requests WHERE email = NEW.email)
BEGIN
  UPDATE access_request_capacity
    SET accepted_count = accepted_count + 1
    WHERE id = 1 AND accepted_count < 10000;
  SELECT (CASE WHEN changes() = 0
    THEN RAISE(ABORT, 'access_request_capacity_reached')
  END);
END;

CREATE TRIGGER IF NOT EXISTS access_requests_release_capacity
AFTER DELETE ON access_requests
BEGIN
  UPDATE access_request_capacity
    SET accepted_count = MAX(accepted_count - 1, 0)
    WHERE id = 1;
END;
