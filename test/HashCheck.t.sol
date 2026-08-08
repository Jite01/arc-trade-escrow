// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

contract HashCheckTest is Test {
    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version)");
    bytes32 private constant TRANSFER_SPEC_TYPEHASH = keccak256(
        "TransferSpec(uint32 version,uint32 sourceDomain,uint32 destinationDomain,bytes32 sourceContract,bytes32 destinationContract,bytes32 sourceToken,bytes32 destinationToken,bytes32 sourceDepositor,bytes32 destinationRecipient,bytes32 sourceSigner,bytes32 destinationCaller,uint256 value,bytes32 salt,bytes hookData)"
    );
    bytes32 private constant BURN_INTENT_TYPEHASH = keccak256(
        "BurnIntent(uint256 maxBlockHeight,uint256 maxFee,TransferSpec spec)TransferSpec(uint32 version,uint32 sourceDomain,uint32 destinationDomain,bytes32 sourceContract,bytes32 destinationContract,bytes32 sourceToken,bytes32 destinationToken,bytes32 sourceDepositor,bytes32 destinationRecipient,bytes32 sourceSigner,bytes32 destinationCaller,uint256 value,bytes32 salt,bytes hookData)"
    );

    function test_burnIntentHashVector() public {
        address escrow = 0xe921Dd6a7AEa5634e9b07D0BEa8acA946bf8Be8D;
        address recipient = 0xD69aaa6Ac4dA19bE00B2B36051A3422b4F6f60d6;
        uint256 amount = 1000000;
        uint256 maxBlock = 999999999;
        uint256 maxFee = 2010000;
        bytes32 salt = 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;

        bytes32 transferSpecHash = _transferSpecHash(escrow, recipient, amount, salt);
        bytes32 structHash = keccak256(abi.encode(BURN_INTENT_TYPEHASH, maxBlock, maxFee, transferSpecHash));
        bytes32 domainSeparator = keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, keccak256("GatewayWallet"), keccak256("1"))
        );
        bytes32 hash = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        emit log_named_bytes32("SOL_HASH", hash);
    }

    function _transferSpecHash(address escrow, address recipient, uint256 amount, bytes32 salt)
        private
        pure
        returns (bytes32)
    {
        bytes memory encoded = abi.encode(TRANSFER_SPEC_TYPEHASH);
        encoded = bytes.concat(encoded, abi.encode(uint32(1)));
        encoded = bytes.concat(encoded, abi.encode(uint32(26)));
        encoded = bytes.concat(encoded, abi.encode(uint32(26)));
        encoded = bytes.concat(encoded, abi.encode(_addressToBytes32(0x0077777d7EBA4688BDeF3E311b846F25870A19B9)));
        encoded = bytes.concat(encoded, abi.encode(_addressToBytes32(0x0022222ABE238Cc2C7Bb1f21003F0a260052475B)));
        encoded = bytes.concat(encoded, abi.encode(_addressToBytes32(0x3600000000000000000000000000000000000000)));
        encoded = bytes.concat(encoded, abi.encode(_addressToBytes32(0x3600000000000000000000000000000000000000)));
        encoded = bytes.concat(encoded, abi.encode(_addressToBytes32(escrow)));
        encoded = bytes.concat(encoded, abi.encode(_addressToBytes32(recipient)));
        encoded = bytes.concat(encoded, abi.encode(_addressToBytes32(escrow)));
        encoded = bytes.concat(encoded, abi.encode(bytes32(0)));
        encoded = bytes.concat(encoded, abi.encode(amount));
        encoded = bytes.concat(encoded, abi.encode(salt));
        encoded = bytes.concat(encoded, abi.encode(keccak256("")));
        return keccak256(encoded);
    }

    function _addressToBytes32(address account) private pure returns (bytes32) {
        return bytes32(uint256(uint160(account)));
    }
}
