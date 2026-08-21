import test from "node:test";
import assert from "node:assert/strict";
import { DELIVERY_TERMS, suggestionsForTerm, termsForMode } from "../../shared/terms.js";
import { validateAgreementInput, validateProposalMilestones } from "../src/validation.js";

const address = (last: string) => `0x${last.repeat(40)}`;
const baseAgreement = () => ({
  buyerAddress: address("1"), sellerAddress: address("2"), arbitrationAddress: address("3"), operatorAddress: address("4"), createdBy: address("1"), resolutionPolicy: "ARCTRADE_DEFAULT",
  totalUSDC: "12500.00", negotiationExpiry: "2030-01-02T00:00:00.000Z", deliveryDeadline: "2030-02-02T00:00:00.000Z", commitmentWindowSec: 86400, arbitrationTimeoutSec: 172800,
  goodsDescription: "Grade A cocoa beans", transportMode: "sea", originCountry: "GH", originPortCity: "Tema", destinationCountry: "NL", destinationPortCity: "Rotterdam", freightArranger: "seller", insuranceArranger: "seller"
});

test("trade value is required and must be greater than zero", () => {
  assert.equal(validateAgreementInput({ ...baseAgreement(), totalUSDC: "0" }, new Date("2029-01-01")).ok, false);
  assert.equal(validateAgreementInput({ ...baseAgreement(), totalUSDC: "" }, new Date("2029-01-01")).ok, false);
  assert.equal(validateAgreementInput({ ...baseAgreement(), totalUSDC: "1.25" }, new Date("2029-01-01")).ok, true);
});

test("resolution policy separates the router from an optional nominated resolver", () => {
  assert.equal(validateAgreementInput({ ...baseAgreement() }, new Date("2029-01-01")).ok, true);
  assert.equal(validateAgreementInput({ ...baseAgreement(), resolutionPolicy: "MUTUAL_RESOLVER", assignedResolverAddress: address("5") }, new Date("2029-01-01")).ok, true);
  assert.equal(validateAgreementInput({ ...baseAgreement(), resolutionPolicy: "MUTUAL_RESOLVER" }, new Date("2029-01-01")).ok, true);
  assert.equal(validateAgreementInput({ ...baseAgreement(), assignedResolverAddress: address("5") }, new Date("2029-01-01")).ok, false);
  assert.equal(validateAgreementInput({ ...baseAgreement(), resolutionPolicy: "MUTUAL_RESOLVER", assignedResolverAddress: address("1") }, new Date("2029-01-01")).ok, false);
});

test("sea-only delivery terms are absent for non-sea modes", () => {
  const nonSea = termsForMode("air").map(term => term.code);
  assert.deepEqual(nonSea, ["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP"]);
  assert.equal(termsForMode("sea").length, 11);
  assert.equal(DELIVERY_TERMS.length, 11);
});

test("every delivery term suggestion matches the product payment split", () => {
  const expectedCounts: Record<string, number> = { EXW: 2, FCA: 2, FAS: 3, FOB: 3, CFR: 3, CIF: 4, CPT: 3, CIP: 3, DAP: 3, DPU: 3, DDP: 4 };
  for (const [term, count] of Object.entries(expectedCounts)) {
    const milestones = suggestionsForTerm(term);
    assert.equal(milestones.length, count, term);
    assert.equal(milestones.reduce((sum, item) => sum + item.basisPoints, 0), 10000, term);
    assert.ok(milestones.every(item => item.proofDescription && item.sellerDeadlineSec > 0 && item.buyerResponseWindowSec > 0 && item.disputeWindowSec > 0), term);
  }
});

test("proposal shares and deadline fields are enforced", () => {
  const valid = [{ description: "Dispatch", basisPoints: 3000, sellerDeadlineSec: 1, buyerResponseWindowSec: 1, disputeWindowSec: 1, proofDescription: "Dispatch notice" }, { description: "Delivery", basisPoints: 7000, sellerDeadlineSec: 1, buyerResponseWindowSec: 1, disputeWindowSec: 1, proofDescription: "Signed receipt" }];
  assert.equal(validateProposalMilestones(valid).ok, true);
  assert.equal(validateProposalMilestones(valid.map(row => ({ ...row, basisPoints: 6000 }))).ok, false);
  assert.equal(validateProposalMilestones(valid.map(row => ({ ...row, buyerResponseWindowSec: 0 }))).ok, false);
});
