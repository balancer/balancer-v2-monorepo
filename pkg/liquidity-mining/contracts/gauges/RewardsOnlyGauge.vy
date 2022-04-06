# @version 0.3.1
"""
@title Rewards-Only Gauge
@author Curve Finance
@license MIT
@notice Distribution of third-party rewards without CRV
"""

from vyper.interfaces import ERC20

implements: ERC20

struct RewardToken:
    distributor: address
    period_finish: uint256
    rate: uint256
    duration: uint256
    received: uint256
    paid: uint256

interface Streamer:
    def reward_data(_token: address) -> RewardToken: view
    def last_update_time() -> uint256: view

interface ERC20Extended:
    def symbol() -> String[26]: view

interface ERC1271:
    def isValidSignature(_hash: bytes32, _signature: Bytes[65]) -> bytes32: view

event Deposit:
    provider: indexed(address)
    value: uint256

event Withdraw:
    provider: indexed(address)
    value: uint256

event Transfer:
    _from: indexed(address)
    _to: indexed(address)
    _value: uint256

event Approval:
    _owner: indexed(address)
    _spender: indexed(address)
    _value: uint256

struct Reward:
    token: address
    distributor: address
    period_finish: uint256
    rate: uint256
    last_update: uint256
    integral: uint256

MAX_REWARDS: constant(uint256) = 8
CLAIM_FREQUENCY: constant(uint256) = 3600

# keccak256("isValidSignature(bytes32,bytes)")[:4] << 224
ERC1271_MAGIC_VAL: constant(bytes32) = 0x1626ba7e00000000000000000000000000000000000000000000000000000000
VERSION: constant(String[8]) = "v1.0.0"

EIP712_TYPEHASH: constant(bytes32) = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
PERMIT_TYPEHASH: constant(bytes32) = keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)")

BAL_TOKEN: immutable(address)
BAL_VAULT: immutable(address)
AUTHORIZER_ADAPTOR: immutable(address)

lp_token: public(address)

balanceOf: public(HashMap[address, uint256])
totalSupply: public(uint256)
_allowance: HashMap[address, HashMap[address, uint256]]

name: public(String[64])
symbol: public(String[40])

# ERC2612
DOMAIN_SEPARATOR: public(bytes32)
nonces: public(HashMap[address, uint256])

# For tracking external rewards
_reward_data: uint256
reward_tokens: public(address[MAX_REWARDS])
reward_balances: public(HashMap[address, uint256])
# claimant -> default reward receiver
rewards_receiver: public(HashMap[address, address])

claim_sig: public(Bytes[4])

# reward token -> integral
reward_integral: public(HashMap[address, uint256])

# reward token -> claiming address -> integral
reward_integral_for: public(HashMap[address, HashMap[address, uint256]])

# user -> [uint128 claimable amount][uint128 claimed amount]
claim_data: HashMap[address, HashMap[address, uint256]]


@external
def __init__(_bal_token: address, _vault: address, _authorizerAdaptor: address):
    """
    @notice Contract constructor
    @param _vault Balancer Vault contract address
    """

    BAL_TOKEN = _bal_token
    BAL_VAULT = _vault
    AUTHORIZER_ADAPTOR = _authorizerAdaptor

    # prevent initialization of implementation
    self.lp_token = 0x000000000000000000000000000000000000dEaD

@view
@external
def decimals() -> uint256:
    """
    @notice Get the number of decimals for this token
    @dev Implemented as a view method to reduce gas costs
    @return uint256 decimal places
    """
    return 18

@view
@external
def version() -> String[8]:
    """
    @notice Get the version of this gauge contract
    """
    return VERSION

@view
@internal
def _get_allowance(owner: address, spender: address) -> uint256:
    """
     @dev Override to grant the Vault infinite allowance, causing for Gauge Tokens to not require approval.
     This is sound as the Vault already provides authorization mechanisms when initiating token transfers, which this
     contract inherits.
    """
    if (spender == BAL_VAULT):
        return MAX_UINT256
    return self._allowance[owner][spender]

@internal
def _checkpoint_rewards(_user: address, _total_supply: uint256, _claim: bool, _receiver: address):
    """
    @notice Claim pending rewards and checkpoint rewards for a user
    """
    # claim from reward contract

    reward_data: uint256 = self._reward_data
    if _total_supply != 0 and reward_data != 0 and block.timestamp > shift(reward_data, -160) + CLAIM_FREQUENCY:
        reward_contract: address = convert(reward_data % 2**160, address)
        raw_call(reward_contract, self.claim_sig)  # dev: bad claim sig
        self._reward_data = convert(reward_contract, uint256) + shift(block.timestamp, 160)

    receiver: address = _receiver
    if _claim and receiver == ZERO_ADDRESS:
        # if receiver is not explicitly declared, check for default receiver
        receiver = self.rewards_receiver[_user]
        if receiver == ZERO_ADDRESS:
            # direct claims to user if no default receiver is set
            receiver = _user

    # calculate new user reward integral and transfer any owed rewards
    user_balance: uint256 = self.balanceOf[_user]
    for i in range(MAX_REWARDS):
        token: address = self.reward_tokens[i]
        if token == ZERO_ADDRESS:
            break
        dI: uint256 = 0
        if _total_supply != 0:
            token_balance: uint256 = ERC20(token).balanceOf(self)
            dI = 10**18 * (token_balance - self.reward_balances[token]) / _total_supply
            self.reward_balances[token] = token_balance
            if _user == ZERO_ADDRESS:
                if dI != 0:
                    self.reward_integral[token] += dI
                continue

        integral: uint256 = self.reward_integral[token] + dI
        if dI != 0:
            self.reward_integral[token] = integral

        integral_for: uint256 = self.reward_integral_for[token][_user]
        new_claimable: uint256 = 0
        if integral_for < integral:
            self.reward_integral_for[token][_user] = integral
            new_claimable = user_balance * (integral - integral_for) / 10**18

        claim_data: uint256 = self.claim_data[_user][token]
        total_claimable: uint256 = shift(claim_data, -128) + new_claimable
        if total_claimable > 0:
            total_claimed: uint256 = claim_data % 2 ** 128
            if _claim:
                response: Bytes[32] = raw_call(
                    token,
                    concat(
                        method_id("transfer(address,uint256)"),
                        convert(receiver, bytes32),
                        convert(total_claimable, bytes32),
                    ),
                    max_outsize=32,
                )
                if len(response) != 0:
                    assert convert(response, bool)
                self.reward_balances[token] -= total_claimable
                # update amount claimed (lower order bytes)
                self.claim_data[_user][token] = total_claimed + total_claimable
            elif new_claimable > 0:
                # update total_claimable (higher order bytes)
                self.claim_data[_user][token] = total_claimed + shift(total_claimable, 128)


@view
@external
def reward_contract() -> address:
    """
    @notice Address of the reward contract providing non-CRV incentives for this gauge
    @dev Returns `ZERO_ADDRESS` if there is no reward contract active
    """
    return convert(self._reward_data % 2**160, address)


@view
@external
def last_claim() -> uint256:
    """
    @notice Epoch timestamp of the last call to claim from `reward_contract`
    @dev Rewards are claimed at most once per hour in order to reduce gas costs
    """
    return shift(self._reward_data, -160)


@view
@external
def claimed_reward(_addr: address, _token: address) -> uint256:
    """
    @notice Get the number of already-claimed reward tokens for a user
    @param _addr Account to get reward amount for
    @param _token Token to get reward amount for
    @return uint256 Total amount of `_token` already claimed by `_addr`
    """
    return self.claim_data[_addr][_token] % 2**128


@view
@external
def claimable_reward(_addr: address, _token: address) -> uint256:
    """
    @notice Get the number of claimable reward tokens for a user
    @dev This call does not consider pending claimable amount in `reward_contract`.
         Off-chain callers should instead use `claimable_rewards_write` as a
         view method.
    @param _addr Account to get reward amount for
    @param _token Token to get reward amount for
    @return uint256 Claimable reward token amount
    """
    return shift(self.claim_data[_addr][_token], -128)

@view
@external
def reward_data(_token: address) -> Reward:
    reward_contract: address = convert(self._reward_data % 2**160, address)
    reward_token: RewardToken = Streamer(reward_contract).reward_data(_token)
    last_update_time: uint256 = Streamer(reward_contract).last_update_time()
    return Reward({
        token: _token,
        distributor: reward_token.distributor,
        period_finish: reward_token.period_finish,
        rate: reward_token.rate,
        last_update: last_update_time,
        integral: self.reward_integral[_token]
    })


@external
@nonreentrant('lock')
def claimable_reward_write(_addr: address, _token: address) -> uint256:
    """
    @notice Get the number of claimable reward tokens for a user
    @dev This function should be manually changed to "view" in the ABI
         Calling it via a transaction will claim available reward tokens
    @param _addr Account to get reward amount for
    @param _token Token to get reward amount for
    @return uint256 Claimable reward token amount
    """
    if self.reward_tokens[0] != ZERO_ADDRESS:
        self._checkpoint_rewards(_addr, self.totalSupply, False, ZERO_ADDRESS)
    return shift(self.claim_data[_addr][_token], -128)


@external
def set_rewards_receiver(_receiver: address):
    """
    @notice Set the default reward receiver for the caller.
    @dev When set to ZERO_ADDRESS, rewards are sent to the caller
    @param _receiver Receiver address for any rewards claimed via `claim_rewards`
    """
    self.rewards_receiver[msg.sender] = _receiver


@external
@nonreentrant('lock')
def claim_rewards(_addr: address = msg.sender, _receiver: address = ZERO_ADDRESS):
    """
    @notice Claim available reward tokens for `_addr`
    @param _addr Address to claim for
    @param _receiver Address to transfer rewards to - if set to
                     ZERO_ADDRESS, uses the default reward receiver
                     for the caller
    """
    if _receiver != ZERO_ADDRESS:
        assert _addr == msg.sender  # dev: cannot redirect when claiming for another user
    self._checkpoint_rewards(_addr, self.totalSupply, True, _receiver)


@external
@nonreentrant('lock')
def deposit(_value: uint256, _addr: address = msg.sender, _claim_rewards: bool = False):
    """
    @notice Deposit `_value` LP tokens
    @dev Depositting also claims pending reward tokens
    @param _value Number of tokens to deposit
    @param _addr Address to deposit for
    """
    if _value != 0:
        reward_contract: address = convert(self._reward_data % 2**160, address)
        total_supply: uint256 = self.totalSupply

        self._checkpoint_rewards(_addr, total_supply, _claim_rewards, ZERO_ADDRESS)

        total_supply += _value
        new_balance: uint256 = self.balanceOf[_addr] + _value
        self.balanceOf[_addr] = new_balance
        self.totalSupply = total_supply

        ERC20(self.lp_token).transferFrom(msg.sender, self, _value)

    log Deposit(_addr, _value)
    log Transfer(ZERO_ADDRESS, _addr, _value)


@external
@nonreentrant('lock')
def withdraw(_value: uint256, _claim_rewards: bool = False):
    """
    @notice Withdraw `_value` LP tokens
    @dev Withdrawing also claims pending reward tokens
    @param _value Number of tokens to withdraw
    """
    if _value != 0:
        reward_contract: address = convert(self._reward_data % 2**160, address)
        total_supply: uint256 = self.totalSupply

        self._checkpoint_rewards(msg.sender, total_supply, _claim_rewards, ZERO_ADDRESS)

        total_supply -= _value
        new_balance: uint256 = self.balanceOf[msg.sender] - _value
        self.balanceOf[msg.sender] = new_balance
        self.totalSupply = total_supply

        ERC20(self.lp_token).transfer(msg.sender, _value)

    log Withdraw(msg.sender, _value)
    log Transfer(msg.sender, ZERO_ADDRESS, _value)


@internal
def _transfer(_from: address, _to: address, _value: uint256):
    reward_contract: address = convert(self._reward_data % 2**160, address)

    if _value != 0:
        total_supply: uint256 = self.totalSupply
        self._checkpoint_rewards(_from, total_supply, False, ZERO_ADDRESS)
        new_balance: uint256 = self.balanceOf[_from] - _value
        self.balanceOf[_from] = new_balance

        self._checkpoint_rewards(_to, total_supply, False, ZERO_ADDRESS)
        new_balance = self.balanceOf[_to] + _value
        self.balanceOf[_to] = new_balance

    log Transfer(_from, _to, _value)


@external
@nonreentrant('lock')
def transfer(_to : address, _value : uint256) -> bool:
    """
    @notice Transfer token for a specified address
    @dev Transferring claims pending reward tokens for the sender and receiver
    @param _to The address to transfer to.
    @param _value The amount to be transferred.
    """
    self._transfer(msg.sender, _to, _value)

    return True


@external
@nonreentrant('lock')
def transferFrom(_from : address, _to : address, _value : uint256) -> bool:
    """
    @notice Transfer tokens from one address to another.
    @dev Transferring claims pending reward tokens for the sender and receiver
    @param _from address The address which you want to send tokens from
    @param _to address The address which you want to transfer to
    @param _value uint256 the amount of tokens to be transferred
    """
    _allowance: uint256 = self._get_allowance(_from, msg.sender)
    if _allowance != MAX_UINT256:
        self._allowance[_from][msg.sender] = _allowance - _value

    self._transfer(_from, _to, _value)

    return True

@view
@external
def allowance(owner: address, spender: address) -> uint256:
    """
     @notice Get `spender`'s current allowance from `owner` 
    """
    return self._get_allowance(owner, spender)

@external
def approve(_spender : address, _value : uint256) -> bool:
    """
    @notice Approve the passed address to transfer the specified amount of
            tokens on behalf of msg.sender
    @dev Beware that changing an allowance via this method brings the risk
         that someone may use both the old and new allowance by unfortunate
         transaction ordering. This may be mitigated with the use of
         {incraseAllowance} and {decreaseAllowance}.
         https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
    @param _spender The address which will transfer the funds
    @param _value The amount of tokens that may be transferred
    @return bool success
    """
    self._allowance[msg.sender][_spender] = _value
    log Approval(msg.sender, _spender, _value)

    return True

@external
def permit(
    _owner: address,
    _spender: address,
    _value: uint256,
    _deadline: uint256,
    _v: uint8,
    _r: bytes32,
    _s: bytes32
) -> bool:
    """
    @notice Approves spender by owner's signature to expend owner's tokens.
        See https://eips.ethereum.org/EIPS/eip-2612.
    @dev Inspired by https://github.com/yearn/yearn-vaults/blob/main/contracts/Vault.vy#L753-L793
    @dev Supports smart contract wallets which implement ERC1271
        https://eips.ethereum.org/EIPS/eip-1271
    @param _owner The address which is a source of funds and has signed the Permit.
    @param _spender The address which is allowed to spend the funds.
    @param _value The amount of tokens to be spent.
    @param _deadline The timestamp after which the Permit is no longer valid.
    @param _v The bytes[64] of the valid secp256k1 signature of permit by owner
    @param _r The bytes[0:32] of the valid secp256k1 signature of permit by owner
    @param _s The bytes[32:64] of the valid secp256k1 signature of permit by owner
    @return True, if transaction completes successfully
    """
    assert _owner != ZERO_ADDRESS
    assert block.timestamp <= _deadline

    nonce: uint256 = self.nonces[_owner]
    digest: bytes32 = keccak256(
        concat(
            b"\x19\x01",
            self.DOMAIN_SEPARATOR,
            keccak256(_abi_encode(PERMIT_TYPEHASH, _owner, _spender, _value, nonce, _deadline))
        )
    )

    if _owner.is_contract:
        sig: Bytes[65] = concat(_abi_encode(_r, _s), slice(convert(_v, bytes32), 31, 1))
        # reentrancy not a concern since this is a staticcall
        assert ERC1271(_owner).isValidSignature(digest, sig) == ERC1271_MAGIC_VAL
    else:
        assert ecrecover(digest, convert(_v, uint256), convert(_r, uint256), convert(_s, uint256)) == _owner

    self._allowance[_owner][_spender] = _value
    self.nonces[_owner] = nonce + 1

    log Approval(_owner, _spender, _value)
    return True

@external
def increaseAllowance(_spender: address, _added_value: uint256) -> bool:
    """
    @notice Increase the allowance granted to `_spender` by the caller
    @dev This is alternative to {approve} that can be used as a mitigation for
         the potential race condition
    @param _spender The address which will transfer the funds
    @param _added_value The amount of to increase the allowance
    @return bool success
    """
    allowance: uint256 = self._get_allowance(msg.sender, _spender) + _added_value
    self._allowance[msg.sender][_spender] = allowance

    log Approval(msg.sender, _spender, allowance)

    return True


@external
def decreaseAllowance(_spender: address, _subtracted_value: uint256) -> bool:
    """
    @notice Decrease the allowance granted to `_spender` by the caller
    @dev This is alternative to {approve} that can be used as a mitigation for
         the potential race condition
    @param _spender The address which will transfer the funds
    @param _subtracted_value The amount of to decrease the allowance
    @return bool success
    """
    allowance: uint256 = self._get_allowance(msg.sender, _spender) - _subtracted_value
    self._allowance[msg.sender][_spender] = allowance

    log Approval(msg.sender, _spender, allowance)

    return True

@internal
def _set_rewards(_reward_contract: address, _claim_sig: bytes32, _reward_tokens: address[MAX_REWARDS]):
    """
    @notice Set the active reward contract
    @dev A reward contract cannot be set while this contract has no deposits
    @param _reward_contract Reward contract address. Set to ZERO_ADDRESS to
                            disable staking.
    @param _claim_sig Four byte selectors for staking, withdrawing and claiming,
                 left padded with zero bytes. If the reward contract can
                 be claimed from but does not require staking, the staking
                 and withdraw selectors should be set to 0x00
    @param _reward_tokens List of claimable reward tokens. New reward tokens
                          may be added but they cannot be removed. When calling
                          this function to unset or modify a reward contract,
                          this array must begin with the already-set reward
                          token addresses.
    """
    lp_token: address = self.lp_token
    current_reward_contract: address = convert(self._reward_data % 2**160, address)
    total_supply: uint256 = self.totalSupply
    self._checkpoint_rewards(ZERO_ADDRESS, total_supply, False, ZERO_ADDRESS)

    if _reward_contract != ZERO_ADDRESS:
        assert _reward_tokens[0] != ZERO_ADDRESS  # dev: no reward token
        assert _reward_contract.is_contract  # dev: not a contract

    self._reward_data = convert(_reward_contract, uint256)
    self.claim_sig = slice(_claim_sig, 28, 4)
    for i in range(MAX_REWARDS):
        current_token: address = self.reward_tokens[i]
        new_token: address = _reward_tokens[i]
        if current_token != ZERO_ADDRESS:
            assert current_token == new_token  # dev: cannot modify existing reward token
        elif new_token != ZERO_ADDRESS:
            self.reward_tokens[i] = new_token
        else:
            break

    if _reward_contract != ZERO_ADDRESS:
        # do an initial checkpoint to verify that claims are working
        self._checkpoint_rewards(ZERO_ADDRESS, total_supply, False, ZERO_ADDRESS)

@external
@nonreentrant('lock')
def set_rewards(_reward_contract: address, _claim_sig: bytes32, _reward_tokens: address[MAX_REWARDS]):
    """
    @notice Set the active reward contract
    @dev A reward contract cannot be set while this contract has no deposits
    @param _reward_contract Reward contract address. Set to ZERO_ADDRESS to
                            disable staking.
    @param _claim_sig Four byte selectors for staking, withdrawing and claiming,
                 left padded with zero bytes. If the reward contract can
                 be claimed from but does not require staking, the staking
                 and withdraw selectors should be set to 0x00
    @param _reward_tokens List of claimable reward tokens. New reward tokens
                          may be added but they cannot be removed. When calling
                          this function to unset or modify a reward contract,
                          this array must begin with the already-set reward
                          token addresses.
    """
    assert msg.sender == AUTHORIZER_ADAPTOR  # dev: only owner
    self._set_rewards(_reward_contract, _claim_sig, _reward_tokens)

# Initializer

@external
def initialize(_lp_token: address, _reward_contract: address, _claim_sig: bytes32):
    """
    @notice Contract constructor
    @param _lp_token Liquidity Pool contract address
    """
    assert self.lp_token == ZERO_ADDRESS
    assert _lp_token != ZERO_ADDRESS

    self.lp_token = _lp_token

    symbol: String[32] = ERC20Extended(_lp_token).symbol()
    name: String[64] = concat("Balancer ", symbol, " RewardGauge Deposit")

    self.name = name
    self.symbol = concat(symbol, "-gauge")

    self.DOMAIN_SEPARATOR = keccak256(
        _abi_encode(EIP712_TYPEHASH, keccak256(name), keccak256(VERSION), chain.id, self)
    )

    # Initialise connection to ChildChainStreamer contract
    reward_tokens: address[MAX_REWARDS] = empty(address[MAX_REWARDS])
    reward_tokens[0] = BAL_TOKEN
    self._set_rewards(_reward_contract, _claim_sig, reward_tokens)
