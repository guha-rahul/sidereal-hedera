import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('evidence', Path(__file__).resolve().parents[1] / 'collect-ats-evidence.py')
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)


class ReceiptEvidenceTest(unittest.TestCase):
    def setUp(self):
        self.hash = '0x' + '1' * 64
        self.address = '0x' + '2' * 40
        self.receipt = {'transactionHash': self.hash, 'status': '0x1', 'blockNumber': '0xa'}
        self.tx = {'hash': self.hash, 'to': self.address}

    def verify(self):
        evidence.validate_receipt(self.receipt, self.tx, self.hash, {self.address}, 10)

    def test_successful_related_receipt(self):
        self.verify()

    def test_reverted_receipt_rejected(self):
        self.receipt['status'] = '0x0'
        with self.assertRaisesRegex(ValueError, 'reverted'):
            self.verify()

    def test_unrelated_success_is_not_evidence(self):
        self.tx['to'] = '0x' + '3' * 40
        with self.assertRaisesRegex(ValueError, 'unrelated'):
            self.verify()

    def test_receipt_newer_than_snapshot_rejected(self):
        self.receipt['blockNumber'] = '0xb'
        with self.assertRaisesRegex(ValueError, 'newer'):
            self.verify()

    def test_unmined_transaction_rejected(self):
        self.receipt = None
        with self.assertRaisesRegex(ValueError, 'not mined'):
            self.verify()

    def test_creation_receipt_requires_manifest_address(self):
        self.tx['to'] = None
        self.receipt['contractAddress'] = self.address
        self.verify()


if __name__ == '__main__':
    unittest.main()
