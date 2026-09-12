// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {ProtocolTokenBase} from "./ProtocolTokenBase.sol";
import {ITokenizer} from "../interfaces/ITokenizer.sol";
import {IStandardizedYield} from "../interfaces/IStandardizedYield.sol";
import {WadMath} from "../libraries/WadMath.sol";

/// @title YieldToken (sYT)
/// @notice Captures everything the tokenizer's escrow earns above PT principal.
/// @dev The accounting engine is a
///      per-holder **yield basis** in SY shares, not a per-address rate: a
///      holder's claim at rate R is `basis - ceil(balance * WAD / R)`, and the
///      basis travels with the tokens so it splits and merges exactly. This
///      avoids the two failure modes of a rate checkpoint (re-opening a paid
///      interval on transfer, and stranding a new position's yield).
contract YieldToken is ProtocolTokenBase {
    using WadMath for uint256;

    error InvalidExchangeRate();
    error InsufficientBalance();
    error InsufficientAllowance();
    error ConsumeExceedsBanked();

    /// @dev SY shares backing a holder's YT face.
    mapping(address => uint256) private _basis;
    /// @dev SY shares banked to a holder but not yet claimed.
    mapping(address => uint256) private _accrued;
    uint256 private _totalBasis;
    uint256 private _totalAccrued;

    event Settled(address indexed holder, uint256 owed);
    event Consumed(address indexed holder, uint256 amount);

    constructor() ProtocolTokenBase("Sidereal Yield Token", "sYT") {}

    function initialize(
        address admin,
        address tokenizer,
        address syToken,
        uint256 maturity_
    ) external {
        _baseInitialize(admin, tokenizer, syToken, maturity_);
    }

    // --- yield accounting --------------------------------------------------

    /// @notice How many SY shares back `holder`'s YT face at its acquisition rate.
    function yieldBasis(address holder) public view returns (uint256) {
        return _basis[holder];
    }

    /// @notice Aggregate of every holder's basis, maintained by delta.
    function totalYieldBasis() external view returns (uint256) {
        return _totalBasis;
    }

    /// @notice The SY rate implied by a holder's basis (ceil(balance*WAD/basis)).
    function checkpoint(address holder) external view returns (uint256) {
        uint256 basis = _basis[holder];
        uint256 balance = balanceOf(holder);
        if (basis == 0 || balance == 0) return 0;
        return WadMath.mulDivUp(balance, WadMath.WAD, basis);
    }

    /// @notice SY shares already banked to `holder` but not yet claimed.
    function accruedYield(address holder) public view returns (uint256) {
        return _accrued[holder];
    }

    /// @notice Aggregate banked (settled, unclaimed) yield. This is a claim, not
    ///         a balance: cap every payout by the tokenizer's surplus.
    function totalAccruedYield() external view returns (uint256) {
        return _totalAccrued;
    }

    /// @notice Total SY claimable by `holder` right now, gross of the tokenizer's
    ///         PT-senior cap and yield fee.
    function previewClaimYield(address holder) external view returns (uint256) {
        uint256 rate = _previewRate();
        uint256 pending = _pendingYield(holder, rate);
        return _accrued[holder] + pending;
    }

    /// @notice Settles `holder` at the tokenizer-supplied rate and returns their
    ///         banked total without zeroing it. Restricted to the tokenizer.
    function settle(address holder, uint256 rate) external onlyTokenizer returns (uint256) {
        _settleIntoLedger(holder, rate);
        return _accrued[holder];
    }

    /// @notice Subtracts exactly `amount` from `holder`'s banked ledger.
    ///         Restricted to the tokenizer, which pushes the same amount of SY.
    function consume(address holder, uint256 amount) external onlyTokenizer {
        uint256 banked = _accrued[holder];
        if (amount > banked) revert ConsumeExceedsBanked();
        if (amount > 0) {
            _writeAccrued(holder, banked - amount);
            emit Consumed(holder, amount);
        }
    }

    // --- minter-privileged supply control (only the tokenizer) --------------

    /// @notice Mints `amount` YT to `to`. Restricted to the tokenizer.
    function mint(address to, uint256 amount) external onlyTokenizer {
        if (amount == 0) revert InvalidAmount();
        uint256 rate = _currentRate();
        _settleIntoLedger(to, rate);
        uint256 added = _sharesForFace(amount, rate);
        _writeBasis(to, _basis[to] + added);
        _mint(to, amount);
    }

    /// @notice Burns `amount` YT from `from`, settling them at `rate` first.
    ///         Restricted to the tokenizer, which calls this from recombine.
    function burnSetSettled(address from, uint256 amount, uint256 rate) external onlyTokenizer {
        if (amount == 0) revert InvalidAmount();
        _settleIntoLedger(from, rate);
        _burnPosition(from, amount);
    }

    // --- ERC-20 with yield transfer ----------------------------------------

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (amount == 0) revert InvalidAmount();
        uint256 rate = _committingRate();
        _settleIntoLedger(msg.sender, rate);
        _settleIntoLedger(to, rate);
        _movePosition(msg.sender, to, amount);
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (amount == 0) revert InvalidAmount();
        uint256 rate = _committingRate();
        _settleIntoLedger(from, rate);
        _settleIntoLedger(to, rate);
        _movePosition(from, to, amount);
        return super.transferFrom(from, to, amount);
    }

    /// @notice Burns the caller's own YT, settling them first.
    function burn(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        uint256 rate = _committingRate();
        _settleIntoLedger(msg.sender, rate);
        _burnPosition(msg.sender, amount);
    }

    /// @notice Burns `amount` YT from `from` against the caller's allowance.
    function burnFrom(address from, uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        uint256 rate = _committingRate();
        _settleIntoLedger(from, rate);
        _spendAllowance(from, msg.sender, amount);
        _burnPosition(from, amount);
    }

    // --- rate sourcing ------------------------------------------------------

    function _currentRate() internal view returns (uint256) {
        return IStandardizedYield(config.syToken).exchangeRate();
    }

    /// @dev The rate a state-committing settle uses on a path entered directly by
    ///      a holder. Both branches go through the tokenizer so every rate YT
    ///      banks yield at is also on record for the maturity freeze.
    function _committingRate() internal returns (uint256) {
        if (block.timestamp < config.maturity) {
            return ITokenizer(config.tokenizer).observeRate();
        }
        return ITokenizer(config.tokenizer).freezeMaturityRate();
    }

    /// @dev Read-only preview rate. Post-maturity uses the tokenizer's frozen
    ///      rate once snapshotted, else the live rate as a best estimate.
    function _previewRate() internal view returns (uint256) {
        if (block.timestamp < config.maturity) return _currentRate();
        uint256 frozen = ITokenizer(config.tokenizer).maturityRate();
        return frozen > 0 ? frozen : _currentRate();
    }

    // --- yield engine -------------------------------------------------------

    /// @dev ceil(face * WAD / rate). Rounding up is escrow-favoring on both
    ///      sides: it shrinks recognized yield and reserves at least the SY the
    ///      tokenizer escrowed.
    function _sharesForFace(uint256 face, uint256 rate) internal pure returns (uint256) {
        if (rate == 0) revert InvalidExchangeRate();
        if (face == 0) return 0;
        return WadMath.mulDivUp(face, WadMath.WAD, rate);
    }

    function _pendingYield(address holder, uint256 rate) internal view returns (uint256) {
        uint256 balance = balanceOf(holder);
        if (balance == 0) return 0;
        uint256 required = _sharesForFace(balance, rate);
        uint256 basis = _basis[holder];
        return basis > required ? basis - required : 0;
    }

    /// @dev Banks the holder's yield up to `rate` and re-strikes their basis at
    ///      `rate`. `newBasis + owed == oldBasis` exactly, so yield telescopes
    ///      across intermediate settlements. On a rate dip the basis is held,
    ///      not lowered.
    function _settleIntoLedger(address holder, uint256 rate) internal {
        uint256 balance = balanceOf(holder);
        if (balance == 0) return;
        uint256 basis = _basis[holder];
        uint256 required = _sharesForFace(balance, rate);
        if (basis <= required) return;

        uint256 owed = basis - required;
        _writeBasis(holder, required);
        _writeAccrued(holder, _accrued[holder] + owed);
        emit Settled(holder, owed);
    }

    function _writeBasis(address holder, uint256 amount) internal {
        uint256 previous = _basis[holder];
        _basis[holder] = amount;
        if (amount >= previous) {
            _totalBasis += amount - previous;
        } else {
            _totalBasis -= previous - amount;
        }
    }

    function _writeAccrued(address holder, uint256 amount) internal {
        uint256 previous = _accrued[holder];
        _accrued[holder] = amount;
        if (amount >= previous) {
            _totalAccrued += amount - previous;
        } else {
            _totalAccrued -= previous - amount;
        }
    }

    /// @dev Moves `amount` YT and the basis backing it. Both parties are settled
    ///      before this runs, so the pro-rata slice is exact for the common case.
    function _movePosition(address from, address to, uint256 amount) internal {
        uint256 fromBalance = balanceOf(from);
        if (fromBalance < amount) revert InsufficientBalance();
        uint256 fromBasis = _basis[from];
        uint256 moved = _basisSlice(fromBasis, amount, fromBalance);
        _writeBasis(from, fromBasis - moved);
        _writeBasis(to, _basis[to] + moved);
    }

    function _burnPosition(address from, uint256 amount) internal {
        uint256 fromBalance = balanceOf(from);
        if (fromBalance < amount) revert InsufficientBalance();
        uint256 fromBasis = _basis[from];
        uint256 retired = _basisSlice(fromBasis, amount, fromBalance);
        _writeBasis(from, fromBasis - retired);
        _burn(from, amount);
    }

    /// @dev The basis backing `amount` out of a `balance`-sized position, rounded
    ///      up and never more than the whole basis. Exact when the whole position
    ///      moves.
    function _basisSlice(
        uint256 basis,
        uint256 amount,
        uint256 balance
    ) internal pure returns (uint256) {
        if (basis == 0 || amount == 0 || balance == 0) return 0;
        if (amount >= balance) return basis;
        uint256 slice = WadMath.mulDivUp(basis, amount, balance);
        return slice > basis ? basis : slice;
    }
}
