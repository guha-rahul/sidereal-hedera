#!/usr/bin/env python3
"""Read-only, block-pinned receipt and balance evidence. Never signs transactions."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
ROLES = ('issuer', 'buyer', 'adapter', 'strategy', 'sy', 'pt', 'yt', 'tokenizer', 'amm', 'orderbook')
TOKENS = ('cash', 'security', 'sy', 'pt', 'yt')


def rpc(url, method, params):
    # Use the same transport as Foundry: Hashio may reject Python's HTTP client.
    for attempt in range(3):
        result = subprocess.run(
            ['cast', 'rpc', '--rpc-url', url, '--rpc-timeout', '60', '--raw', method,
             json.dumps(params)],
            capture_output=True, text=True, timeout=70, check=False)
        if result.returncode == 0:
            return json.loads(result.stdout)
        if attempt < 2:
            time.sleep(1 << attempt)
    detail = result.stderr.strip().splitlines()[-1] if result.stderr.strip() else 'no RPC detail'
    raise ValueError(f'{method}: RPC request failed after 3 attempts: {detail}')



def validate_receipt(receipt, transaction, txhash, addresses, block):
    if not receipt or not transaction:
        raise ValueError(f'{txhash}: transaction not mined or unavailable')
    if receipt['transactionHash'].lower() != txhash.lower() or transaction['hash'].lower() != txhash.lower():
        raise ValueError('receipt/transaction hash mismatch')
    if int(receipt['status'], 16) != 1:
        raise ValueError(f'{txhash}: reverted transaction')
    if int(receipt['blockNumber'], 16) > block:
        raise ValueError('receipt is newer than snapshot')
    target = (transaction.get('to') or receipt.get('contractAddress') or '').lower()
    if target not in addresses:
        raise ValueError(f'{txhash}: transaction is unrelated to this manifest')


def collect(args):
    manifest = json.loads(args.manifest.read_text())
    if manifest['chainId'] != 296 or int(rpc(args.rpc, 'eth_chainId', []), 16) != 296:
        raise ValueError('requires Hedera testnet chain 296')
    for role in (*ROLES, 'security', 'cash', 'factory', 'resolver'):
        if not re.fullmatch(r'0x[0-9a-fA-F]{40}', manifest[role]) or int(manifest[role], 16) == 0:
            raise ValueError(f'invalid address: {role}')
    block = rpc(args.rpc, 'eth_getBlockByNumber', [hex(args.block) if args.block else 'latest', False])
    number = int(block['number'], 16)
    tag = hex(number)
    addresses = {manifest[r].lower() for r in (*ROLES, 'security', 'cash', 'factory', 'resolver')}
    def call(role, signature, *params):
        data = subprocess.check_output(['cast', 'calldata', signature, *params], text=True).strip()
        return rpc(args.rpc, 'eth_call', [{'to': manifest[role], 'data': data}, tag])
    code_hashes = {}
    for role in (*TOKENS, 'adapter', 'strategy', 'tokenizer', 'amm', 'orderbook', 'factory', 'resolver'):
        code = rpc(args.rpc, 'eth_getCode', [manifest[role], tag])
        if code == '0x':
            raise ValueError(f'{role}: no deployed code')
        code_hashes[role] = hashlib.sha256(bytes.fromhex(code[2:])).hexdigest()
    for role in ('adapter', 'strategy'):
        if '0x' + call(role, 'securityToken()')[-40:].lower() != manifest['security'].lower():
            raise ValueError(f'{role}: wrong ATS security')
    for role in ('adapter', 'strategy', 'sy', 'pt', 'yt', 'tokenizer', 'amm', 'orderbook'):
        if int(call(role, 'maturity()'), 16) != manifest['maturity']:
            raise ValueError(f'{role}: maturity mismatch')
    balances, decimals = {}, {}
    for token in TOKENS:
        decimals[token] = int(call(token, 'decimals()'), 16)
        expected = manifest['cashDecimals'] if token == 'cash' else manifest['bondDecimals'] if token == 'security' else 18
        if decimals[token] != expected:
            raise ValueError(f'{token}: decimals mismatch')
        balances[token] = {role: str(int(call(token, 'balanceOf(address)', manifest[role]), 16)) for role in ROLES}
    accounting = {}
    for role, signature, params in (
        ('adapter', 'principalReserve()', []),
        ('adapter', 'couponReserve(uint256)', ['0']),
        ('adapter', 'couponFunding(uint256)', ['0']),
        ('adapter', 'couponClaimed(uint256)', ['0']),
        ('strategy', 'accountedBonds()', []),
        ('strategy', 'countedCash()', []),
        ('strategy', 'totalAssets()', []),
        ('sy', 'exchangeRate()', []),
        ('sy', 'totalSupply()', []),
        ('pt', 'totalSupply()', []),
        ('yt', 'totalSupply()', []),
        ('amm', 'reservePt()', []),
        ('amm', 'reserveSy()', []),
    ):
        accounting[f'{role}.{signature}'] = str(int(call(role, signature, *params), 16))
    receipts = []
    if args.broadcast:
        broadcast = json.loads(args.broadcast.read_text())
        if broadcast.get('chain') != 296 or broadcast.get('pending'):
            raise ValueError('broadcast must be completed on chain 296')
        mined = broadcast.get('receipts', [])
        if not mined or len(mined) != len(broadcast.get('transactions', [])):
            raise ValueError('broadcast is missing transaction receipts')
        args.tx.extend(r['transactionHash'] for r in mined)
    for txhash in dict.fromkeys(args.tx):
        if not re.fullmatch(r'0x[0-9a-fA-F]{64}', txhash):
            raise ValueError('invalid transaction hash')
        receipt = rpc(args.rpc, 'eth_getTransactionReceipt', [txhash])
        tx = rpc(args.rpc, 'eth_getTransactionByHash', [txhash])
        validate_receipt(receipt, tx, txhash, addresses, number)
        receipt_block = rpc(args.rpc, 'eth_getBlockByNumber', [receipt['blockNumber'], False])
        if receipt_block['hash'].lower() != receipt['blockHash'].lower():
            raise ValueError('receipt is not in the canonical block')
        receipts.append({'receipt': receipt, 'from': tx['from'], 'to': tx.get('to'), 'input': tx['input'],
                         'explorer': f'https://hashscan.io/testnet/transaction/{txhash}'})
    report = {
        'status': 'observed-state-and-supplied-receipts-only',
        'limitations': 'Does not prove source verification, factory issuance provenance, or an entire lifecycle. Inspect transaction inputs/events and capture each phase separately.',
        'chainId': 296, 'blockNumber': number, 'blockHash': block['hash'],
        'timestamp': int(block['timestamp'], 16), 'phase': args.phase, 'manifest': manifest,
        'balancesRaw': balances, 'decimals': decimals, 'runtimeCodeSha256': code_hashes,
        'receipts': receipts, 'accountingRaw': accounting,
        'localSourceCommitAtCollection': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'localContractsDirtyAtCollection': bool(subprocess.check_output(['git', 'status', '--porcelain', '--', '.'], cwd=ROOT, text=True).strip()),
        'dependencyLock': json.loads((ROOT / 'dependencies.lock.json').read_text()),
        'compilerSettingsAtCollection': (ROOT / 'foundry.toml').read_text(),
    }
    if args.before:
        before = json.loads(args.before.read_text())
        identity = (*ROLES, *TOKENS, 'factory', 'resolver', 'chainId', 'maturity', 'recordDate', 'executionDate', 'cashDecimals', 'bondDecimals')
        if any(before['manifest'].get(k) != manifest.get(k) for k in identity) or before['chainId'] != 296 or before['blockNumber'] > number:
            raise ValueError('before snapshot must be for this manifest and an earlier block')
        report['balanceDeltasRaw'] = {t: {r: str(int(balances[t][r]) - int(before['balancesRaw'][t][r])) for r in ROLES} for t in TOKENS}
        # Deduplicate addresses: role aliases must not double-count cash.
        unique_roles = {manifest[r].lower(): r for r in ROLES}.values()
        report['trackedCashDeltaRaw'] = str(sum(int(report['balanceDeltasRaw']['cash'][r]) for r in unique_roles))
        report['reconciliationNote'] = 'Cash deltas cover listed addresses only; zero sum is conservation, not proof that each payment is correct.'
    if rpc(args.rpc, 'eth_getBlockByNumber', [tag, False])['hash'] != block['hash']:
        raise ValueError('snapshot block changed during collection; retry')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x') as out:
        json.dump(report, out, indent=2)
        out.write('\n')
    print(f'Wrote {args.output}: block {number}, {len(receipts)} successful related receipts')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--rpc', default='https://testnet.hashio.io/api')
    parser.add_argument('--block', type=int)
    parser.add_argument('--phase', required=True)
    parser.add_argument('--tx', action='append', default=[], help='Repeat for every transaction hash in the phase')
    parser.add_argument('--broadcast', type=Path, help='Completed Foundry broadcast file; fetch every receipt again from RPC')
    parser.add_argument('--before', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    collect(parser.parse_args())
