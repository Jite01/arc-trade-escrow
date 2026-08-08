// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DocumentaryTradeEscrow} from "../src/DocumentaryTradeEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract DocumentaryTradeEscrowTest is Test {
    uint256 internal constant TOTAL = 1_000_001;
    address internal constant BUYER = address(0xB0B);
    address internal constant SELLER = address(0x5E11E7);
    address internal constant ARBITER = address(0xAAB1);
    address internal constant GATEWAY = address(0x6A7E);
    address internal constant PUBLIC_CALLER = address(999);
    address internal constant USDC = 0x3600000000000000000000000000000000000000;

    DocumentaryTradeEscrow internal escrow;
    MockUSDC internal usdc;

    function setUp() public {
        MockUSDC implementation = new MockUSDC();
        vm.etch(USDC, address(implementation).code);
        usdc = MockUSDC(USDC);
        usdc.setTransferFromResult(true);
        escrow = _newEscrow();
    }

    function testProposalsResetApprovalAcrossCounterProposals() public {
        DocumentaryTradeEscrow.Milestone[] memory terms = _twoMilestones();
        vm.prank(BUYER);
        escrow.proposeMilestones(terms);
        _assertApprovals(true, false, 1);

        vm.prank(SELLER);
        escrow.proposeMilestones(terms);
        _assertApprovals(false, true, 2);

        vm.prank(BUYER);
        escrow.proposeMilestones(terms);
        _assertApprovals(true, false, 3);

        vm.prank(SELLER);
        escrow.approve();
        _assertApprovals(true, true, 3);
        assertEq(escrow.getState(), uint8(DocumentaryTradeEscrow.State.COMMITTED));
    }

    function testProposeMilestonesRejectsZeroFieldsAndTooMany() public {
        DocumentaryTradeEscrow.Milestone[] memory terms = _twoMilestones();
        terms[0].basisPoints = 0;
        vm.prank(BUYER);
        vm.expectRevert(DocumentaryTradeEscrow.InvalidMilestone.selector);
        escrow.proposeMilestones(terms);

        terms = _twoMilestones();
        terms[0].buyerResponseWindow = 0;
        vm.prank(BUYER);
        vm.expectRevert(DocumentaryTradeEscrow.InvalidMilestone.selector);
        escrow.proposeMilestones(terms);

        terms = _twoMilestones();
        terms[0].disputeWindow = 0;
        vm.prank(BUYER);
        vm.expectRevert(DocumentaryTradeEscrow.InvalidMilestone.selector);
        escrow.proposeMilestones(terms);

        terms = _twoMilestones();
        terms[0].sellerDeadline = 0;
        vm.prank(BUYER);
        vm.expectRevert(DocumentaryTradeEscrow.InvalidMilestone.selector);
        escrow.proposeMilestones(terms);

        terms = new DocumentaryTradeEscrow.Milestone[](51);
        for (uint256 i; i < terms.length; ++i) {
            terms[i] = _milestone("too many", 1, 1, 1, 1);
        }
        vm.prank(BUYER);
        vm.expectRevert(DocumentaryTradeEscrow.InvalidMilestoneArray.selector);
        escrow.proposeMilestones(terms);
    }

    function testApproveRejectsInvalidBasisPointSum() public {
        DocumentaryTradeEscrow.Milestone[] memory terms = _twoMilestones();
        terms[1].basisPoints = 4_999;
        vm.prank(BUYER);
        escrow.proposeMilestones(terms);
        vm.prank(SELLER);
        vm.expectRevert(DocumentaryTradeEscrow.InvalidBasisPointTotal.selector);
        escrow.approve();
    }

    function testCancelAndExpireLifecycle() public {
        vm.prank(BUYER);
        escrow.cancel();
        assertEq(escrow.getState(), uint8(DocumentaryTradeEscrow.State.FINALIZED));
        vm.prank(BUYER);
        vm.expectRevert(DocumentaryTradeEscrow.InvalidState.selector);
        escrow.expire();

        escrow = _newEscrow();
        vm.prank(BUYER);
        vm.expectRevert(DocumentaryTradeEscrow.DeadlineNotReached.selector);
        escrow.expire();
        vm.warp(block.timestamp + 8 days);
        vm.prank(BUYER);
        escrow.expire();
        assertEq(escrow.getState(), uint8(DocumentaryTradeEscrow.State.FINALIZED));
    }

    function testDepositRejectsWrongReceivedAmountAndApprovesGateway() public {
        _commit(_twoMilestones());
        usdc.mint(BUYER, TOTAL);
        vm.prank(BUYER);
        usdc.approve(address(escrow), TOTAL);
        usdc.setTransferFromResult(false);
        vm.prank(BUYER);
        vm.expectRevert(DocumentaryTradeEscrow.TokenTransferFailed.selector);
        escrow.depositUSDS();

        usdc.setTransferFromResult(true);
        usdc.setTransferFee(1);
        vm.prank(BUYER);
        vm.expectRevert(DocumentaryTradeEscrow.IncorrectDepositReceived.selector);
        escrow.depositUSDS();

        usdc.setTransferFee(0);
        vm.prank(BUYER);
        escrow.depositUSDS();
        assertEq(escrow.getState(), uint8(DocumentaryTradeEscrow.State.ACTIVE));
        assertEq(usdc.allowance(address(escrow), GATEWAY), TOTAL);
        assertEq(escrow.milestoneUsdcAmount(0), 500_000);
        assertEq(escrow.milestoneUsdcAmount(1), 500_001);
        _assertInvariant();
    }

    function testAbandonCommitmentResetsNegotiation() public {
        _commit(_twoMilestones());
        vm.prank(SELLER);
        vm.expectRevert(DocumentaryTradeEscrow.DeadlineNotReached.selector);
        escrow.abandonCommitment();
        vm.warp(block.timestamp + 1 hours);
        vm.prank(SELLER);
        escrow.abandonCommitment();
        assertEq(escrow.getState(), uint8(DocumentaryTradeEscrow.State.NEGOTIATION));
        _assertApprovals(false, false, 0);
        assertEq(escrow.getMilestones().length, 0);
    }

    function testTwoMilestoneHappyPathAndPublicRelease() public {
        _activate(_twoMilestones());
        _trigger(0);
        vm.warp(block.timestamp + 101);
        vm.prank(PUBLIC_CALLER);
        escrow.release(0);
        _assertBalances(500_000, 500_001, 0);
        _assertInvariant();

        _trigger(1);
        vm.prank(BUYER);
        escrow.confirmMilestone(1);
        vm.warp(block.timestamp + 51);
        bytes32 transferHash = keccak256(abi.encode(SELLER, uint256(500_001), uint256(1)));
        vm.expectEmit(true, true, true, true, address(escrow));
        emit DocumentaryTradeEscrow.MilestoneReleased(1, SELLER, 500_001, transferHash);
        vm.prank(PUBLIC_CALLER);
        escrow.release(1);
        _assertBalances(TOTAL, 0, 0);
        assertEq(escrow.getState(), uint8(DocumentaryTradeEscrow.State.FINALIZED));
        assertEq(escrow.isValidSignature(transferHash, hex""), escrow.ERC1271_MAGICVALUE());
        _assertInvariant();
    }

    function testDisputeAdvancesAndNextDeadlineUsesConclusionTimestamp() public {
        _activate(_twoMilestones());
        _trigger(0);
        vm.warp(block.timestamp + 10);
        vm.prank(BUYER);
        escrow.dispute(0);
        assertEq(escrow.getCurrentMilestoneIndex(), 1);
        assertEq(uint8(escrow.milestoneStates(1)), uint8(DocumentaryTradeEscrow.MilestoneState.ACTIVE));
        uint256 expectedDeadline = escrow.concludedTimestamp(0) + 200;
        (,,,,,, uint256 deadline,) = escrow.getMilestoneStatus(1);
        assertEq(deadline, expectedDeadline);
        _assertInvariant();
    }

    function testReleaseWhileEarlierDisputeKeepsActiveThenArbitrationFinalizes() public {
        _activate(_twoMilestones());
        _trigger(0);
        vm.prank(BUYER);
        escrow.dispute(0);
        _trigger(1);
        vm.warp(block.timestamp + 101);
        escrow.release(1);
        _assertBalances(500_001, 0, 500_000);
        assertEq(escrow.getState(), uint8(DocumentaryTradeEscrow.State.ACTIVE));
        vm.prank(ARBITER);
        escrow.arbitrate(0, SELLER);
        _assertBalances(TOTAL, 0, 0);
        assertEq(escrow.getState(), uint8(DocumentaryTradeEscrow.State.FINALIZED));
    }

    function testMultipleConcurrentDisputesResolveInArbitraryOrder() public {
        _activate(_threeMilestones());
        _trigger(0);
        vm.prank(BUYER);
        escrow.dispute(0);
        _trigger(1);
        vm.prank(BUYER);
        escrow.dispute(1);
        _trigger(2);
        vm.prank(BUYER);
        escrow.dispute(2);
        _assertBalances(0, 0, TOTAL);

        vm.prank(ARBITER);
        escrow.arbitrate(1, SELLER);
        _assertBalances(333_300, 0, 666_701);
        _assertInvariant();
        vm.prank(ARBITER);
        escrow.arbitrate(0, BUYER);
        _assertBalances(333_300, 0, 333_401);
        vm.prank(ARBITER);
        escrow.arbitrate(2, SELLER);
        _assertBalances(666_701, 0, 0);
        assertEq(escrow.getState(), uint8(DocumentaryTradeEscrow.State.FINALIZED));
    }

    function testReclaimWithOpenDisputeThenForceReleaseFinalizes() public {
        _activate(_twoMilestones());
        _trigger(0);
        vm.prank(BUYER);
        escrow.dispute(0);
        uint256 deadline = escrow.concludedTimestamp(0) + 200;
        vm.warp(deadline + 1);
        vm.prank(BUYER);
        escrow.reclaimExpiry();
        _assertBalances(0, 0, 500_000);
        assertEq(escrow.getState(), uint8(DocumentaryTradeEscrow.State.ACTIVE));

        vm.warp(block.timestamp + 501);
        vm.prank(SELLER);
        escrow.forceRelease(0);
        _assertBalances(0, 0, 0);
        assertEq(escrow.getState(), uint8(DocumentaryTradeEscrow.State.FINALIZED));
    }

    function testSignatureUnknownNeverRevertsAndStateChangersRevertAfterFinalization() public {
        assertEq(escrow.isValidSignature(bytes32(uint256(1)), hex"1234"), escrow.ERC1271_INVALID());
        vm.prank(BUYER);
        escrow.cancel();
        assertEq(escrow.getState(), uint8(DocumentaryTradeEscrow.State.FINALIZED));
        vm.prank(BUYER);
        vm.expectRevert(DocumentaryTradeEscrow.InvalidState.selector);
        escrow.proposeMilestones(_twoMilestones());
        vm.prank(BUYER);
        vm.expectRevert(DocumentaryTradeEscrow.InvalidState.selector);
        escrow.depositUSDS();
        // Views remain callable after finalization.
        escrow.getTerms();
        escrow.getMilestones();
        escrow.getBalances();
        escrow.getApprovals();
        escrow.getCurrentMilestoneIndex();
    }

    function testEveryStateChangerRevertsInFinalizedState() public {
        vm.prank(BUYER);
        escrow.cancel();

        vm.startPrank(BUYER);
        vm.expectRevert(DocumentaryTradeEscrow.InvalidState.selector);
        escrow.proposeMilestones(_twoMilestones());
        vm.expectRevert(DocumentaryTradeEscrow.InvalidState.selector);
        escrow.approve();
        vm.expectRevert(DocumentaryTradeEscrow.InvalidState.selector);
        escrow.cancel();
        vm.expectRevert(DocumentaryTradeEscrow.InvalidState.selector);
        escrow.expire();
        vm.expectRevert(DocumentaryTradeEscrow.InvalidState.selector);
        escrow.depositUSDS();
        vm.expectRevert(DocumentaryTradeEscrow.InvalidState.selector);
        escrow.confirmMilestone(0);
        vm.expectRevert(DocumentaryTradeEscrow.InvalidState.selector);
        escrow.dispute(0);
        vm.expectRevert(DocumentaryTradeEscrow.InvalidState.selector);
        escrow.reclaimExpiry();
        vm.expectRevert(DocumentaryTradeEscrow.InvalidState.selector);
        escrow.forceRelease(0);
        vm.stopPrank();

        vm.prank(SELLER);
        vm.expectRevert(DocumentaryTradeEscrow.InvalidState.selector);
        escrow.abandonCommitment();
        vm.prank(SELLER);
        vm.expectRevert(DocumentaryTradeEscrow.InvalidState.selector);
        escrow.triggerMilestone(0, bytes32(0));
        vm.expectRevert(DocumentaryTradeEscrow.InvalidState.selector);
        escrow.release(0);
        vm.prank(ARBITER);
        vm.expectRevert(DocumentaryTradeEscrow.InvalidState.selector);
        escrow.arbitrate(0, BUYER);
    }

    function testAllGettersRemainCallableAfterActiveContractFinalizes() public {
        _activate(_singleMilestone());
        _trigger(0);
        vm.warp(block.timestamp + 101);
        escrow.release(0);
        assertEq(escrow.getState(), uint8(DocumentaryTradeEscrow.State.FINALIZED));

        escrow.getTerms();
        escrow.getMilestones();
        escrow.getMilestoneStatus(0);
        escrow.getApprovals();
        escrow.getBalances();
        escrow.getDocumentHash(0);
        escrow.getCurrentMilestoneIndex();
        assertEq(escrow.isValidSignature(bytes32(0), hex""), escrow.ERC1271_INVALID());
    }

    function testFuzzIsValidSignatureNeverReverts(bytes32 hash, bytes calldata signature) public view {
        bytes4 result = escrow.isValidSignature(hash, signature);
        assertTrue(result == escrow.ERC1271_MAGICVALUE() || result == escrow.ERC1271_INVALID());
    }

    function testStateGuardsAndWindowBoundaries() public {
        _activate(_twoMilestones());
        vm.prank(SELLER);
        vm.expectRevert(DocumentaryTradeEscrow.InvalidIndex.selector);
        escrow.triggerMilestone(1, bytes32("wrong-index"));
        _trigger(0);
        vm.prank(BUYER);
        vm.expectRevert(DocumentaryTradeEscrow.DeadlineNotReached.selector);
        escrow.release(0);
        vm.warp(block.timestamp + 101);
        vm.prank(BUYER);
        vm.expectRevert(DocumentaryTradeEscrow.DeadlineElapsed.selector);
        escrow.dispute(0);
        escrow.release(0);
        vm.prank(ARBITER);
        vm.expectRevert(DocumentaryTradeEscrow.InvalidMilestoneState.selector);
        escrow.arbitrate(0, SELLER);
    }

    function _newEscrow() internal returns (DocumentaryTradeEscrow) {
        return
            new DocumentaryTradeEscrow(BUYER, SELLER, ARBITER, GATEWAY, TOTAL, block.timestamp + 7 days, 1 hours, 500);
    }

    function _commit(DocumentaryTradeEscrow.Milestone[] memory terms) internal {
        vm.prank(BUYER);
        escrow.proposeMilestones(terms);
        vm.prank(SELLER);
        escrow.approve();
    }

    function _activate(DocumentaryTradeEscrow.Milestone[] memory terms) internal {
        _commit(terms);
        usdc.mint(BUYER, TOTAL);
        vm.prank(BUYER);
        usdc.approve(address(escrow), TOTAL);
        vm.prank(BUYER);
        escrow.depositUSDS();
    }

    function _trigger(uint256 index) internal {
        vm.prank(SELLER);
        escrow.triggerMilestone(index, keccak256(abi.encode("documents", index)));
    }

    function _twoMilestones() internal pure returns (DocumentaryTradeEscrow.Milestone[] memory terms) {
        terms = new DocumentaryTradeEscrow.Milestone[](2);
        terms[0] = _milestone("production documents", 5_000, 100, 50, 50);
        terms[1] = _milestone("shipping documents", 5_000, 200, 100, 50);
    }

    function _threeMilestones() internal pure returns (DocumentaryTradeEscrow.Milestone[] memory terms) {
        terms = new DocumentaryTradeEscrow.Milestone[](3);
        terms[0] = _milestone("first", 3_333, 100, 50, 50);
        terms[1] = _milestone("second", 3_333, 100, 50, 50);
        terms[2] = _milestone("third", 3_334, 100, 50, 50);
    }

    function _singleMilestone() internal pure returns (DocumentaryTradeEscrow.Milestone[] memory terms) {
        terms = new DocumentaryTradeEscrow.Milestone[](1);
        terms[0] = _milestone("complete shipment", 10_000, 100, 50, 50);
    }

    function _milestone(
        string memory description,
        uint16 bps,
        uint256 sellerDeadline,
        uint256 buyerWindow,
        uint256 disputeWindow
    ) internal pure returns (DocumentaryTradeEscrow.Milestone memory) {
        return DocumentaryTradeEscrow.Milestone(description, bps, sellerDeadline, buyerWindow, disputeWindow);
    }

    function _assertApprovals(bool expectedBuyer, bool expectedSeller, uint256 expectedVersion) internal view {
        (bool buyerApproved, bool sellerApproved, uint256 version) = escrow.getApprovals();
        assertEq(buyerApproved, expectedBuyer);
        assertEq(sellerApproved, expectedSeller);
        assertEq(version, expectedVersion);
    }

    function _assertBalances(uint256 released, uint256 remaining, uint256 disputed) internal view {
        (uint256 actualReleased, uint256 actualRemaining, uint256 actualDisputed) = escrow.getBalances();
        assertEq(actualReleased, released);
        assertEq(actualRemaining, remaining);
        assertEq(actualDisputed, disputed);
    }

    function _assertInvariant() internal view {
        (uint256 released, uint256 remaining, uint256 disputed) = escrow.getBalances();
        assertEq(released + remaining + disputed, TOTAL);
    }
}
