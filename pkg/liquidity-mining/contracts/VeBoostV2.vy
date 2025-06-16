# @version 0.3.3
"""
@title Boost Delegation V2.1
@author CurveFi
"""


event Approval:
    _owner: indexed(address)
    _spender: indexed(address)
    _value: uint256

event ApprovalForAll:
    _owner: indexed(address)
    _operator: indexed(address)

event Transfer:
    _from: indexed(address)
    _to: indexed(address)
    _value: uint256

event Boost:
    _from: indexed(address)
    _to: indexed(address)
    _bias: uint256
    _slope: uint256
    _start: uint256

interface BoostV2:
    def delegated(addr: address) -> Point: view
    def received(addr: address) -> Point: view
    def delegated_slope_changes(addr: address, endtime: uint256) -> uint256: view
    def received_slope_changes(addr: address, endtime: uint256) -> uint256: view

interface VotingEscrow:
    def balanceOf(_user: address) -> uint256: view
    def totalSupply() -> uint256: view
    def locked__end(_user: address) -> uint256: view

interface ERC1271:
    def isValidSignature(_hash: bytes32, _signature: Bytes[65]) -> bytes32: view

struct Point:
    bias: uint256
    slope: uint256
    ts: uint256

# Supports one-time migration of existing boosts
struct MigrateBoostCall:
    _from: address
    to: address
    end_time: uint256

# Supports one-time migration, allowing Stake DAO and Tetu BAL lockers to participate in boosts
struct SetApprovalForAllCall:
    operator: address
    delegator: address

NAME: constant(String[32]) = "Vote-Escrowed Boost"
SYMBOL: constant(String[8]) = "veBoost"
VERSION: constant(String[8]) = "v2.1.0"

EIP712_TYPEHASH: constant(bytes32) = keccak256(
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
)
PERMIT_TYPEHASH: constant(bytes32) = keccak256(
    "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
)

# keccak256("isValidSignature(bytes32,bytes)")[:4] << 224
ERC1271_MAGIC_VAL: constant(bytes32) = (
    0x1626ba7e00000000000000000000000000000000000000000000000000000000
)

WEEK: constant(uint256) = 86400 * 7

# Previous veBoostV2 instance, used for one-time migration
BOOST_V2: immutable(address)
DOMAIN_SEPARATOR: immutable(bytes32)
VE: immutable(address)

allowance: public(HashMap[address, HashMap[address, uint256]])
nonces: public(HashMap[address, uint256])

delegated: public(HashMap[address, Point])
delegated_slope_changes: public(HashMap[address, HashMap[uint256, uint256]])

received: public(HashMap[address, Point])
received_slope_changes: public(HashMap[address, HashMap[uint256, uint256]])

# Flag to ensure migration is only performed once
migrated: public(bool)

MAX_PRESEEDED_BOOSTS: constant(uint256) = 10
preseeded_boost_calls: public(MigrateBoostCall[MAX_PRESEEDED_BOOSTS])

MAX_PRESEEDED_APPROVALS: constant(uint256) = 10
preseeded_approval_calls: public(SetApprovalForAllCall[MAX_PRESEEDED_APPROVALS])


@external
def __init__(
    _boost_v2: address,
    _ve: address,
    _preseeded_boost_calls: MigrateBoostCall[MAX_PRESEEDED_BOOSTS],
    _preseeded_approval_calls: SetApprovalForAllCall[MAX_PRESEEDED_APPROVALS]
):
    BOOST_V2 = _boost_v2
    DOMAIN_SEPARATOR = keccak256(
        _abi_encode(
            EIP712_TYPEHASH,
            keccak256(NAME),
            keccak256(VERSION),
            chain.id,
            self
        )
    )
    VE = _ve

    self.preseeded_boost_calls = _preseeded_boost_calls
    self.preseeded_approval_calls = _preseeded_approval_calls

    log Transfer(ZERO_ADDRESS, msg.sender, 0)


@view
@internal
def _checkpoint_read(_user: address, _delegated: bool) -> Point:
    point: Point = empty(Point)

    if _delegated:
        point = self.delegated[_user]
    else:
        point = self.received[_user]

    if point.ts == 0:
        point.ts = block.timestamp

    if point.ts == block.timestamp:
        return point

    ts: uint256 = (point.ts / WEEK) * WEEK
    for _ in range(255):
        ts += WEEK

        dslope: uint256 = 0
        if block.timestamp < ts:
            ts = block.timestamp
        else:
            if _delegated:
                dslope = self.delegated_slope_changes[_user][ts]
            else:
                dslope = self.received_slope_changes[_user][ts]

        point.bias -= point.slope * (ts - point.ts)
        point.slope -= dslope
        point.ts = ts

        if ts == block.timestamp:
            break

    return point


@internal
def _checkpoint_write(_user: address, _delegated: bool) -> Point:
    point: Point = empty(Point)

    if _delegated:
        point = self.delegated[_user]
    else:
        point = self.received[_user]

    if point.ts == 0:
        point.ts = block.timestamp

    if point.ts == block.timestamp:
        return point

    dbias: uint256 = 0
    ts: uint256 = (point.ts / WEEK) * WEEK
    for _ in range(255):
        ts += WEEK

        dslope: uint256 = 0
        if block.timestamp < ts:
            ts = block.timestamp
        else:
            if _delegated:
                dslope = self.delegated_slope_changes[_user][ts]
            else:
                dslope = self.received_slope_changes[_user][ts]

        amount: uint256 = point.slope * (ts - point.ts)

        dbias += amount
        point.bias -= amount
        point.slope -= dslope
        point.ts = ts

        if ts == block.timestamp:
            break

    if _delegated == False and dbias != 0:  # received boost
        log Transfer(_user, ZERO_ADDRESS, dbias)

    return point


@view
@internal
def _balance_of(_user: address) -> uint256:
    amount: uint256 = VotingEscrow(VE).balanceOf(_user)

    point: Point = self._checkpoint_read(_user, True)
    amount -= (point.bias - point.slope * (block.timestamp - point.ts))

    point = self._checkpoint_read(_user, False)
    amount += (point.bias - point.slope * (block.timestamp - point.ts))
    return amount


@internal
def _boost(_from: address, _to: address, _amount: uint256, _endtime: uint256):
    assert _to not in [_from, ZERO_ADDRESS]
    assert _amount != 0
    assert _endtime > block.timestamp
    assert _endtime % WEEK == 0
    assert _endtime <= VotingEscrow(VE).locked__end(_from)

    # checkpoint delegated point
    point: Point = self._checkpoint_write(_from, True)

    assert _amount <= (
        VotingEscrow(VE).balanceOf(_from) - 
        (point.bias - point.slope * (block.timestamp - point.ts))
    )

    # calculate slope and bias being added
    slope: uint256 = _amount / (_endtime - block.timestamp)
    bias: uint256 = slope * (_endtime - block.timestamp)

    # update delegated point
    point.bias += bias
    point.slope += slope

    # store updated values
    self.delegated[_from] = point
    self.delegated_slope_changes[_from][_endtime] += slope

    # update received amount
    point = self._checkpoint_write(_to, False)
    point.bias += bias
    point.slope += slope

    # store updated values
    self.received[_to] = point
    self.received_slope_changes[_to][_endtime] += slope

    log Transfer(_from, _to, _amount)
    log Boost(_from, _to, bias, slope, block.timestamp)

    # also checkpoint received and delegated
    self.received[_from] = self._checkpoint_write(_from, False)
    self.delegated[_to] = self._checkpoint_write(_to, True)


@external
def boost(_to: address, _amount: uint256, _endtime: uint256, _from: address = msg.sender):
    if _from != msg.sender:
        allowance: uint256 = self.allowance[_from][msg.sender]
        # reduce approval if necessary
        if allowance != MAX_UINT256:
            self.allowance[_from][msg.sender] = allowance - _amount
            log Approval(_from, msg.sender, allowance - _amount)

    self._boost(_from, _to, _amount, _endtime)


@external
def checkpoint_user(_user: address):
    self.delegated[_user] = self._checkpoint_write(_user, True)
    self.received[_user] = self._checkpoint_write(_user, False)


@external
def approve(_spender: address, _value: uint256) -> bool:
    self.allowance[msg.sender][_spender] = _value

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
    assert block.timestamp <= _deadline, 'EXPIRED_SIGNATURE'

    nonce: uint256 = self.nonces[_owner]
    digest: bytes32 = keccak256(
        concat(
            b"\x19\x01",
            DOMAIN_SEPARATOR,
            keccak256(_abi_encode(PERMIT_TYPEHASH, _owner, _spender, _value, nonce, _deadline))
        )
    )

    if _owner.is_contract:
        sig: Bytes[65] = concat(
            _abi_encode(_r, _s), 
            slice(convert(_v, bytes32), 31, 1)
        )
        # reentrancy not a concern since this is a staticcall
        assert (
            ERC1271(_owner).isValidSignature(digest, sig) == ERC1271_MAGIC_VAL
        ), 'INVALID_SIGNATURE'
    else:
        recovered_address: address = ecrecover(
            digest, 
            convert(_v, uint256), 
            convert(_r, uint256), 
            convert(_s, uint256)
        )
        assert (
            recovered_address == _owner and _owner != ZERO_ADDRESS
        ), 'INVALID_SIGNATURE'

    self.allowance[_owner][_spender] = _value
    self.nonces[_owner] = nonce + 1

    log Approval(_owner, _spender, _value)
    return True


@external
def increaseAllowance(_spender: address, _added_value: uint256) -> bool:
    allowance: uint256 = self.allowance[msg.sender][_spender] + _added_value
    self.allowance[msg.sender][_spender] = allowance

    log Approval(msg.sender, _spender, allowance)
    return True


@external
def decreaseAllowance(_spender: address, _subtracted_value: uint256) -> bool:
    allowance: uint256 = self.allowance[msg.sender][_spender] - _subtracted_value
    self.allowance[msg.sender][_spender] = allowance

    log Approval(msg.sender, _spender, allowance)
    return True


@view
@external
def balanceOf(_user: address) -> uint256:
    return self._balance_of(_user)


@view
@external
def adjusted_balance_of(_user: address) -> uint256:
    return self._balance_of(_user)


@view
@external
def totalSupply() -> uint256:
    return VotingEscrow(VE).totalSupply()


@view
@external
def delegated_balance(_user: address) -> uint256:
    point: Point = self._checkpoint_read(_user, True)
    return point.bias - point.slope * (block.timestamp - point.ts)


@view
@external
def received_balance(_user: address) -> uint256:
    point: Point = self._checkpoint_read(_user, False)
    return point.bias - point.slope * (block.timestamp - point.ts)


@view
@external
def delegable_balance(_user: address) -> uint256:
    point: Point = self._checkpoint_read(_user, True)
    current_delegated: uint256 = (
        point.bias - point.slope * (block.timestamp - point.ts)
    )
    return VotingEscrow(VE).balanceOf(_user) - current_delegated


@pure
@external
def name() -> String[32]:
    return NAME


@pure
@external
def symbol() -> String[8]:
    return SYMBOL


@pure
@external
def decimals() -> uint8:
    return 18

@pure
@external
def BOOST_V2() -> address:
    return BOOST_V2


@pure
@external
def version() -> String[8]:
    return VERSION

@pure
@external
def DOMAIN_SEPARATOR() -> bytes32:
    return DOMAIN_SEPARATOR


@pure
@external
def VE() -> address:
    return VE


# Called once for each existing active boost. We're migrating from a previous
# version of the contract that is semantically equivalent, and the `boost`
# function is unchanged (other than the infinite approvals also granted
# during the migration).
#
# Though we can query Dune for all existing boosts - using traces, since the
# event by itself is insufficient - we cannot simply "replay" the same boost
# call, since the boost function hard-codes the current timestamp.
#
# We could modify the internal `_boost` function to take a start_time, and
# pass in block.timestamp from the external `boost` - but this doesn't work
# either, since the checkpoint functions also use the current timestamp.
#
# What we need to do is migrate the full contract state, as modified by each
# boost call. Four storage fields are affected, and thankfully they're all
# public, so they can be directly read from the previous boost contract:
# `delegated`, `received`, and the corresponding two "slope_changes"
# variables.
#
# The first two are straightforward, and can simply be copied. The tricky
# part is getting all required slope changes, since these are historical.
# Further complicating the copy is the fact that, like mappings in Solidity,
# HashMaps are not iterable; we need to "know" at migration time which
# entries might have non-zero values.
#
# So, nothing for it but to examine the checkpoint functions in great detail
# to figure out what values would have been set by the existing boosts. The
# tricky part of the tricky part is that this doesn't depend *only* on the
# values of the boost parameters, but also on the previous state of the system!
#
# Since everything occurs on WEEK boundaries, you might think all we have to
# do is copy every week from the start_time to the current timestamp, since
# we know there can't be entries from the future. But close examination of
# the checkpoint functions reveals that the history contributing to the
# current "point" starts at the *last* boost or checkpoint, which is
# less than or equal to the start_time.
#
# So in fact we don't need the start_time at all, and can just start the
# history at the last checkpoint. (We know there must be one, since we're
# copying existing boosts, which themselves create a checkpoint.)

@internal
def _migrate_boost(_from: address, _to: address, _end_time: uint256):
    old_delegated_from_point: Point = BoostV2(BOOST_V2).delegated(_from)
    assert old_delegated_from_point.ts != 0

    old_delegated_to_point: Point = BoostV2(BOOST_V2).delegated(_to)
    assert old_delegated_to_point.ts != 0

    old_received_from_point: Point = BoostV2(BOOST_V2).received(_from)
    assert old_received_from_point.ts != 0

    old_received_to_point: Point = BoostV2(BOOST_V2).received(_to)
    assert old_received_to_point.ts != 0

    self.delegated[_from] = old_delegated_from_point
    self.delegated[_to] = old_delegated_to_point

    self.received[_from] = old_received_from_point
    self.received[_to] = old_received_to_point

    # Copy historical delegated slope values from the first delegated boost
    # Determine loop bounds using .ts from the prior checkpoints
    start_delegated: uint256 = (old_delegated_from_point.ts / WEEK) * WEEK

    t: uint256 = start_delegated
    slope_from: uint256 = 0
    slope_to: uint256 = 0

    for _ in range(255):
        slope_from = BoostV2(BOOST_V2).delegated_slope_changes(_from, t)

        # This is a potentially expensive call; check for zero to prevent
        # unnecessary storage writes

        if slope_from != 0:
            self.delegated_slope_changes[_from][t] = slope_from

        slope_to = BoostV2(BOOST_V2).delegated_slope_changes(_to, t)
        if slope_to != 0:
            self.delegated_slope_changes[_to][t] = slope_to

        t += WEEK
        if t > block.timestamp:
            break

    # Also ensure we copy the delegated slope change at _end_time
    slope_from = BoostV2(BOOST_V2).delegated_slope_changes(_from, _end_time)
    if slope_from != 0:
        self.delegated_slope_changes[_from][_end_time] = slope_from

    slope_to = BoostV2(BOOST_V2).delegated_slope_changes(_to, _end_time)
    if slope_to != 0:
        self.delegated_slope_changes[_to][_end_time] = slope_to

    # Copy historical received slope values from the first received boost
    # Determine loop bounds using .ts from the prior checkpoints
    start_received: uint256 = (old_received_to_point.ts / WEEK) * WEEK

    t = start_received
    for _ in range(255):
        slope_from = BoostV2(BOOST_V2).received_slope_changes(_from, t)
        if slope_from != 0:
            self.received_slope_changes[_from][t] = slope_from

        slope_to = BoostV2(BOOST_V2).received_slope_changes(_to, t)
        if slope_to != 0:
            self.received_slope_changes[_to][t] = slope_to

        t += WEEK
        if t > block.timestamp:
            break

    # Also ensure we copy the received slope change at _end_time
    slope_from = BoostV2(BOOST_V2).received_slope_changes(_from, _end_time)
    if slope_from != 0:
        self.received_slope_changes[_from][_end_time] = slope_from

    slope_to = BoostV2(BOOST_V2).received_slope_changes(_to, _end_time)
    if slope_to != 0:
        self.received_slope_changes[_to][_end_time] = slope_to


# Called for each delegator/operator pair initialized in the constructor.
# The `delegator` is the BAL locker for the protocol (Stake DAO or Tetu),
# and the `operator` is the account authorized to create boosts "from"
# the locker contract.
#
# This is necessary because the locker contracts themselves cannot call
# "boost" on this contract.

@internal
def _setApprovalForAll(_delegator: address, _operator: address):
    self.allowance[_delegator][_operator] = MAX_UINT256
    log ApprovalForAll(_delegator, _operator)


# Migration from veBoost V2 to V2.1. No semantic changes, just migrating current
# active boosts, and setting infinite approvals for Stake DAO and Tetu accounts,
# enabling their respective BAL lockers to participate in boosts.
#
# This action can only be performed once (ideally early in the contract's lifetime)

@external
def migrate():
    assert not self.migrated # dev: already migrated
    self.migrated = True

    for i in range(MAX_PRESEEDED_BOOSTS):
        boost_call: MigrateBoostCall = self.preseeded_boost_calls[i]
        # Skip this one if the boost expired after deployment and before migration, or
        # if we've gone off the end of the valid ones
        if boost_call._from != ZERO_ADDRESS and boost_call.end_time > block.timestamp:
            self._migrate_boost(
                boost_call._from,
                boost_call.to,
                boost_call.end_time
            )

    for i in range(MAX_PRESEEDED_APPROVALS):
        approval_call: SetApprovalForAllCall = self.preseeded_approval_calls[i]
        if approval_call.delegator != ZERO_ADDRESS:
            self._setApprovalForAll(approval_call.delegator, approval_call.operator)

