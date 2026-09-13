"""Exercise the actual D1-compatible SQL uniqueness with SQLite."""
import sqlite3
import unittest
from pathlib import Path

class FundingSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.executescript((Path(__file__).parents[1] / "migrations/0001_faucet.sql").read_text())

    def tearDown(self):
        self.db.close()

    def reserve(self, allocation, user, wallet):
        return self.db.execute("INSERT INTO faucet_allocations (id, user_id, wallet) VALUES (?, ?, ?) ON CONFLICT DO NOTHING RETURNING *", (allocation, user, wallet)).fetchall()

    def test_identity_and_wallet_cannot_receive_duplicate_allocations(self):
        self.assertEqual(len(self.reserve("first", "user1", "wallet1")), 1)
        self.assertEqual(self.reserve("repeat", "user1", "wallet1"), [])
        self.assertEqual(self.reserve("rotated", "user1", "wallet2"), [])
        self.assertEqual(self.reserve("relinked", "user2", "wallet1"), [])
        self.assertEqual(len(self.reserve("another", "user2", "wallet2")), 1)

    def test_partial_failure_keeps_uniqueness(self):
        self.reserve("first", "user1", "wallet1")
        self.db.execute("UPDATE faucet_allocations SET status='failed', phase='cash-submitted', hashes='[{}]' WHERE id='first'")
        self.assertEqual(self.reserve("retry", "user1", "wallet1"), [])
        self.assertEqual(self.db.execute("SELECT status, phase FROM faucet_allocations").fetchone(), ("failed", "cash-submitted"))

if __name__ == "__main__":
    unittest.main()
