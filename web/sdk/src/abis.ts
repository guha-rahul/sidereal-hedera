// SPDX-License-Identifier: Apache-2.0

import { parseAbi } from "viem";

/**
 * Human-readable ABIs for the Hedera/EVM deployment. Kept local to the SDK so it
 * has no build-time dependency on the Foundry artifacts.
 */

export const erc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
]);

export const syVaultAbi = parseAbi([
  "function config() view returns (address admin, address underlying, address strategy)",
  "function strategy() view returns (address)",
  "function underlying() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function maxWithdraw() view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function shareBalance(address holder) view returns (uint256)",
  "function exchangeRate() view returns (uint256)",
  "function depositCap() view returns (uint256)",
  "function MINIMUM_SHARES() view returns (uint256)",
  "function previewDeposit(uint256 amount) view returns (uint256)",
  "function previewRedeem(uint256 syAmount) view returns (uint256)",
  "function accruedYield(address holder) view returns (uint256)",
  "function deposit(uint256 amount, uint256 minSyOut) returns (uint256)",
  "function redeem(uint256 syAmount, uint256 minUnderlyingOut) returns (uint256)",
  "function setDepositCap(address admin, uint256 cap)",
  "function touch()",
]);

export const principalTokenAbi = parseAbi([
  "function config() view returns (address admin, address tokenizer, address syToken, uint256 maturity)",
  "function maturity() view returns (uint256)",
  "function isMatured() view returns (bool)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount)",
  "function burnFrom(address from, uint256 amount)",
  "function burn(uint256 amount)",
]);

export const yieldTokenAbi = parseAbi([
  "function config() view returns (address admin, address tokenizer, address syToken, uint256 maturity)",
  "function maturity() view returns (uint256)",
  "function isMatured() view returns (bool)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function yieldBasis(address holder) view returns (uint256)",
  "function totalYieldBasis() view returns (uint256)",
  "function checkpoint(address holder) view returns (uint256)",
  "function accruedYield(address holder) view returns (uint256)",
  "function totalAccruedYield() view returns (uint256)",
  "function previewClaimYield(address holder) view returns (uint256)",
  "function mint(address to, uint256 amount)",
  "function settle(address holder, uint256 rate) returns (uint256)",
  "function consume(address holder, uint256 amount)",
  "function burnSetSettled(address from, uint256 amount, uint256 rate)",
  "function burn(uint256 amount)",
  "function burnFrom(address from, uint256 amount)",
]);

export const tokenizerAbi = parseAbi([
  "function config() view returns (address admin, address syToken, address ptToken, address ytToken, uint256 maturity, address feeRecipient, uint256 yieldFeeBps)",
  "function maturity() view returns (uint256)",
  "function isMatured() view returns (bool)",
  "function yieldFeeBps() view returns (uint256)",
  "function observeRate() returns (uint256)",
  "function freezeMaturityRate() returns (uint256)",
  "function effectiveRate() returns (uint256)",
  "function maturityRate() view returns (uint256)",
  "function lastObservedRate() view returns (uint256)",
  "function escrowedSy() view returns (uint256)",
  "function availableYieldSurplus() view returns (uint256)",
  "function previewSplit(uint256 syAmount) view returns (uint256 ptOut, uint256 ytOut)",
  "function previewRecombine(uint256 ptAmount, uint256 ytAmount) view returns (uint256)",
  "function position(address holder) view returns (uint256 ptBalance, uint256 ytBalance)",
  "function split(uint256 syAmount) returns (uint256 ptOut, uint256 ytOut)",
  "function recombine(uint256 ptAmount, uint256 ytAmount) returns (uint256 syOut)",
  "function redeemAtMaturity(uint256 ptAmount) returns (uint256 syOut)",
  "function claimYield() returns (uint256 net)",
  "function setFee(address admin, uint256 yieldFeeBps)",
]);

export const ammAbi = parseAbi([
  "function config() view returns (address admin, address ptToken, address syToken, address ytToken, address tokenizer, uint256 maturity, uint256 scalarRoot, uint256 initialAnchor, uint256 feeBps, uint256 twapWindow)",
  "function state() view returns (uint256 totalPt, uint256 totalSy, uint256 totalLp, int256 lastLnImpliedRate, int256 twapLnImpliedRate, uint256 lastObservation, uint256 warmupUntil)",
  "function reservePt() view returns (uint256)",
  "function reserveSy() view returns (uint256)",
  "function totalLp() view returns (uint256)",
  "function lpBalance(address holder) view returns (uint256)",
  "function maturity() view returns (uint256)",
  "function impliedApy() view returns (uint256)",
  "function spotApy() view returns (uint256)",
  "function twapApy() view returns (uint256)",
  "function twapWarmingUp() view returns (bool)",
  "function quotePtForSy(uint256 ptIn) view returns (uint256)",
  "function quoteSyForPt(uint256 syIn) view returns (uint256)",
  "function quoteSyForPtCost(uint256 syIn) view returns (uint256)",
  "function quoteSyForYt(uint256 syIn) view returns (uint256)",
  "function quoteSyForYtCost(uint256 syIn) view returns (uint256)",
  "function quoteYtForSy(uint256 ytIn) view returns (uint256)",
  "function swapPtForSy(uint256 ptIn, uint256 minSyOut) returns (uint256)",
  "function swapSyForPt(uint256 syIn, uint256 minPtOut) returns (uint256)",
  "function swapSyForYt(uint256 syIn, uint256 minYtOut) returns (uint256)",
  "function swapYtForSy(uint256 ytIn, uint256 minSyOut) returns (uint256)",
  "function addLiquidity(uint256 ptIn, uint256 syIn, uint256 minLpOut) returns (uint256)",
  "function removeLiquidity(uint256 lpIn, uint256 minPtOut, uint256 minSyOut) returns (uint256 ptOut, uint256 syOut)",
  "function setFee(address admin, uint256 feeBps)",
]);

export const orderbookAbi = parseAbi([
  "function config() view returns (address admin, address ptToken, address syToken, uint256 maturity, address feeRecipient, uint256 takerFeeBps)",
  "function maturity() view returns (uint256)",
  "function setFee(address admin, uint256 takerFeeBps)",
  "function getOrder(uint64 orderId) view returns (uint64 id, address maker, uint8 side, uint256 priceWad, uint256 originalBase, uint256 remainingBase, uint256 escrowRemaining, uint256 expiry, uint256 createdAt, uint64 prev, uint64 next, bool exists)",
  "function bestOrder(uint8 side) view returns (uint64 id, address maker, uint8 side, uint256 priceWad, uint256 originalBase, uint256 remainingBase, uint256 escrowRemaining, uint256 expiry, uint256 createdAt, uint64 prev, uint64 next, bool exists)",
  "function listOrders(uint8 side, uint64 cursor, uint32 limit) view returns ((uint64 id, address maker, uint8 side, uint256 priceWad, uint256 originalBase, uint256 remainingBase, uint256 escrowRemaining, uint256 expiry, uint256 createdAt, uint64 prev, uint64 next, bool exists)[])",
  "function openCount() view returns (uint64)",
  "function placeOrder(uint8 side, uint256 baseAmount, uint256 priceWad, uint256 expiry, uint64 predecessor) returns (uint64)",
  "function fillBest(uint8 restingSide, uint256 baseAmount, uint256 limitPriceWad) returns (uint64 orderId, address maker, address taker, uint8 side, uint256 baseFilled, uint256 quoteAmount, uint256 takerFee, uint256 remainingBase)",
  "function cancelOrder(uint64 orderId)",
  "function pruneExpired(uint8 side, uint32 maxOrders) returns (uint32)",
]);

export const bondAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function owner() view returns (address)",
  "function denomination() view returns (address)",
  "function identityRegistry() view returns (address)",
  "function compliance() view returns (address)",
  "function isVerified(address account) view returns (bool)",
  "function startDate() view returns (uint256)",
  "function maturity() view returns (uint256)",
  "function maturityDate() view returns (uint256)",
  "function isMatured() view returns (bool)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function valuePerUnit() view returns (uint256)",
  "function valueOf(uint256 bondAmount) view returns (uint256)",
  "function availableLiquidity() view returns (uint256)",
  "function issuePricePerUnit() view returns (uint256)",
  "function faceValuePerUnit() view returns (uint256)",
  "function nominalValue() view returns (uint256)",
  "function couponValuePerUnit() view returns (uint256)",
  "function purchase(uint256 cashIn) returns (uint256)",
  "function redeem(uint256 bondAmount) returns (uint256)",
  "function redeemAtMaturity(uint256 bondAmount) returns (uint256)",
  "function couponCount() view returns (uint256)",
  "function couponInfo(uint256 couponId) view returns (uint256 recordDate, uint256 executionDate, uint256 ratePerUnit, uint256 fundedAmount, uint256 totalSupplySnapshot, bool exists)",
  "function claimableCoupon(uint256 couponId, address holder) view returns (uint256)",
  "function couponTargetFunding(uint256 couponId) view returns (uint256)",
  "function couponClaimed(uint256 couponId, address holder) view returns (bool)",
  "function claimCoupon(uint256 couponId) returns (uint256)",
  "function scheduleCoupon(uint256 recordDate, uint256 executionDate, uint256 ratePerUnit) returns (uint256)",
  "function fundCoupon(uint256 couponId, uint256 amount)",
  "function fundPrincipal(uint256 amount)",
  "function distributeCoupon(uint256 cashAmount)",
  "function accrue()",
  "event Purchased(address indexed buyer, uint256 cashIn, uint256 bondOut)",
  "event Redeemed(address indexed holder, uint256 bondIn, uint256 cashOut)",
  "event CouponScheduled(uint256 indexed couponId, uint256 recordDate, uint256 executionDate, uint256 ratePerUnit)",
  "event CouponFunded(uint256 indexed couponId, uint256 amount)",
  "event CouponClaimed(uint256 indexed couponId, address indexed holder, uint256 cashOut)",
  "event PrincipalFunded(uint256 amount)",
]);

export const identityRegistryAbi = parseAbi([
  "function isVerified(address account) view returns (bool)",
]);

export const complianceAbi = parseAbi([
  "function canTransfer(address from, address to, uint256 amount) view returns (bool)",
]);

export const bondStrategyAbi = parseAbi([
  "function underlying() view returns (address)",
  "function vault() view returns (address)",
  "function bondToken() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function maxWithdraw() view returns (uint256)",
  "function accountedBonds() view returns (uint256)",
  "function countedCash() view returns (uint256)",
  "function deposit(address vault, uint256 amount) returns (uint256)",
  "function withdraw(address vault, uint256 amount, uint256 minUnderlyingOut) returns (uint256)",
  "function touch()",
]);
