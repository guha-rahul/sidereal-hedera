// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;
import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IATSBond} from "../src/interfaces/IATSBond.sol";
import {IATSFactory, IATSAdmin} from "./ats/IATSFactory.sol";
import {DemoCash} from "./ats/DemoCash.sol";
import {ATSBondAdapter} from "../src/sy/ATSBondAdapter.sol";
import {ERC3643BondStrategy} from "../src/sy/ERC3643BondStrategy.sol";
import {StandardizedYieldVault} from "../src/sy/StandardizedYieldVault.sol";
import {Tokenizer} from "../src/Tokenizer.sol";
import {PrincipalToken} from "../src/tokens/PrincipalToken.sol";
import {YieldToken} from "../src/tokens/YieldToken.sol";
import {AmmMarket} from "../src/AmmMarket.sol";
import {Orderbook} from "../src/Orderbook.sol";

contract DeployATS is Script {
    address public constant FACTORY = 0x5fA65CA30d1984701F10476664327f97c864A9D3;
    address public constant RESOLVER = 0xEFEF4CAe9642631Cfc6d997D6207Ee48fa78fe42;
    struct Market {
        address issuer; address buyer; address security; address cash; address adapter;
        address strategy; address sy; address pt; address yt; address tokenizer;
        address amm; address orderbook; uint256 maturity; uint256 recordDate; uint256 executionDate;
        uint256 startingDate;
    }
    function run() external returns (Market memory market) {
        require(block.chainid == 296, "Hedera testnet only");
        uint256 key = vm.envUint("PRIVATE_KEY");
        address issuer = vm.addr(key);
        address buyer = vm.envAddress("BUYER_ADDRESS");
        require(buyer != issuer && buyer != address(0), "distinct buyer required");
        uint256 term = vm.envOr("TERM_SECONDS", uint256(90 days));
        uint256 recordDelay = vm.envOr("RECORD_DELAY_SECONDS", uint256(1 hours));
        vm.startBroadcast(key);
        market = _deploy(issuer, buyer, term, recordDelay);
        vm.stopBroadcast();
        _manifest(market, vm.envOr("MANIFEST_PATH", string("deployments/hedera-ats.json")));
        console2.log("ATS security", market.security);
        console2.log("Settlement adapter (BOND)", market.adapter);
        console2.log("Cash: TESTNET sdUSD, NOT USDC", market.cash);
    }

    function _deploy(address issuer, address buyer, uint256 term, uint256 recordDelay) internal returns (Market memory m) {
        // ATS bond initialization reverts WrongTimestamp(startingDate) unless the
        // starting date is strictly greater than block.timestamp. Verified against
        // factory 0x5fA65C... at Hedera testnet block 40433521: offset 0 reverts,
        // offsets of 1s and above are accepted. Broadcast latency makes a 1s offset
        // unsafe, so default to a minute and keep the record date after the start.
        uint256 startDelay = vm.envOr("START_DELAY_SECONDS", uint256(60));
        require(startDelay >= 1, "startingDate must be in the future");
        require(recordDelay > startDelay && term > recordDelay + 300, "invalid lifecycle timing");
        m.issuer = issuer; m.buyer = buyer;
        m.startingDate = block.timestamp + startDelay;
        m.maturity = block.timestamp + term;
        m.recordDate = block.timestamp + recordDelay;
        m.executionDate = m.recordDate + 300;
        IATSFactory.SecurityData memory security;
        security.resolver = RESOLVER;
        security.resolverProxyConfiguration = IATSFactory.Configuration(bytes32(uint256(2)), 1);
        security.isControllable = true;
        security.internalKycActivated = true;
        security.maxSupply = 10_000e6;
        security.erc20MetadataInfo = IATSFactory.Metadata("Sidereal ATS Demo Bond", "sBOND", "US0000000002", 6);
        security.externalPauses = new address[](0);
        security.externalControlLists = new address[](0);
        security.externalKycLists = new address[](0);
        bytes32[] memory roles = new bytes32[](6);
        roles[0] = bytes32(0);
        roles[1] = keccak256("security.token.standard.role.issuer");
        roles[2] = keccak256("security.token.standard.role.corporateAction");
        roles[3] = keccak256("security.token.standard.role.ssi.manager");
        roles[4] = keccak256("security.token.standard.role.kyc");
        roles[5] = keccak256("security.token.standard.role.controlList");
        security.rbacs = new IATSFactory.Rbac[](roles.length);
        for (uint256 i; i < roles.length; i++) {
            address[] memory members = new address[](1); members[0] = issuer;
            security.rbacs[i] = IATSFactory.Rbac(roles[i], members);
        }
        IATSFactory.BondData memory data = IATSFactory.BondData(security,
            IATSBond.BondDetailsData("USD", 100, 2, m.startingDate, m.maturity), new address[](0), new bytes[](0));
        IATSFactory.Regulation memory regulation = IATSFactory.Regulation(1, 0,
            IATSFactory.AdditionalData(false, "", "TESTNET DEMONSTRATION ONLY. No real security or investment offered."));
        m.security = IATSFactory(FACTORY).deployBond(data, regulation);
        // A 10% cash coupon over the short illustrative interval. This annualized
        // test rate is deliberately synthetic and must not be advertised as yield.
        // The accrual window runs from the bond start to the payment date, so derive
        // the annualized rate from that same window to keep the illustrative 10%.
        uint256 couponRate = (10_000_000 * 365 days) / (m.executionDate - m.startingDate);
        IATSAdmin(m.security).setCoupon(IATSBond.Coupon(m.recordDate, m.executionDate,
            m.startingDate, m.executionDate, m.startingDate, couponRate, 8, 1));
        m.cash = address(new DemoCash(issuer, 100_000e6));
        m.adapter = address(new ATSBondAdapter(m.security, m.cash, issuer, 950_000));
        m.sy = address(new StandardizedYieldVault());
        m.strategy = address(new ERC3643BondStrategy(m.sy, m.adapter));
        StandardizedYieldVault(m.sy).initialize(issuer, m.strategy);
        ATSBondAdapter(m.adapter).bindStrategy(m.strategy);
        m.pt = address(new PrincipalToken()); m.yt = address(new YieldToken());
        m.tokenizer = address(new Tokenizer());
        Tokenizer(m.tokenizer).initialize(issuer, m.sy, m.pt, m.yt, m.maturity, issuer, 0);
        PrincipalToken(m.pt).initialize(issuer, m.tokenizer, m.sy, m.maturity);
        YieldToken(m.yt).initialize(issuer, m.tokenizer, m.sy, m.maturity);
        m.amm = address(new AmmMarket());
        AmmMarket(m.amm).initialize(issuer, m.pt, m.sy, m.yt, m.tokenizer, m.maturity, 1e18, 1e18, 10, 30);
        m.orderbook = address(new Orderbook());
        Orderbook(m.orderbook).initialize(issuer, m.pt, m.sy, m.maturity, issuer, 10);
        IATSAdmin(m.security).addIssuer(issuer);
        address[10] memory holders = [issuer,buyer,m.adapter,m.strategy,m.sy,m.pt,m.yt,m.tokenizer,m.amm,m.orderbook];
        for (uint256 i; i < holders.length; i++) {
            IATSAdmin(m.security).grantKyc(holders[i], "testnet-demo-eligibility", 0, m.maturity + 365 days, issuer);
        }
        IATSAdmin(m.security).issue(m.adapter, 10_000e6, "");
        IERC20(m.cash).approve(m.adapter, 3_000e6);
        ATSBondAdapter(m.adapter).fundPrincipal(1_500e6);
        ATSBondAdapter(m.adapter).fundCoupon(0, 1_500e6);
        IERC20(m.cash).transfer(buyer, 5_000e6);
        require(IATSBond(m.security).getBondDetails().maturityDate == m.maturity, "maturity mismatch");
        require(ATSBondAdapter(m.adapter).isVerified(buyer), "KYC not active");
    }

    function _manifest(Market memory m, string memory path) internal {
        string memory key = "ats-market";
        vm.serializeUint(key,"chainId",block.chainid);
        vm.serializeString(key,"network","hedera-testnet");
        vm.serializeString(key,"status","addresses-only-until-receipts-verified");
        vm.serializeString(key,"cashLabel","sdUSD: testnet demonstration token, not USDC");
        vm.serializeAddress(key,"factory",FACTORY); vm.serializeAddress(key,"resolver",RESOLVER);
        vm.serializeAddress(key,"issuer",m.issuer); vm.serializeAddress(key,"buyer",m.buyer);
        vm.serializeAddress(key,"security",m.security); vm.serializeAddress(key,"cash",m.cash);
        vm.serializeAddress(key,"bond",m.adapter); vm.serializeAddress(key,"adapter",m.adapter);
        vm.serializeAddress(key,"strategy",m.strategy); vm.serializeAddress(key,"sy",m.sy);
        vm.serializeAddress(key,"pt",m.pt); vm.serializeAddress(key,"yt",m.yt);
        vm.serializeAddress(key,"tokenizer",m.tokenizer); vm.serializeAddress(key,"amm",m.amm);
        vm.serializeAddress(key,"orderbook",m.orderbook);
        vm.serializeUint(key,"startingDate",m.startingDate);
        vm.serializeUint(key,"maturity",m.maturity); vm.serializeUint(key,"recordDate",m.recordDate);
        vm.serializeUint(key,"cashDecimals",6); vm.serializeUint(key,"bondDecimals",6);
        string memory json = vm.serializeUint(key,"executionDate",m.executionDate);
        vm.writeJson(json,path);
    }
}
