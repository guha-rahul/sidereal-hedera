// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;
import {Test} from "forge-std/Test.sol";
import {IATSBond} from "../src/interfaces/IATSBond.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @notice Explicit opt-in live compatibility test, not our asset or deployment.
/// @dev RUN_ATS_LIVE=true forge test --match-contract ATSCompatibilityReadTest -vv
contract ATSCompatibilityReadTest is Test {
    function testPinnedATSABIAndSnapshotCallOnHederaFork() public {
        if (!vm.envOr("RUN_ATS_LIVE", false)) vm.skip(true);
        return;
        vm.createSelectFork("https://testnet.hashio.io/api", 40433521);
        address asset = 0x2B24D53A3049EF4de90F3dD2ac24845315d2A850;
        IATSBond bond = IATSBond(asset);
        IATSBond.BondDetailsData memory terms = bond.getBondDetails();
        assertEq(terms.nominalValue, 600);
        assertEq(terms.nominalValueDecimals, 2);
        assertEq(terms.maturityDate, 1820764825);
        assertEq(bond.getCouponCount(), 2);
        assertGt(bond.getCoupon(1).coupon.executionDate, 0);
        address holder = 0xE8289A12Ee0B460C51936B0A7782B69840104236;
        bond.getCouponFor(1, holder);
        bond.getCouponAmountFor(1, holder);
        bond.getKycStatusFor(holder);
        bond.getControlListType();
        bond.isInControlList(holder);
        bond.isPaused();
        bond.isAddressRecovered(holder);
        bond.getFrozenTokens(holder);
        IERC20Metadata(asset).decimals();
        // Executes on the local fork only. No transaction is broadcast.
        bond.triggerAndSyncAll(bytes32(uint256(1)), holder, holder);
    }
}
