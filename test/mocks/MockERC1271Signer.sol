// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockERC1271Signer {
    bytes4 public constant MAGICVALUE = 0x1626ba7e;
    mapping(bytes32 => bool) public approved;

    function approve(bytes32 digest) external {
        approved[digest] = true;
    }

    function isValidSignature(bytes32 digest, bytes calldata) external view returns (bytes4) {
        return approved[digest] ? MAGICVALUE : bytes4(0xffffffff);
    }
}
