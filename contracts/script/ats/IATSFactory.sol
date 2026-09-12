// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;
import {IATSBond} from "../../src/interfaces/IATSBond.sol";

/// @notice Deployment ABI from ATS v4.1.0, 95c5bb7811422bbfae333d2a29489b10909a3dee.
interface IATSFactory {
    struct Rbac { bytes32 role; address[] members; }
    struct Configuration { bytes32 key; uint256 version; }
    struct Metadata { string name; string symbol; string isin; uint8 decimals; }
    struct SecurityData {
        bool arePartitionsProtected;
        bool isMultiPartition;
        address resolver;
        Configuration resolverProxyConfiguration;
        Rbac[] rbacs;
        bool isControllable;
        bool isWhiteList;
        uint256 maxSupply;
        Metadata erc20MetadataInfo;
        bool clearingActive;
        bool internalKycActivated;
        address[] externalPauses;
        address[] externalControlLists;
        address[] externalKycLists;
        bool erc20VotesActivated;
        address compliance;
        address identityRegistry;
    }
    struct BondData {
        SecurityData security;
        IATSBond.BondDetailsData bondDetails;
        address[] proceedRecipients;
        bytes[] proceedRecipientsData;
    }
    struct AdditionalData { bool countriesControlListType; string listOfCountries; string info; }
    struct Regulation { uint8 regulationType; uint8 regulationSubType; AdditionalData additionalSecurityData; }
    function deployBond(BondData calldata bond, Regulation calldata regulation) external returns (address);
}

interface IATSAdmin {
    function setCoupon(IATSBond.Coupon calldata coupon) external returns (uint256);
    function addIssuer(address issuer) external returns (bool);
    function grantKyc(address account, string calldata vcId, uint256 validFrom, uint256 validTo, address issuer) external returns (bool);
    function revokeKyc(address account) external returns (bool);
    function issue(address account, uint256 amount, bytes calldata data) external;
    function grantRole(bytes32 role, address member) external;
    function getConfigInfo() external view returns (address, bytes32, uint256);
}
