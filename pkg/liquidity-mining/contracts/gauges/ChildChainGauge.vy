# @version 0.3.3
"""
@title Child Liquidity Gauge
@license MIT
@author Curve Finance
"""
from vyper.interfaces import ERC20

implements: ERC20


interface ERC20Extended:
    def symbol() -> String[26]: view

interface Minter:
    def minted(_user: address, _gauge: address) -> uint256: view
    def getBalancerToken() -> address: view

interface ERC1271:
    def isValidSignature(_hash: bytes32, _signature: Bytes[65]) -> bytes32: view

interface AuthorizerAdaptor:
    def getVault() -> address: view

interface VotingEscrowDelegationProxy:
    def totalSupply() -> uint256: view
    def adjustedBalanceOf(_account: address) -> uint256: view


event Approval:
    _owner: indexed(address)
    _spender: indexed(address)
    _value: uint256

event Transfer:
    _from: indexed(address)
    _to: indexed(address)
    _value: uint256

event Deposit:
    _user: indexed(address)
    _value: uint256

event Withdraw:
    _user: indexed(address)
    _value: uint256

event UpdateLiquidityLimit:
    _user: indexed(address)
    _original_balance: uint256
    _original_supply: uint256
    _working_balance: uint256
    _working_supply: uint256


struct Reward:
    distributor: address
    period_finish: uint256
    rate: uint256
    last_update: uint256
    integral: uint256


DOMAIN_TYPE_HASH: constant(bytes32) = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
PERMIT_TYPE_HASH: constant(bytes32) = keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)")
ERC1271_MAGIC_VAL: constant(bytes32) = 0x1626ba7e00000000000000000000000000000000000000000000000000000000

MAX_REWARDS: constant(uint256) = 8
TOKENLESS_PRODUCTION: constant(uint256) = 40
WEEK: constant(uint256) = 86400 * 7


BAL: immutable(address)
BAL_PSEUDO_MINTER: immutable(address)
VE_DELEGATION_PROXY: immutable(address)
BAL_VAULT: immutable(address)
AUTHORIZER_ADAPTOR: immutable(address)

DOMAIN_SEPARATOR: public(bytes32)
nonces: public(HashMap[address, uint256])

name: public(String[64])
symbol: public(String[32])

_allowance: HashMap[address, HashMap[address, uint256]]
balanceOf: public(HashMap[address, uint256])
totalSupply: public(uint256)

lp_token: public(address)
version: public(String[128])
factory: public(address)

working_balances: public(HashMap[address, uint256])
working_supply: public(uint256)

period: public(uint256)
period_timestamp: public(HashMap[uint256, uint256])

integrate_checkpoint_of: public(HashMap[address, uint256])
integrate_fraction: public(HashMap[address, uint256])
integrate_inv_supply: public(HashMap[uint256, uint256])
integrate_inv_supply_of: public(HashMap[address, uint256])

# For tracking external rewards
reward_count: public(uint256)
reward_tokens: public(address[MAX_REWARDS])
reward_data: public(HashMap[address, Reward])
# claimant -> default reward receiver
rewards_receiver: public(HashMap[address, address])
# reward token -> claiming address -> integral
reward_integral_for: public(HashMap[address, HashMap[address, uint256]])
# user -> token -> [uint128 claimable amount][uint128 claimed amount]
claim_data: HashMap[address, HashMap[address, uint256]]

is_killed: public(bool)
inflation_rate: public(HashMap[uint256, uint256])


@external
def __init__(
    _voting_escrow_delegation_proxy: address,
    _bal_pseudo_minter: address,
    _authorizer_adaptor: address,
    _version: String[128]
):
    self.lp_token = 0x000000000000000000000000000000000000dEaD
    self.version = _version
    self.factory = 0x000000000000000000000000000000000000dEaD

    VE_DELEGATION_PROXY = _voting_escrow_delegation_proxy
    BAL_PSEUDO_MINTER = _bal_pseudo_minter
    BAL = Minter(_bal_pseudo_minter).getBalancerToken()
    AUTHORIZER_ADAPTOR = _authorizer_adaptor
    BAL_VAULT = AuthorizerAdaptor(_authorizer_adaptor).getVault()


@internal
def _checkpoint(_user: address):
    """
    @notice Checkpoint a user calculating their BAL entitlement
    @param _user User address
    """
    period: uint256 = self.period
    period_time: uint256 = self.period_timestamp[period]
    integrate_inv_supply: uint256 = self.integrate_inv_supply[period]

    # If killed, we skip accumulating inflation in `integrate_inv_supply`
    if block.timestamp > period_time and not self.is_killed:

        working_supply: uint256 = self.working_supply
        prev_week_time: uint256 = period_time
        week_time: uint256 = min((period_time + WEEK) / WEEK * WEEK, block.timestamp)

        for i in range(256):
            dt: uint256 = week_time - prev_week_time

            if working_supply != 0:
                # we don't have to worry about crossing inflation epochs
                # and if we miss any weeks, those weeks inflation rates will be 0 for sure
                # but that means no one interacted with the gauge for that long
                integrate_inv_supply += self.inflation_rate[prev_week_time / WEEK] * 10 ** 18 * dt / working_supply

            if week_time == block.timestamp:
                break
            prev_week_time = week_time
            week_time = min(week_time + WEEK, block.timestamp)

    # check BAL balance and increase weekly inflation rate by delta for the rest of the week
    bal_balance: uint256 = ERC20(BAL).balanceOf(self)
    if bal_balance != 0:
        current_week: uint256 = block.timestamp / WEEK
        self.inflation_rate[current_week] += bal_balance / ((current_week + 1) * WEEK - block.timestamp)
        ERC20(BAL).transfer(BAL_PSEUDO_MINTER, bal_balance)

    period += 1
    self.period = period
    self.period_timestamp[period] = block.timestamp
    self.integrate_inv_supply[period] = integrate_inv_supply

    working_balance: uint256 = self.working_balances[_user]
    self.integrate_fraction[_user] += working_balance * (integrate_inv_supply - self.integrate_inv_supply_of[_user]) / 10 ** 18
    self.integrate_inv_supply_of[_user] = integrate_inv_supply
    self.integrate_checkpoint_of[_user] = block.timestamp


@internal
def _update_liquidity_limit(_user: address, _user_balance: uint256, _total_supply: uint256):
    """
    @notice Calculate working balances to apply amplification of BAL production.
    @param _user The user address
    @param _user_balance User's amount of liquidity (LP tokens)
    @param _total_supply Total amount of liquidity (LP tokens)
    """
    working_balance: uint256 = _user_balance * TOKENLESS_PRODUCTION / 100

    ve: address = VE_DELEGATION_PROXY
    if ve != ZERO_ADDRESS:
        ve_ts: uint256 = VotingEscrowDelegationProxy(ve).totalSupply()
        if ve_ts != 0:
            ve_user_balance: uint256 = VotingEscrowDelegationProxy(ve).adjustedBalanceOf(_user)
            working_balance += _total_supply * ve_user_balance / ve_ts * (100 - TOKENLESS_PRODUCTION) / 100
            working_balance = min(_user_balance, working_balance)

    old_working_balance: uint256 = self.working_balances[_user]
    self.working_balances[_user] = working_balance

    working_supply: uint256 = self.working_supply + working_balance - old_working_balance
    self.working_supply = working_supply

    log UpdateLiquidityLimit(_user, _user_balance, _total_supply, working_balance, working_supply)


@view
@internal
def _all_indexes() -> DynArray[uint256, MAX_REWARDS]:
    indexes: DynArray[uint256, MAX_REWARDS] = []
    for i in range(MAX_REWARDS):
        if i >= self.reward_count:
            break
        indexes.append(i)

    return indexes


@internal
def _checkpoint_rewards(
    _user: address,
    _total_supply: uint256,
    _claim: bool,
    _receiver: address,
    _input_reward_indexes: DynArray[uint256, MAX_REWARDS]
):
    """
    @notice Claim pending rewards and checkpoint rewards for a user
    """
    user_balance: uint256 = 0
    receiver: address = _receiver
    if _user != ZERO_ADDRESS:
        user_balance = self.balanceOf[_user]
        if _claim and _receiver == ZERO_ADDRESS:
            # if receiver is not explicitly declared, check if a default receiver is set
            receiver = self.rewards_receiver[_user]
            if receiver == ZERO_ADDRESS:
                # if no default receiver is set, direct claims to the user
                receiver = _user

    reward_count: uint256 = self.reward_count
    reward_indexes: DynArray[uint256, MAX_REWARDS] = []
    if len(_input_reward_indexes) == 0:
        reward_indexes = self._all_indexes()
    else:
        reward_indexes = _input_reward_indexes

    for i in reward_indexes:
        assert i < reward_count, "INVALID_REWARD_INDEX"

        token: address = self.reward_tokens[i]

        integral: uint256 = self.reward_data[token].integral
        last_update: uint256 = min(block.timestamp, self.reward_data[token].period_finish)
        duration: uint256 = last_update - self.reward_data[token].last_update
        if duration != 0:
            self.reward_data[token].last_update = last_update
            if _total_supply != 0:
                integral += duration * self.reward_data[token].rate * 10**18 / _total_supply
                self.reward_data[token].integral = integral

        if _user != ZERO_ADDRESS:
            integral_for: uint256 = self.reward_integral_for[token][_user]
            new_claimable: uint256 = 0

            if integral_for < integral:
                self.reward_integral_for[token][_user] = integral
                new_claimable = user_balance * (integral - integral_for) / 10**18

            claim_data: uint256 = self.claim_data[_user][token]
            total_claimable: uint256 = shift(claim_data, -128) + new_claimable
            if total_claimable > 0:
                total_claimed: uint256 = claim_data % 2**128
                if _claim:
                    response: Bytes[32] = raw_call(
                        token,
                        _abi_encode(
                            receiver,
                            total_claimable,
                            method_id=method_id("transfer(address,uint256)")
                        ),
                        max_outsize=32,
                    )
                    if len(response) != 0:
                        assert convert(response, bool), "TRANSFER_FAILURE"
                    self.claim_data[_user][token] = total_claimed + total_claimable
                elif new_claimable > 0:
                    self.claim_data[_user][token] = total_claimed + shift(total_claimable, 128)


@internal
def _transfer(_from: address, _to: address, _value: uint256):
    if _value == 0:
        return
    total_supply: uint256 = self.totalSupply

    has_rewards: bool = self.reward_count != 0
    for addr in [_from, _to]:
        self._checkpoint(addr)
        # We need to checkpoint all of the rewards before affecting the gauge token balance for a user,
        # but to do it safely we need to skip making external calls. Therefore, we set _claim to False.
        self._checkpoint_rewards(addr, total_supply, False, ZERO_ADDRESS, [])

    new_balance: uint256 = self.balanceOf[_from] - _value
    self.balanceOf[_from] = new_balance
    self._update_liquidity_limit(_from, new_balance, total_supply)

    new_balance = self.balanceOf[_to] + _value
    self.balanceOf[_to] = new_balance
    self._update_liquidity_limit(_to, new_balance, total_supply)

    log Transfer(_from, _to, _value)


@external
@nonreentrant("lock")
def deposit(_value: uint256, _user: address = msg.sender):
    """
    @notice Deposit `_value` LP tokens
    @param _value Number of tokens to deposit
    @param _user The account to send gauge tokens to
    """
    self._checkpoint(_user)
    if _value == 0:
        return

    total_supply: uint256 = self.totalSupply
    new_balance: uint256 = self.balanceOf[_user] + _value

    if self.reward_count != 0:
        # We need to checkpoint all of the rewards before affecting the gauge token balance for a user,
        # but to do it safely we need to skip making external calls. Therefore, we set _claim to False.
        self._checkpoint_rewards(_user, total_supply, False, ZERO_ADDRESS, [])

    total_supply += _value

    self.balanceOf[_user] = new_balance
    self.totalSupply = total_supply

    self._update_liquidity_limit(_user, new_balance, total_supply)

    ERC20(self.lp_token).transferFrom(msg.sender, self, _value)

    log Deposit(_user, _value)
    log Transfer(ZERO_ADDRESS, _user, _value)


@external
@nonreentrant("lock")
def withdraw(_value: uint256, _user: address = msg.sender):
    """
    @notice Withdraw `_value` LP tokens
    @param _value Number of tokens to withdraw
    @param _user The account to send LP tokens to
    """
    self._checkpoint(_user)
    if _value == 0:
        return

    total_supply: uint256 = self.totalSupply
    new_balance: uint256 = self.balanceOf[msg.sender] - _value

    if self.reward_count != 0:
        # We need to checkpoint all of the rewards before affecting the gauge token balance for a user,
        # but to do it safely we need to skip making external calls. Therefore, we set _claim to False.
        self._checkpoint_rewards(_user, total_supply, False, ZERO_ADDRESS, [])

    total_supply -= _value

    self.balanceOf[msg.sender] = new_balance
    self.totalSupply = total_supply

    self._update_liquidity_limit(msg.sender, new_balance, total_supply)

    ERC20(self.lp_token).transfer(_user, _value)

    log Withdraw(_user, _value)
    log Transfer(msg.sender, ZERO_ADDRESS, _value)


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

@external
@nonreentrant("lock")
def transferFrom(_from: address, _to: address, _value: uint256) -> bool:
    """
    @notice Transfer tokens from one address to another
    @param _from The address which you want to send tokens from
    @param _to The address which you want to transfer to
    @param _value the amount of tokens to be transferred
    @return bool success
    """
    allowance: uint256 = self._get_allowance(_from, msg.sender)
    if allowance != MAX_UINT256:
        self._allowance[_from][msg.sender] = allowance - _value

    self._transfer(_from, _to, _value)
    return True


@external
def approve(_spender: address, _value: uint256) -> bool:
    """
    @notice Approve the passed address to transfer the specified amount of
            tokens on behalf of msg.sender
    @dev Beware that changing an allowance via this method brings the risk
         that someone may use both the old and new allowance by unfortunate
         transaction ordering. This may be mitigated with the use of
         {increaseAllowance} and {decreaseAllowance}.
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
    assert _owner != ZERO_ADDRESS, "INVALID_OWNER"
    assert block.timestamp <= _deadline, "DEADLINE_EXPIRED"

    nonce: uint256 = self.nonces[_owner]
    digest: bytes32 = keccak256(
        concat(
            b"\x19\x01",
            self.DOMAIN_SEPARATOR,
            keccak256(_abi_encode(PERMIT_TYPE_HASH, _owner, _spender, _value, nonce, _deadline))
        )
    )

    if _owner.is_contract:
        sig: Bytes[65] = concat(_abi_encode(_r, _s), slice(convert(_v, bytes32), 31, 1))
        assert ERC1271(_owner).isValidSignature(digest, sig) == ERC1271_MAGIC_VAL, "INVALID_SIG"
    else:
        recovered_address: address = ecrecover(digest, convert(_v, uint256), convert(_r, uint256), convert(_s, uint256))
        assert recovered_address == _owner,"INVALID_SIG"

    self._allowance[_owner][_spender] = _value
    self.nonces[_owner] = nonce + 1

    log Approval(_owner, _spender, _value)
    return True


@external
@nonreentrant("lock")
def transfer(_to: address, _value: uint256) -> bool:
    """
    @notice Transfer token to a specified address
    @param _to The address to transfer to
    @param _value The amount to be transferred
    @return bool success
    """
    self._transfer(msg.sender, _to, _value)
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


@external
def user_checkpoint(addr: address) -> bool:
    """
    @notice Record a checkpoint for `addr`
    @param addr User address
    @return bool success
    """
    self._checkpoint(addr)
    self._update_liquidity_limit(addr, self.balanceOf[addr], self.totalSupply)
    return True


@external
def claimable_tokens(addr: address) -> uint256:
    """
    @notice Get the number of claimable tokens per user
    @dev This function should be manually changed to "view" in the ABI
    @return uint256 number of claimable tokens per user
    """
    self._checkpoint(addr)
    return self.integrate_fraction[addr] - Minter(BAL_PSEUDO_MINTER).minted(addr, self)


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
def claimable_reward(_user: address, _reward_token: address) -> uint256:
    """
    @notice Get the number of claimable reward tokens for a user
    @param _user Account to get reward amount for
    @param _reward_token Token to get reward amount for
    @return uint256 Claimable reward token amount
    """
    integral: uint256 = self.reward_data[_reward_token].integral
    total_supply: uint256 = self.totalSupply
    if total_supply != 0:
        last_update: uint256 = min(block.timestamp, self.reward_data[_reward_token].period_finish)
        duration: uint256 = last_update - self.reward_data[_reward_token].last_update
        integral += (duration * self.reward_data[_reward_token].rate * 10**18 / total_supply)

    integral_for: uint256 = self.reward_integral_for[_reward_token][_user]
    new_claimable: uint256 = self.balanceOf[_user] * (integral - integral_for) / 10**18

    return shift(self.claim_data[_user][_reward_token], -128) + new_claimable


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
def claim_rewards(
    _addr: address = msg.sender,
    _receiver: address = ZERO_ADDRESS,
    _reward_indexes: DynArray[uint256, MAX_REWARDS] = []
):
    """
    @notice Claim available reward tokens for `_addr`
    @param _addr Address to claim for
    @param _receiver Address to transfer rewards to - if set to
                     ZERO_ADDRESS, uses the default reward receiver
                     for the caller
    @param _reward_indexes Array with indexes of the rewards to be checkpointed (all of them by default)
    """
    if _receiver != ZERO_ADDRESS:
        assert _addr == msg.sender, "CANNOT_REDIRECT_CLAIM"  # dev: cannot redirect when claiming for another user
    self._checkpoint_rewards(_addr, self.totalSupply, True, _receiver, _reward_indexes)


@external
def add_reward(_reward_token: address, _distributor: address):
    """
    @notice Set the active reward contract.
    @dev The reward token cannot be BAL, since it is transferred automatically to the pseudo minter during checkpoints.
    """
    assert msg.sender == AUTHORIZER_ADAPTOR, "SENDER_NOT_ALLOWED"  # dev: only owner
    assert _reward_token != BAL, "CANNOT_ADD_BAL_REWARD"

    reward_count: uint256 = self.reward_count
    assert reward_count < MAX_REWARDS, "MAX_REWARDS_REACHED"
    assert self.reward_data[_reward_token].distributor == ZERO_ADDRESS, "REWARD_ALREADY_EXISTS"

    self.reward_data[_reward_token].distributor = _distributor
    self.reward_tokens[reward_count] = _reward_token
    self.reward_count = reward_count + 1


@external
def set_reward_distributor(_reward_token: address, _distributor: address):
    current_distributor: address = self.reward_data[_reward_token].distributor

    assert msg.sender in [current_distributor, AUTHORIZER_ADAPTOR], "SENDER_NOT_ALLOWED"
    assert current_distributor != ZERO_ADDRESS, "REWARD_NOT_ADDED"
    assert _distributor != ZERO_ADDRESS, "INVALID_DISTRIBUTOR"

    self.reward_data[_reward_token].distributor = _distributor


@external
@nonreentrant("lock")
def deposit_reward_token(_reward_token: address, _amount: uint256):
    assert msg.sender == self.reward_data[_reward_token].distributor, "SENDER_NOT_ALLOWED"

    # It is safe to checkpoint all the existing rewards as long as `_claim` is set to false (i.e. no external calls).
    self._checkpoint_rewards(ZERO_ADDRESS, self.totalSupply, False, ZERO_ADDRESS, [])

    response: Bytes[32] = raw_call(
        _reward_token,
        _abi_encode(
            msg.sender,
            self,
            _amount,
            method_id=method_id("transferFrom(address,address,uint256)")
        ),
        max_outsize=32,
    )
    if len(response) != 0:
        assert convert(response, bool), "TRANSFER_FROM_FAILURE"

    period_finish: uint256 = self.reward_data[_reward_token].period_finish
    if block.timestamp >= period_finish:
        self.reward_data[_reward_token].rate = _amount / WEEK
    else:
        remaining: uint256 = period_finish - block.timestamp
        leftover: uint256 = remaining * self.reward_data[_reward_token].rate
        self.reward_data[_reward_token].rate = (_amount + leftover) / WEEK

    self.reward_data[_reward_token].last_update = block.timestamp
    self.reward_data[_reward_token].period_finish = block.timestamp + WEEK


@external
def killGauge():
    """
    @notice Kills the gauge so it always yields a rate of 0 and so cannot mint BAL
    """
    assert msg.sender == AUTHORIZER_ADAPTOR, "SENDER_NOT_ALLOWED"  # dev: only owner

    self.is_killed = True


@external
def unkillGauge():
    """
    @notice Unkills the gauge so it can mint BAL again
    """
    assert msg.sender == AUTHORIZER_ADAPTOR, "SENDER_NOT_ALLOWED"  # dev: only owner

    self.is_killed = False


@view
@external
def decimals() -> uint256:
    """
    @notice Returns the number of decimals the token uses
    """
    return 18


@view
@external
def allowance(owner: address, spender: address) -> uint256:
    """
     @notice Get `spender`'s current allowance from `owner` 
    """
    return self._get_allowance(owner, spender)


@view
@external
def integrate_checkpoint() -> uint256:
    return self.period_timestamp[self.period]


@view
@external
def bal_token() -> address:
    return BAL


@view
@external
def bal_pseudo_minter() -> address:
    return BAL_PSEUDO_MINTER


@view
@external
def voting_escrow_delegation_proxy() -> address:
    return VE_DELEGATION_PROXY


@view
@external
def authorizer_adaptor() -> address:
    """
    @notice Return the authorizer adaptor address.
    """
    return AUTHORIZER_ADAPTOR


@external
def initialize(_lp_token: address, _version: String[128]):
    assert self.lp_token == ZERO_ADDRESS, "ALREADY_INITIALIZED"  # dev: already initialzed

    self.lp_token = _lp_token
    self.version = _version
    self.factory = msg.sender

    symbol: String[26] = ERC20Extended(_lp_token).symbol()
    name: String[64] = concat("Balancer ", symbol, " Gauge Deposit")

    self.name = name
    self.symbol = concat(symbol, "-gauge")

    self.period_timestamp[0] = block.timestamp
    self.DOMAIN_SEPARATOR = keccak256(
        _abi_encode(
            DOMAIN_TYPE_HASH,
            keccak256(name),
            keccak256(self.version),
            chain.id,
            self
        )
    )
