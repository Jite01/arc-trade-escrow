// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IGatewayWallet {
    function deposit(address token, uint256 value) external;
}

/// @notice Documentary trade escrow with Gateway-held USDC and ERC-1271 burn-intent authorization.
/// @dev Funds are deposited into Circle Gateway under this contract's address. This contract never transfers USDC out.
contract DocumentaryTradeEscrow {
    bytes4 public constant ERC1271_MAGICVALUE = 0x1626ba7e;
    bytes4 public constant ERC1271_INVALID = 0xffffffff;
    address public constant USDC = 0x3600000000000000000000000000000000000000;
    address public constant GATEWAY_WALLET_ADDRESS = 0x0077777d7EBA4688BDeF3E311b846F25870A19B9;
    address public constant GATEWAY_MINTER_ADDRESS = 0x0022222ABE238Cc2C7Bb1f21003F0a260052475B;
    uint256 public constant MAX_MILESTONES = 50;
    uint32 public constant ARC_TESTNET_DOMAIN = 26;

    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version)");
    bytes32 private constant TRANSFER_SPEC_TYPEHASH = keccak256(
        "TransferSpec(uint32 version,uint32 sourceDomain,uint32 destinationDomain,bytes32 sourceContract,bytes32 destinationContract,bytes32 sourceToken,bytes32 destinationToken,bytes32 sourceDepositor,bytes32 destinationRecipient,bytes32 sourceSigner,bytes32 destinationCaller,uint256 value,bytes32 salt,bytes hookData)"
    );
    bytes32 private constant BURN_INTENT_TYPEHASH = keccak256(
        "BurnIntent(uint256 maxBlockHeight,uint256 maxFee,TransferSpec spec)TransferSpec(uint32 version,uint32 sourceDomain,uint32 destinationDomain,bytes32 sourceContract,bytes32 destinationContract,bytes32 sourceToken,bytes32 destinationToken,bytes32 sourceDepositor,bytes32 destinationRecipient,bytes32 sourceSigner,bytes32 destinationCaller,uint256 value,bytes32 salt,bytes hookData)"
    );
    bytes32 private constant GATEWAY_DOMAIN_SEPARATOR =
        keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, keccak256("GatewayWallet"), keccak256("1")));

    enum State {
        NEGOTIATION,
        COMMITTED,
        ACTIVE,
        FINALIZED
    }

    enum MilestoneState {
        PENDING,
        ACTIVE,
        TRIGGERED,
        CONFIRMED,
        RELEASED,
        DISPUTED,
        ARBITRATED
    }

    struct Milestone {
        string description;
        uint16 basisPoints;
        uint256 sellerDeadline;
        uint256 buyerResponseWindow;
        uint256 disputeWindow;
    }

    struct TransferSpecForHash {
        uint32 version;
        uint32 sourceDomain;
        uint32 destinationDomain;
        bytes32 sourceContract;
        bytes32 destinationContract;
        bytes32 sourceToken;
        bytes32 destinationToken;
        bytes32 sourceDepositor;
        bytes32 destinationRecipient;
        bytes32 sourceSigner;
        bytes32 destinationCaller;
        uint256 value;
        bytes32 salt;
        bytes32 hookDataHash;
    }

    error Unauthorized();
    error InvalidState();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidTimestamp();
    error InvalidMilestoneArray();
    error InvalidMilestone();
    error InvalidBasisPointTotal();
    error InvalidIndex();
    error InvalidMilestoneState();
    error DeadlineNotReached();
    error DeadlineElapsed();
    error InvalidRecipient();
    error TokenTransferFailed();
    error IncorrectDepositReceived();
    error GatewayDepositFailed();
    error DuplicateBurnIntentAuthorization();
    error AlreadyInitialized();

    State public contractState;

    address public buyerAddress;
    address public sellerAddress;
    address public arbitrationAddress;
    address public operatorAddress;
    address public gatewayWalletAddress;
    uint256 public totalUSDC;
    uint256 public negotiationExpiry;
    uint256 public commitmentWindow;
    uint256 public arbitrationTimeout;
    bool private initialized;

    Milestone[] internal milestones;
    uint256 public arrayVersion;
    bool public buyerApproved;
    bool public sellerApproved;
    uint256 public committedAt;

    uint256 public currentMilestoneIndex;
    uint256 public totalReleased;
    uint256 public totalRemaining;
    uint256 public totalDisputed;
    uint256 public activationTimestamp;

    mapping(uint256 => MilestoneState) public milestoneStates;
    mapping(uint256 => bytes32) public milestoneDocumentHash;
    mapping(uint256 => uint256) public triggerTimestamp;
    mapping(uint256 => uint256) public confirmTimestamp;
    mapping(uint256 => uint256) public disputeTimestamp;
    mapping(uint256 => uint256) public releaseTimestamp;
    mapping(uint256 => uint256) public concludedTimestamp;
    mapping(uint256 => uint256) public milestoneUsdcAmount;
    mapping(bytes32 => bool) public authorizedTransfers;
    mapping(uint256 => address) public settlementRecipient;
    mapping(uint256 => uint256) public settlementAmount;
    mapping(uint256 => bool) public settlementRecorded;
    mapping(uint256 => mapping(bytes32 => bool)) private usedBurnIntentSalt;

    event ContractDeployed(address buyer, address seller, address arbitration, uint256 totalUSDC);
    event MilestoneProposed(address proposer, uint256 arrayVersion);
    event MilestoneApproved(address approver, uint256 arrayVersion);
    event ContractCommitted();
    event CommitmentAbandoned();
    event FundsDeposited(uint256 amount);
    event ContractActivated();
    event MilestoneTriggered(uint256 index, bytes32 documentHash);
    event MilestoneConfirmed(uint256 index);
    event MilestoneDisputed(uint256 index);
    event MilestoneReleased(uint256 index, address recipient, uint256 amount);
    event MilestoneArbitrated(uint256 index, address recipient, uint256 amount);
    event ArbitrationForced(uint256 index, address recipient, uint256 amount);
    event FundsReclaimed(address recipient, uint256 amount);
    event BurnIntentAuthorized(
        bytes32 indexed burnIntentHash, uint256 indexed settlementIndex, address recipient, uint256 amount
    );
    event ContractExpired();
    event ContractCancelled();
    event ContractFinalized();

    constructor(
        address buyerAddress_,
        address sellerAddress_,
        address arbitrationAddress_,
        address operatorAddress_,
        uint256 totalUSDC_,
        uint256 negotiationExpiry_,
        uint256 commitmentWindow_,
        uint256 arbitrationTimeout_
    ) {
        _initialize(
            buyerAddress_, sellerAddress_, arbitrationAddress_, operatorAddress_, totalUSDC_, negotiationExpiry_,
            commitmentWindow_, arbitrationTimeout_
        );
        emit ContractDeployed(buyerAddress_, sellerAddress_, arbitrationAddress_, totalUSDC_);
    }

    function initialize(
        address buyerAddress_,
        address sellerAddress_,
        address arbitrationAddress_,
        address operatorAddress_,
        uint256 totalUSDC_,
        uint256 negotiationExpiry_,
        uint256 commitmentWindow_,
        uint256 arbitrationTimeout_
    ) external {
        if (initialized) revert AlreadyInitialized();
        _initialize(
            buyerAddress_, sellerAddress_, arbitrationAddress_, operatorAddress_, totalUSDC_, negotiationExpiry_,
            commitmentWindow_, arbitrationTimeout_
        );
        emit ContractDeployed(buyerAddress_, sellerAddress_, arbitrationAddress_, totalUSDC_);
    }

    function _initialize(
        address buyerAddress_,
        address sellerAddress_,
        address arbitrationAddress_,
        address operatorAddress_,
        uint256 totalUSDC_,
        uint256 negotiationExpiry_,
        uint256 commitmentWindow_,
        uint256 arbitrationTimeout_
    ) internal {
        if (sellerAddress_ == address(0) || arbitrationAddress_ == address(0) || operatorAddress_ == address(0)) {
            revert InvalidAddress();
        }
        if (totalUSDC_ == 0) revert InvalidAmount();
        if (negotiationExpiry_ <= block.timestamp) revert InvalidTimestamp();
        if (arbitrationTimeout_ == 0) revert InvalidTimestamp();

        buyerAddress = buyerAddress_;
        sellerAddress = sellerAddress_;
        arbitrationAddress = arbitrationAddress_;
        operatorAddress = operatorAddress_;
        gatewayWalletAddress = GATEWAY_WALLET_ADDRESS;
        totalUSDC = totalUSDC_;
        negotiationExpiry = negotiationExpiry_;
        commitmentWindow = commitmentWindow_;
        arbitrationTimeout = arbitrationTimeout_;
        initialized = true;
    }

    function proposeMilestones(Milestone[] calldata array) external {
        _requireBuyerOrSeller();
        _requireState(State.NEGOTIATION);
        if (array.length == 0 || array.length > MAX_MILESTONES) revert InvalidMilestoneArray();

        for (uint256 i; i < array.length; ++i) {
            Milestone calldata milestone = array[i];
            if (
                milestone.basisPoints == 0 || milestone.sellerDeadline == 0 || milestone.buyerResponseWindow == 0
                    || milestone.disputeWindow == 0
            ) revert InvalidMilestone();
        }

        delete milestones;
        for (uint256 i; i < array.length; ++i) {
            milestones.push(array[i]);
        }

        ++arrayVersion;
        if (msg.sender == buyerAddress) {
            buyerApproved = true;
            sellerApproved = false;
        } else {
            sellerApproved = true;
            buyerApproved = false;
        }
        emit MilestoneProposed(msg.sender, arrayVersion);
    }

    function approve() external {
        _requireBuyerOrSeller();
        _requireState(State.NEGOTIATION);
        if (_basisPointTotal() != 10_000) revert InvalidBasisPointTotal();

        if (msg.sender == buyerAddress) buyerApproved = true;
        else sellerApproved = true;

        emit MilestoneApproved(msg.sender, arrayVersion);
        if (buyerApproved && sellerApproved) {
            committedAt = block.timestamp;
            contractState = State.COMMITTED;
            emit ContractCommitted();
        }
    }

    function cancel() external {
        if (msg.sender != buyerAddress) revert Unauthorized();
        _requireState(State.NEGOTIATION);
        contractState = State.FINALIZED;
        emit ContractCancelled();
        emit ContractFinalized();
    }

    function expire() external {
        if (msg.sender != buyerAddress) revert Unauthorized();
        _requireState(State.NEGOTIATION);
        if (block.timestamp < negotiationExpiry) revert DeadlineNotReached();
        contractState = State.FINALIZED;
        emit ContractExpired();
        emit ContractFinalized();
    }

    function depositUSDS() external {
        if (msg.sender != buyerAddress) revert Unauthorized();
        _requireState(State.COMMITTED);

        IERC20 usdc = IERC20(USDC);
        uint256 balanceBefore = usdc.balanceOf(address(this));
        if (!usdc.transferFrom(buyerAddress, address(this), totalUSDC)) revert TokenTransferFailed();
        if (usdc.balanceOf(address(this)) - balanceBefore != totalUSDC) revert IncorrectDepositReceived();
        if (!usdc.approve(gatewayWalletAddress, totalUSDC)) revert TokenTransferFailed();
        IGatewayWallet(gatewayWalletAddress).deposit(USDC, totalUSDC);
        if (usdc.balanceOf(address(this)) != balanceBefore) revert GatewayDepositFailed();

        totalRemaining = totalUSDC;
        activationTimestamp = block.timestamp;
        uint256 previousAmounts;
        for (uint256 i; i < milestones.length; ++i) {
            uint256 amount = i + 1 == milestones.length
                ? totalUSDC - previousAmounts
                : (totalUSDC * milestones[i].basisPoints) / 10_000;
            milestoneUsdcAmount[i] = amount;
            previousAmounts += amount;
        }
        milestoneStates[0] = MilestoneState.ACTIVE;
        contractState = State.ACTIVE;
        emit FundsDeposited(totalUSDC);
        emit ContractActivated();
    }

    function abandonCommitment() external {
        if (msg.sender != sellerAddress) revert Unauthorized();
        _requireState(State.COMMITTED);
        if (block.timestamp < committedAt + commitmentWindow) revert DeadlineNotReached();

        contractState = State.NEGOTIATION;
        buyerApproved = false;
        sellerApproved = false;
        delete milestones;
        arrayVersion = 0;
        committedAt = 0;
        currentMilestoneIndex = 0;
        emit CommitmentAbandoned();
    }

    function triggerMilestone(uint256 index, bytes32 documentHash) external {
        if (msg.sender != sellerAddress) revert Unauthorized();
        _requireState(State.ACTIVE);
        _requireCurrentIndex(index);
        if (milestoneStates[index] != MilestoneState.ACTIVE) revert InvalidMilestoneState();
        if (milestoneDocumentHash[index] != bytes32(0)) revert InvalidMilestoneState();

        milestoneDocumentHash[index] = documentHash;
        triggerTimestamp[index] = block.timestamp;
        milestoneStates[index] = MilestoneState.TRIGGERED;
        emit MilestoneTriggered(index, documentHash);
    }

    function confirmMilestone(uint256 index) external {
        if (msg.sender != buyerAddress) revert Unauthorized();
        _requireState(State.ACTIVE);
        _requireCurrentIndex(index);
        if (milestoneStates[index] != MilestoneState.TRIGGERED) revert InvalidMilestoneState();
        if (block.timestamp > triggerTimestamp[index] + milestones[index].buyerResponseWindow) {
            revert DeadlineElapsed();
        }

        confirmTimestamp[index] = block.timestamp;
        milestoneStates[index] = MilestoneState.CONFIRMED;
        emit MilestoneConfirmed(index);
    }

    function dispute(uint256 index) external {
        if (msg.sender != buyerAddress) revert Unauthorized();
        _requireState(State.ACTIVE);
        _requireCurrentIndex(index);

        MilestoneState milestoneState = milestoneStates[index];
        if (milestoneState == MilestoneState.TRIGGERED) {
            if (block.timestamp > triggerTimestamp[index] + milestones[index].buyerResponseWindow) {
                revert DeadlineElapsed();
            }
        } else if (milestoneState == MilestoneState.CONFIRMED) {
            if (block.timestamp > confirmTimestamp[index] + milestones[index].disputeWindow) revert DeadlineElapsed();
        } else {
            revert InvalidMilestoneState();
        }

        uint256 amount = milestoneUsdcAmount[index];
        disputeTimestamp[index] = block.timestamp;
        concludedTimestamp[index] = block.timestamp;
        milestoneStates[index] = MilestoneState.DISPUTED;
        totalRemaining -= amount;
        totalDisputed += amount;
        _advanceMilestone();
        emit MilestoneDisputed(index);
    }

    function release(uint256 index) external {
        _requireState(State.ACTIVE);
        _requireCurrentIndex(index);

        MilestoneState milestoneState = milestoneStates[index];
        if (milestoneState == MilestoneState.TRIGGERED) {
            if (block.timestamp <= triggerTimestamp[index] + milestones[index].buyerResponseWindow) {
                revert DeadlineNotReached();
            }
        } else if (milestoneState == MilestoneState.CONFIRMED) {
            if (block.timestamp <= confirmTimestamp[index] + milestones[index].disputeWindow) {
                revert DeadlineNotReached();
            }
        } else {
            revert InvalidMilestoneState();
        }

        uint256 amount = milestoneUsdcAmount[index];
        _recordSettlement(index, sellerAddress, amount);
        releaseTimestamp[index] = block.timestamp;
        concludedTimestamp[index] = block.timestamp;
        milestoneStates[index] = MilestoneState.RELEASED;
        totalReleased += amount;
        totalRemaining -= amount;
        _advanceMilestone();
        emit MilestoneReleased(index, sellerAddress, amount);
        _checkFinalization();
    }

    function reclaimExpiry() external {
        if (msg.sender != buyerAddress) revert Unauthorized();
        _requireState(State.ACTIVE);
        if (
            currentMilestoneIndex >= milestones.length
                || milestoneStates[currentMilestoneIndex] != MilestoneState.ACTIVE
        ) {
            revert InvalidMilestoneState();
        }
        if (block.timestamp <= _sellerDeadlineFor(currentMilestoneIndex)) revert DeadlineNotReached();
        if (settlementRecorded[type(uint256).max]) revert InvalidMilestoneState();

        uint256 amount = totalRemaining;
        _recordSettlement(type(uint256).max, buyerAddress, amount);
        totalRemaining = 0;
        emit FundsReclaimed(buyerAddress, amount);
        _checkFinalization();
    }

    function arbitrate(uint256 index, address recipient) external {
        if (msg.sender != arbitrationAddress) revert Unauthorized();
        _requireState(State.ACTIVE);
        if (milestoneStates[index] != MilestoneState.DISPUTED) revert InvalidMilestoneState();
        if (recipient != buyerAddress && recipient != sellerAddress) revert InvalidRecipient();

        uint256 amount = milestoneUsdcAmount[index];
        _recordSettlement(index, recipient, amount);
        releaseTimestamp[index] = block.timestamp;
        milestoneStates[index] = MilestoneState.ARBITRATED;
        totalDisputed -= amount;
        if (recipient == sellerAddress) totalReleased += amount;
        emit MilestoneArbitrated(index, recipient, amount);
        _checkFinalization();
    }

    function forceRelease(uint256 index) external {
        _requireBuyerOrSeller();
        _requireState(State.ACTIVE);
        if (milestoneStates[index] != MilestoneState.DISPUTED) revert InvalidMilestoneState();
        if (block.timestamp <= disputeTimestamp[index] + arbitrationTimeout) revert DeadlineNotReached();

        uint256 amount = milestoneUsdcAmount[index];
        _recordSettlement(index, buyerAddress, amount);
        milestoneStates[index] = MilestoneState.ARBITRATED;
        totalDisputed -= amount;
        emit ArbitrationForced(index, buyerAddress, amount);
        _checkFinalization();
    }

    /// @notice Authorizes a Gateway EIP-712 BurnIntent derived from a recorded settlement.
    /// @dev The operator can authorize replacement intents with new expiry parameters and salt; settlement terms stay fixed.
    function authorizeBurnIntent(uint256 settlementIndex, uint256 maxBlockHeight, uint256 maxFee, bytes32 salt)
        external
        returns (bytes32 burnIntentHash)
    {
        if (msg.sender != operatorAddress) revert Unauthorized();
        if (!settlementRecorded[settlementIndex]) revert InvalidMilestoneState();
        burnIntentHash = _burnIntentHash(settlementIndex, maxBlockHeight, maxFee, salt);
        if (usedBurnIntentSalt[settlementIndex][salt] || authorizedTransfers[burnIntentHash]) {
            revert DuplicateBurnIntentAuthorization();
        }

        authorizedTransfers[burnIntentHash] = true;
        usedBurnIntentSalt[settlementIndex][salt] = true;
        emit BurnIntentAuthorized(
            burnIntentHash, settlementIndex, settlementRecipient[settlementIndex], settlementAmount[settlementIndex]
        );
    }

    /// @notice ERC-1271 validation used by Circle Gateway. Signature bytes are intentionally ignored.
    function isValidSignature(bytes32 hash, bytes memory) external view returns (bytes4) {
        return authorizedTransfers[hash] ? ERC1271_MAGICVALUE : ERC1271_INVALID;
    }

    function getState() external view returns (uint8) {
        return uint8(contractState);
    }

    function getTerms()
        external
        view
        returns (
            address buyerAddress_,
            address sellerAddress_,
            address arbitrationAddress_,
            address gatewayWalletAddress_,
            uint256 totalUSDC_,
            uint256 negotiationExpiry_,
            uint256 commitmentWindow_,
            uint256 arbitrationTimeout_
        )
    {
        return (
            buyerAddress,
            sellerAddress,
            arbitrationAddress,
            gatewayWalletAddress,
            totalUSDC,
            negotiationExpiry,
            commitmentWindow,
            arbitrationTimeout
        );
    }

    function getMilestones() external view returns (Milestone[] memory) {
        return milestones;
    }

    function getMilestoneStatus(uint256 index)
        external
        view
        returns (
            uint8 milestoneState_,
            bytes32 documentHash_,
            uint256 triggerTimestamp__,
            uint256 confirmTimestamp__,
            uint256 disputeTimestamp__,
            uint256 releaseTimestamp__,
            uint256 windowDeadline_,
            uint256 usdcAmount_
        )
    {
        if (index >= milestones.length) revert InvalidIndex();
        MilestoneState state = milestoneStates[index];
        milestoneState_ = uint8(state);
        documentHash_ = milestoneDocumentHash[index];
        triggerTimestamp__ = triggerTimestamp[index];
        confirmTimestamp__ = confirmTimestamp[index];
        disputeTimestamp__ = disputeTimestamp[index];
        releaseTimestamp__ = releaseTimestamp[index];
        usdcAmount_ = milestoneUsdcAmount[index];
        if (state == MilestoneState.ACTIVE) {
            windowDeadline_ = _sellerDeadlineFor(index);
        } else if (state == MilestoneState.TRIGGERED) {
            windowDeadline_ = triggerTimestamp[index] + milestones[index].buyerResponseWindow;
        } else if (state == MilestoneState.CONFIRMED) {
            windowDeadline_ = confirmTimestamp[index] + milestones[index].disputeWindow;
        } else if (state == MilestoneState.DISPUTED) {
            windowDeadline_ = disputeTimestamp[index] + arbitrationTimeout;
        }
    }

    function getApprovals() external view returns (bool buyerApproved_, bool sellerApproved_, uint256 arrayVersion_) {
        return (buyerApproved, sellerApproved, arrayVersion);
    }

    function getBalances()
        external
        view
        returns (uint256 totalReleased_, uint256 totalRemaining_, uint256 totalDisputed_)
    {
        return (totalReleased, totalRemaining, totalDisputed);
    }

    function getDocumentHash(uint256 index) external view returns (bytes32) {
        return milestoneDocumentHash[index];
    }

    function getCurrentMilestoneIndex() external view returns (uint256) {
        return currentMilestoneIndex;
    }

    /// @notice Returns the exact EIP-712 digest Gateway supplies to isValidSignature for a settlement.
    function getBurnIntentHash(uint256 settlementIndex, uint256 maxBlockHeight, uint256 maxFee, bytes32 salt)
        external
        view
        returns (bytes32)
    {
        if (!settlementRecorded[settlementIndex]) revert InvalidMilestoneState();
        return _burnIntentHash(settlementIndex, maxBlockHeight, maxFee, salt);
    }

    function _sellerDeadlineFor(uint256 index) internal view returns (uint256) {
        if (index == 0) return activationTimestamp + milestones[0].sellerDeadline;
        return concludedTimestamp[index - 1] + milestones[index].sellerDeadline;
    }

    function _recordSettlement(uint256 index, address recipient, uint256 amount) internal {
        settlementRecipient[index] = recipient;
        settlementAmount[index] = amount;
        settlementRecorded[index] = true;
    }

    function _burnIntentHash(uint256 settlementIndex, uint256 maxBlockHeight, uint256 maxFee, bytes32 salt)
        internal
        view
        returns (bytes32)
    {
        bytes32 contractAddress = _addressToBytes32(address(this));
        TransferSpecForHash memory spec;
        spec.version = 1;
        spec.sourceDomain = ARC_TESTNET_DOMAIN;
        spec.destinationDomain = ARC_TESTNET_DOMAIN;
        spec.sourceContract = _addressToBytes32(GATEWAY_WALLET_ADDRESS);
        spec.destinationContract = _addressToBytes32(GATEWAY_MINTER_ADDRESS);
        spec.sourceToken = _addressToBytes32(USDC);
        spec.destinationToken = _addressToBytes32(USDC);
        spec.sourceDepositor = contractAddress;
        spec.destinationRecipient = _addressToBytes32(settlementRecipient[settlementIndex]);
        spec.sourceSigner = contractAddress;
        spec.destinationCaller = bytes32(0);
        spec.value = settlementAmount[settlementIndex];
        spec.salt = salt;
        spec.hookDataHash = keccak256("");
        bytes32 transferSpecHash = keccak256(abi.encode(TRANSFER_SPEC_TYPEHASH, spec));
        bytes32 structHash = keccak256(abi.encode(BURN_INTENT_TYPEHASH, maxBlockHeight, maxFee, transferSpecHash));
        return keccak256(abi.encodePacked("\x19\x01", GATEWAY_DOMAIN_SEPARATOR, structHash));
    }

    function _addressToBytes32(address account) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(account)));
    }

    function _checkFinalization() internal {
        if (totalRemaining == 0 && totalDisputed == 0) {
            contractState = State.FINALIZED;
            emit ContractFinalized();
        }
    }

    function _requireState(State expected) internal view {
        if (contractState != expected) revert InvalidState();
    }

    function _requireBuyerOrSeller() internal view {
        if (msg.sender != buyerAddress && msg.sender != sellerAddress) revert Unauthorized();
    }

    function _requireCurrentIndex(uint256 index) internal view {
        if (index != currentMilestoneIndex) revert InvalidIndex();
    }

    function _advanceMilestone() internal {
        ++currentMilestoneIndex;
        if (currentMilestoneIndex < milestones.length) milestoneStates[currentMilestoneIndex] = MilestoneState.ACTIVE;
    }

    function _basisPointTotal() internal view returns (uint256 total) {
        for (uint256 i; i < milestones.length; ++i) {
            total += milestones[i].basisPoints;
        }
    }
}
