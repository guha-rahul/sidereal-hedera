// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice ABI subset of Hashgraph ATS v4.1.0, commit 95c5bb7811422bbfae333d2a29489b10909a3dee.
/// @dev Source: packages/ats/contracts/contracts/layer_2/interfaces/bond/IBondRead.sol.
///      This is an external integration interface, not an ATS implementation.
interface IATSBond {
    struct BondDetailsData {
        bytes3 currency;
        uint256 nominalValue;
        uint8 nominalValueDecimals;
        uint256 startingDate;
        uint256 maturityDate;
    }

    struct Coupon {
        uint256 recordDate;
        uint256 executionDate;
        uint256 startDate;
        uint256 endDate;
        uint256 fixingDate;
        uint256 rate;
        uint8 rateDecimals;
        uint8 rateStatus;
    }

    struct RegisteredCoupon {
        Coupon coupon;
        uint256 snapshotId;
    }

    struct CouponFor {
        uint256 tokenBalance;
        uint8 decimals;
        bool recordDateReached;
        Coupon coupon;
    }

    struct CouponAmountFor {
        uint256 numerator;
        uint256 denominator;
        bool recordDateReached;
    }

    function getBondDetails() external view returns (BondDetailsData memory);
    function getCoupon(uint256 id) external view returns (RegisteredCoupon memory);
    function getCouponFor(uint256 id, address holder) external view returns (CouponFor memory);
    function getCouponAmountFor(uint256 id, address holder)
        external
        view
        returns (CouponAmountFor memory);
    function getCouponCount() external view returns (uint256);
    function getKycStatusFor(address holder) external view returns (uint8);
    function getControlListType() external view returns (bool);
    function isInControlList(address holder) external view returns (bool);
    function isPaused() external view returns (bool);
    function isAddressRecovered(address holder) external view returns (bool);
    function getFrozenTokens(address holder) external view returns (uint256);
    function triggerAndSyncAll(bytes32 partition, address from, address to) external;
}
