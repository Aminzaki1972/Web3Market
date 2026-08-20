// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Web3Market Testnet Escrow
/// @notice Native-coin escrow prototype for XPHERE Testnet (XPT).
/// @dev TESTNET ONLY. Do not use with mainnet funds without independent audit.
contract Web3MarketEscrowTestnet {
    enum Status { None, Funded, Released, Refunded, Disputed }

    struct Escrow {
        address buyer;
        address seller;
        address arbiter;
        uint256 amount;
        uint64 refundAfter;
        Status status;
    }

    uint256 public nextEscrowId;
    mapping(uint256 => Escrow) public escrows;

    error InvalidParticipants();
    error InvalidAmount();
    error InvalidTimeout();
    error NotBuyer();
    error NotSeller();
    error NotArbiter();
    error InvalidStatus();
    error WrongValue();
    error TooEarly();
    error TransferFailed();

    event EscrowCreated(uint256 indexed id, address indexed buyer, address indexed seller, address arbiter, uint256 amount, uint64 refundAfter);
    event Released(uint256 indexed id, address indexed seller, uint256 amount);
    event Refunded(uint256 indexed id, address indexed buyer, uint256 amount);
    event Disputed(uint256 indexed id, address indexed arbiter);

    function createEscrow(address seller, address arbiter, uint64 refundAfter) external payable returns (uint256 id) {
        if (seller == address(0) || arbiter == address(0) || seller == msg.sender || arbiter == msg.sender) revert InvalidParticipants();
        if (msg.value == 0) revert InvalidAmount();
        if (refundAfter <= block.timestamp) revert InvalidTimeout();

        id = nextEscrowId++;
        escrows[id] = Escrow(msg.sender, seller, arbiter, msg.value, refundAfter, Status.Funded);
        emit EscrowCreated(id, msg.sender, seller, arbiter, msg.value, refundAfter);
    }

    function release(uint256 id) external {
        Escrow storage e = escrows[id];
        if (e.status != Status.Funded) revert InvalidStatus();
        if (msg.sender != e.buyer && msg.sender != e.arbiter) revert NotBuyer();
        e.status = Status.Released;
        _send(e.seller, e.amount);
        emit Released(id, e.seller, e.amount);
    }

    function refund(uint256 id) external {
        Escrow storage e = escrows[id];
        if (e.status != Status.Funded) revert InvalidStatus();
        if (msg.sender != e.buyer) revert NotBuyer();
        if (block.timestamp < e.refundAfter) revert TooEarly();
        e.status = Status.Refunded;
        _send(e.buyer, e.amount);
        emit Refunded(id, e.buyer, e.amount);
    }

    function dispute(uint256 id) external {
        Escrow storage e = escrows[id];
        if (e.status != Status.Funded) revert InvalidStatus();
        if (msg.sender != e.buyer && msg.sender != e.seller) revert NotBuyer();
        e.status = Status.Disputed;
        emit Disputed(id, e.arbiter);
    }

    function arbiterRefund(uint256 id) external {
        Escrow storage e = escrows[id];
        if (e.status != Status.Disputed) revert InvalidStatus();
        if (msg.sender != e.arbiter) revert NotArbiter();
        e.status = Status.Refunded;
        _send(e.buyer, e.amount);
        emit Refunded(id, e.buyer, e.amount);
    }

    function arbiterRelease(uint256 id) external {
        Escrow storage e = escrows[id];
        if (e.status != Status.Disputed) revert InvalidStatus();
        if (msg.sender != e.arbiter) revert NotArbiter();
        e.status = Status.Released;
        _send(e.seller, e.amount);
        emit Released(id, e.seller, e.amount);
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
