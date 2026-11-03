// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

// INTENTIONALLY VULNERABLE TEST FIXTURE.
// Never deploy this contract. It exists only to smoke-test static analyzers.
contract VulnerableVaultFixture {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "insufficient balance");
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "transfer failed");
        // Deliberate reentrancy: state is updated after the external call.
        balances[msg.sender] -= amount;
    }

    function unrestrictedSweep(address payable recipient, uint256 amount) external {
        // Deliberate missing access control for detector smoke testing.
        recipient.transfer(amount);
    }
}
