// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC1271ResolutionSigner {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}

interface IResolutionEscrow {
    function buyerAddress() external view returns (address);
    function sellerAddress() external view returns (address);
    function arbitrationAddress() external view returns (address);
    function milestoneStates(uint256 index) external view returns (uint8);
    function arbitrate(uint256 index, address recipient) external;
}

/// @notice Narrow execution boundary for mutually authorized dispute resolution.
/// @dev This contract does not hold funds, select resolvers, or execute Gateway transfers.
///      Buyer, seller, and resolver authorize a case with EIP-712 signatures; the resolver
///      separately signs the final recipient decision; this contract then calls the escrow.
contract ResolutionRouter {
    bytes4 public constant ERC1271_MAGICVALUE = 0x1626ba7e;
    uint8 public constant DISPUTED_MILESTONE_STATE = 5;

    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant ASSIGNMENT_TYPEHASH = keccak256(
        "ResolutionAssignment(bytes32 caseId,address escrow,uint256 milestoneIndex,address buyer,address seller,address resolver,uint256 assignmentNonce,uint256 assignmentExpiry)"
    );
    bytes32 public constant DECISION_TYPEHASH = keccak256(
        "ResolutionDecision(bytes32 caseId,address escrow,uint256 milestoneIndex,address resolver,address recipient,uint256 decisionNonce,uint256 decisionExpiry,uint256 assignmentNonce,uint256 assignmentExpiry)"
    );
    bytes32 public immutable DOMAIN_SEPARATOR;

    error InvalidAddress();
    error WrongArbitrationAddress();
    error CaseNotDisputed();
    error CaseAlreadyResolved();
    error SignatureExpired();
    error InvalidAssignmentSignature();
    error InvalidDecisionSignature();
    error InvalidRecipient();
    error ReentrantCall();

    mapping(bytes32 => bool) public resolvedCases;
    uint256 private entered = 1;

    struct ResolutionRequest {
        address escrow;
        uint256 milestoneIndex;
        address resolver;
        uint256 assignmentNonce;
        uint256 assignmentExpiry;
        address recipient;
        uint256 decisionNonce;
        uint256 decisionExpiry;
        bytes buyerSignature;
        bytes sellerSignature;
        bytes resolverAssignmentSignature;
        bytes resolverDecisionSignature;
    }

    event ResolutionExecuted(
        bytes32 indexed caseId,
        address indexed escrow,
        uint256 indexed milestoneIndex,
        address resolver,
        address recipient,
        uint256 assignmentNonce,
        uint256 decisionNonce
    );

    constructor() {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256("ArcTrade Resolution Router"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    /// @notice Deterministically identifies the sole dispute lifecycle for a milestone.
    /// @dev DocumentaryTradeEscrow permits a milestone to enter DISPUTED only once.
    ///      A future escrow with repeatable disputes must use a versioned router/case nonce.
    function getCaseId(address escrow, uint256 milestoneIndex) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), escrow, milestoneIndex));
    }

    function getAssignmentDigest(
        bytes32 caseId,
        address escrow,
        uint256 milestoneIndex,
        address buyer,
        address seller,
        address resolver,
        uint256 assignmentNonce,
        uint256 assignmentExpiry
    ) public view returns (bytes32) {
        return _typedDataHash(
            keccak256(
                abi.encode(
                    ASSIGNMENT_TYPEHASH,
                    caseId,
                    escrow,
                    milestoneIndex,
                    buyer,
                    seller,
                    resolver,
                    assignmentNonce,
                    assignmentExpiry
                )
            )
        );
    }

    function getDecisionDigest(
        bytes32 caseId,
        address escrow,
        uint256 milestoneIndex,
        address resolver,
        address recipient,
        uint256 decisionNonce,
        uint256 decisionExpiry,
        uint256 assignmentNonce,
        uint256 assignmentExpiry
    ) public view returns (bytes32) {
        return _typedDataHash(
            keccak256(
                abi.encode(
                    DECISION_TYPEHASH,
                    caseId,
                    escrow,
                    milestoneIndex,
                    resolver,
                    recipient,
                    decisionNonce,
                    decisionExpiry,
                    assignmentNonce,
                    assignmentExpiry
                )
            )
        );
    }

    /// @notice Executes one mutually authorized resolution decision.
    /// @dev Anyone may submit valid signatures. The submitter is not a source of authority.
    function resolve(ResolutionRequest calldata request) external {
        if (entered != 1) revert ReentrantCall();
        entered = 2;

        if (request.escrow == address(0) || request.resolver == address(0) || request.recipient == address(0)) {
            revert InvalidAddress();
        }
        if (block.timestamp > request.assignmentExpiry || block.timestamp > request.decisionExpiry) {
            revert SignatureExpired();
        }
        if (request.decisionExpiry > request.assignmentExpiry) revert SignatureExpired();

        bytes32 caseId = getCaseId(request.escrow, request.milestoneIndex);
        if (resolvedCases[caseId]) revert CaseAlreadyResolved();

        IResolutionEscrow target = IResolutionEscrow(request.escrow);
        address buyer = target.buyerAddress();
        address seller = target.sellerAddress();
        if (buyer == address(0) || seller == address(0)) revert InvalidAddress();
        if (target.arbitrationAddress() != address(this)) revert WrongArbitrationAddress();
        if (request.recipient != buyer && request.recipient != seller) revert InvalidRecipient();
        if (target.milestoneStates(request.milestoneIndex) != DISPUTED_MILESTONE_STATE) revert CaseNotDisputed();

        bytes32 assignmentDigest = getAssignmentDigest(
            caseId,
            request.escrow,
            request.milestoneIndex,
            buyer,
            seller,
            request.resolver,
            request.assignmentNonce,
            request.assignmentExpiry
        );
        if (
            !_isValidSigner(buyer, assignmentDigest, request.buyerSignature)
                || !_isValidSigner(seller, assignmentDigest, request.sellerSignature)
                || !_isValidSigner(request.resolver, assignmentDigest, request.resolverAssignmentSignature)
        ) revert InvalidAssignmentSignature();

        bytes32 decisionDigest = getDecisionDigest(
            caseId,
            request.escrow,
            request.milestoneIndex,
            request.resolver,
            request.recipient,
            request.decisionNonce,
            request.decisionExpiry,
            request.assignmentNonce,
            request.assignmentExpiry
        );
        if (!_isValidSigner(request.resolver, decisionDigest, request.resolverDecisionSignature)) {
            revert InvalidDecisionSignature();
        }

        resolvedCases[caseId] = true;
        target.arbitrate(request.milestoneIndex, request.recipient);

        emit ResolutionExecuted(
            caseId,
            request.escrow,
            request.milestoneIndex,
            request.resolver,
            request.recipient,
            request.assignmentNonce,
            request.decisionNonce
        );
        entered = 1;
    }

    function _typedDataHash(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function _isValidSigner(address signer, bytes32 digest, bytes calldata signature) internal view returns (bool) {
        if (signer.code.length == 0) return _isValidEOASignature(signer, digest, signature);

        (bool success, bytes memory result) = signer.staticcall(
            abi.encodeWithSelector(IERC1271ResolutionSigner.isValidSignature.selector, digest, signature)
        );
        return success && result.length >= 4 && bytes4(result) == ERC1271_MAGICVALUE;
    }

    function _isValidEOASignature(address signer, bytes32 digest, bytes calldata signature)
        internal
        pure
        returns (bool)
    {
        if (signature.length != 65) return false;
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return false;
        // Reject malleable ECDSA signatures: secp256k1n / 2.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return false;
        return ecrecover(digest, v, r, s) == signer;
    }
}
