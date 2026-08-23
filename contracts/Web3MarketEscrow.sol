// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Web3Market Escrow
/// @notice Native-XPT escrow for Web3Market deals. Testnet-first design.
/// @dev Deploy on Xphere Testnet (chainId 1998991) using a disposable testnet deployer.
contract Web3MarketEscrow {
    enum Status { Created, Funded, Delivered, Released, Refunded, Disputed }

    struct Deal {
        address buyer;
        address seller;
        uint256 amount;
        uint64 createdAt;
        uint64 fundedAt;
        uint64 deliveredAt;
        Status status;
    }

    address public owner;
    address public arbiter;
    uint64 public constant DEFAULT_FUNDING_TIMEOUT = 7 days;
    uint64 public fundingTimeout;
    uint256 public platformFeeBps;
    uint256 public accumulatedFees;
    uint256 public nextDealId;
    mapping(uint256 => Deal) public deals;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ArbiterChanged(address indexed previousArbiter, address indexed newArbiter);
    event PlatformFeeChanged(uint256 oldBps, uint256 newBps);
    event DealCreated(uint256 indexed dealId, address indexed buyer, address indexed seller, uint256 amount);
    event DealFunded(uint256 indexed dealId, uint256 amount);
    event AssetDelivered(uint256 indexed dealId);
    event DealReleased(uint256 indexed dealId, uint256 sellerAmount, uint256 fee);
    event DealRefunded(uint256 indexed dealId, uint256 amount);
    event DealDisputed(uint256 indexed dealId, address indexed openedBy);
    event FeesWithdrawn(address indexed recipient, uint256 amount);

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }
    modifier onlyArbiter() { require(msg.sender == arbiter, "Not arbiter"); _; }

    constructor(address _arbiter, uint256 _platformFeeBps) {
        require(_arbiter != address(0), "Invalid arbiter");
        require(_platformFeeBps <= 1000, "Fee too high");
        owner = msg.sender;
        arbiter = _arbiter;
        platformFeeBps = _platformFeeBps;
        fundingTimeout = DEFAULT_FUNDING_TIMEOUT;
        emit OwnershipTransferred(address(0), msg.sender);
        emit ArbiterChanged(address(0), _arbiter);
    }

    /// @notice Creates the on-chain escrow record without moving funds.
    function createDeal(address seller, uint256 amount) external returns (uint256 dealId) {
        require(seller != address(0) && seller != msg.sender, "Invalid seller");
        require(amount > 0, "Amount required");
        dealId = nextDealId++;
        deals[dealId] = Deal({
            buyer: msg.sender,
            seller: seller,
            amount: amount,
            createdAt: uint64(block.timestamp),
            fundedAt: 0,
            deliveredAt: 0,
            status: Status.Created
        });
        emit DealCreated(dealId, msg.sender, seller, amount);
    }

    /// @notice Buyer deposits exactly the agreed native XPT amount.
    function fundDeal(uint256 dealId) external payable {
        Deal storage d = deals[dealId];
        require(d.buyer != address(0), "Deal not found");
        require(msg.sender == d.buyer, "Only buyer");
        require(d.status == Status.Created, "Invalid status");
        require(msg.value == d.amount, "Incorrect amount");
        d.fundedAt = uint64(block.timestamp);
        d.status = Status.Funded;
        emit DealFunded(dealId, msg.value);
    }

    function markDelivered(uint256 dealId) external {
        Deal storage d = deals[dealId];
        require(d.status == Status.Funded, "Invalid status");
        require(msg.sender == d.seller, "Only seller");
        d.deliveredAt = uint64(block.timestamp);
        d.status = Status.Delivered;
        emit AssetDelivered(dealId);
    }

    function confirmAndRelease(uint256 dealId) external {
        Deal storage d = deals[dealId];
        require(d.status == Status.Delivered, "Not delivered");
        require(msg.sender == d.buyer, "Only buyer");
        _release(dealId, d);
    }

    function refund(uint256 dealId) external {
        Deal storage d = deals[dealId];
        require(d.status == Status.Funded, "Invalid status");
        require(msg.sender == d.buyer, "Only buyer");
        require(block.timestamp >= uint256(d.fundedAt) + fundingTimeout, "Timeout not reached");
        uint256 amount = d.amount;
        d.status = Status.Refunded;
        (bool ok,) = payable(d.buyer).call{value: amount}("");
        require(ok, "Refund failed");
        emit DealRefunded(dealId, amount);
    }

    function dispute(uint256 dealId) external {
        Deal storage d = deals[dealId];
        require(d.status == Status.Funded || d.status == Status.Delivered, "Invalid status");
        require(msg.sender == d.buyer || msg.sender == d.seller, "Not participant");
        d.status = Status.Disputed;
        emit DealDisputed(dealId, msg.sender);
    }

    function arbiterRelease(uint256 dealId) external onlyArbiter {
        Deal storage d = deals[dealId];
        require(d.status == Status.Disputed, "Not disputed");
        _release(dealId, d);
    }

    function arbiterRefund(uint256 dealId) external onlyArbiter {
        Deal storage d = deals[dealId];
        require(d.status == Status.Disputed, "Not disputed");
        uint256 amount = d.amount;
        d.status = Status.Refunded;
        (bool ok,) = payable(d.buyer).call{value: amount}("");
        require(ok, "Refund failed");
        emit DealRefunded(dealId, amount);
    }

    function setArbiter(address newArbiter) external onlyOwner {
        require(newArbiter != address(0), "Invalid arbiter");
        emit ArbiterChanged(arbiter, newArbiter);
        arbiter = newArbiter;
    }

    function setPlatformFeeBps(uint256 newBps) external onlyOwner {
        require(newBps <= 1000, "Fee too high");
        emit PlatformFeeChanged(platformFeeBps, newBps);
        platformFeeBps = newBps;
    }

    function setFundingTimeout(uint64 newTimeout) external onlyOwner {
        require(newTimeout >= 1 hours && newTimeout <= 30 days, "Invalid timeout");
        fundingTimeout = newTimeout;
    }

    function withdrawFees(address payable recipient) external onlyOwner {
        require(recipient != address(0), "Invalid recipient");
        uint256 amount = accumulatedFees;
        accumulatedFees = 0;
        (bool ok,) = recipient.call{value: amount}("");
        require(ok, "Withdraw failed");
        emit FeesWithdrawn(recipient, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function _release(uint256 dealId, Deal storage d) internal {
        uint256 fee = (d.amount * platformFeeBps) / 10000;
        uint256 sellerAmount = d.amount - fee;
        accumulatedFees += fee;
        d.status = Status.Released;
        (bool ok,) = payable(d.seller).call{value: sellerAmount}("");
        require(ok, "Release failed");
        emit DealReleased(dealId, sellerAmount, fee);
    }

    receive() external payable { revert("Use fundDeal"); }
}
