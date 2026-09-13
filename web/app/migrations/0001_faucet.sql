-- One allocation per identity and per wallet, across deployments and instances.
CREATE TABLE IF NOT EXISTS faucet_allocations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  wallet TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'running',
  phase TEXT NOT NULL DEFAULT 'reserved',
  hashes TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
