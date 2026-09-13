#!/usr/bin/env python3
"""Compare a market's deployment inputs and runtime code with Foundry artifacts.

Read-only JSON-RPC calls; no wallet credentials or broadcasts are used.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time
import urllib.request


def rpc(url, method, params):
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, payload, {
                "Content-Type": "application/json", "User-Agent": "sidereal-bytecode-check/1.0"})
            with urllib.request.urlopen(request, timeout=30) as response:
                result = json.load(response)
            if "error" in result:
                raise RuntimeError(result["error"])
            if result.get("result") is None:
                raise RuntimeError(f"No result for {method}")
            return result["result"]
        except (OSError, RuntimeError):
            if attempt == 3:
                raise
            time.sleep(attempt + 1)


def normalized_runtime(code, references):
    data = bytearray.fromhex(code.removeprefix("0x"))
    for entries in references.values():
        for entry in entries:
            start, length = entry["start"], entry["length"]
            if start + length > len(data):
                raise ValueError("Immutable reference exceeds runtime bytecode")
            data[start:start + length] = bytes(length)
    return bytes(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", type=Path, default=Path("out"))
    parser.add_argument("--evidence", type=Path, default=Path("deployments/evidence/owned-deploy.json"))
    parser.add_argument("--rpc-url", default="https://testnet.hashio.io/api")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    evidence = json.loads(args.evidence.read_text())
    chain = int(rpc(args.rpc_url, "eth_chainId", []), 16)
    if chain != evidence["chainId"]:
        raise SystemExit("RPC chain does not match deployment evidence")
    block = rpc(args.rpc_url, "eth_blockNumber", [])
    report = {"chainId": chain, "blockNumber": int(block, 16), "contracts": [],
              "scope": "Sidereal contracts only; upstream ATS factory, resolver and security are excluded."}
    for entry in evidence["receipts"]:
        name = entry.get("contractName")
        if not name or entry.get("function") is not None:
            continue
        paths = list(args.artifacts.glob(f"{name}.sol/{name}.json"))
        if len(paths) != 1:
            raise SystemExit(f"Expected one artifact for {name}, got {len(paths)}")
        artifact = json.loads(paths[0].read_text())
        tx = rpc(args.rpc_url, "eth_getTransactionByHash", [entry["hash"]])
        receipt = rpc(args.rpc_url, "eth_getTransactionReceipt", [entry["hash"]])
        address = entry["receipt"]["contractAddress"]
        if (tx.get("to") is not None or int(receipt["status"], 16) != 1
                or receipt["contractAddress"].lower() != address.lower()):
            raise SystemExit(f"Invalid creation receipt for {name}")
        runtime = rpc(args.rpc_url, "eth_getCode", [address, block])
        creation = artifact["bytecode"]["object"].lower()
        expected = artifact["deployedBytecode"]
        references = expected.get("immutableReferences", {})
        creation_match = tx["input"].lower().startswith(creation) and creation != "0x"
        runtime_match = (len(runtime) == len(expected["object"]) and
                         normalized_runtime(runtime, references) ==
                         normalized_runtime(expected["object"], references))
        row = {"contract": name, "address": address, "creationTransaction": entry["hash"],
               "creationBytecodeMatches": creation_match, "runtimeMatchesOutsideImmutables": runtime_match,
               "runtimeSha256": hashlib.sha256(bytes.fromhex(runtime[2:])).hexdigest(),
               "immutableReferenceCount": sum(len(v) for v in references.values()),
               "compiler": artifact["metadata"]["compiler"],
               "settings": artifact["metadata"]["settings"],
               "sourceHashes": {path: source["keccak256"] for path, source in artifact["metadata"]["sources"].items()}}
        if creation_match:
            row["constructorArguments"] = "0x" + tx["input"][len(creation):]
        report["contracts"].append(row)
        print(f"{name}: creation={'MATCH' if creation_match else 'MISMATCH'}, runtime={'MATCH' if runtime_match else 'MISMATCH'}", flush=True)
    if not report["contracts"]:
        raise SystemExit("No creation receipts found")
    report["status"] = "matched" if all(row["creationBytecodeMatches"] and row["runtimeMatchesOutsideImmutables"] for row in report["contracts"]) else "mismatch"
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    if report["status"] != "matched":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
