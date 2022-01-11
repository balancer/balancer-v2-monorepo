# @version 0.3.1
"""
@title Balancer Inflation
@author Curve Finance
@license MIT
@notice Inflation relevant code from Curve DAO Token
@dev Calculations in this contract do not take into account any minting which occurs outside of the gauge system
"""

from vyper.interfaces import ERC20

event UpdateMiningParameters:
    time: uint256
    rate: uint256
    supply: uint256

# General constants
YEAR: constant(uint256) = 86400 * 365

# Allocation:
# =========
# * shareholders - 30%
# * emplyees - 3%
# * DAO-controlled reserve - 5%
# * Early users - 5%
# == 43% ==
# left for inflation: 57%

# Supply parameters
INITIAL_RATE: constant(uint256) = 274_815_283 * 10 ** 18 / YEAR  # leading to 43% premine
RATE_REDUCTION_TIME: constant(uint256) = YEAR
RATE_REDUCTION_COEFFICIENT: constant(uint256) = 1189207115002721024  # 2 ** (1/4) * 1e18
RATE_DENOMINATOR: constant(uint256) = 10 ** 18
INFLATION_DELAY: constant(uint256) = 86400

# Supply variables
mining_epoch: public(int128)
start_epoch_time: public(uint256)
rate: public(uint256)

start_epoch_supply: uint256


@external
def __init__(token: address):
    """
    @notice Contract constructor
    """

    self.start_epoch_time = block.timestamp + INFLATION_DELAY - RATE_REDUCTION_TIME
    self.mining_epoch = -1
    self.rate = 0
    self.start_epoch_supply = ERC20(token).totalSupply()


@internal
def _update_mining_parameters():
    """
    @dev Update mining rate and supply at the start of the epoch
         Any modifying mining call must also call this
    """
    _rate: uint256 = self.rate
    _start_epoch_supply: uint256 = self.start_epoch_supply

    self.start_epoch_time += RATE_REDUCTION_TIME
    self.mining_epoch += 1

    if _rate == 0:
        _rate = INITIAL_RATE
    else:
        _start_epoch_supply += _rate * RATE_REDUCTION_TIME
        self.start_epoch_supply = _start_epoch_supply
        _rate = _rate * RATE_DENOMINATOR / RATE_REDUCTION_COEFFICIENT

    self.rate = _rate

    log UpdateMiningParameters(block.timestamp, _rate, _start_epoch_supply)


@external
def update_mining_parameters():
    """
    @notice Update mining rate and supply at the start of the epoch
    @dev Callable by any address, but only once per epoch
         Total supply becomes slightly larger if this function is called late
    """
    assert block.timestamp >= self.start_epoch_time + RATE_REDUCTION_TIME  # dev: too soon!
    self._update_mining_parameters()


@external
def start_epoch_time_write() -> uint256:
    """
    @notice Get timestamp of the current mining epoch start
            while simultaneously updating mining parameters
    @return Timestamp of the epoch
    """
    _start_epoch_time: uint256 = self.start_epoch_time
    if block.timestamp >= _start_epoch_time + RATE_REDUCTION_TIME:
        self._update_mining_parameters()
        return self.start_epoch_time
    else:
        return _start_epoch_time


@external
def future_epoch_time_write() -> uint256:
    """
    @notice Get timestamp of the next mining epoch start
            while simultaneously updating mining parameters
    @return Timestamp of the next epoch
    """
    _start_epoch_time: uint256 = self.start_epoch_time
    if block.timestamp >= _start_epoch_time + RATE_REDUCTION_TIME:
        self._update_mining_parameters()
        return self.start_epoch_time + RATE_REDUCTION_TIME
    else:
        return _start_epoch_time + RATE_REDUCTION_TIME


@internal
@view
def _available_supply() -> uint256:
    return self.start_epoch_supply + (block.timestamp - self.start_epoch_time) * self.rate


@external
@view
def available_supply() -> uint256:
    """
    @notice Current number of tokens in existence (claimed or unclaimed)
    """
    return self._available_supply()


@external
@view
def mintable_in_timeframe(start: uint256, end: uint256) -> uint256:
    """
    @notice How much supply is mintable from start timestamp till end timestamp
    @param start Start of the time interval (timestamp)
    @param end End of the time interval (timestamp)
    @return Tokens mintable from `start` till `end`
    """
    assert start <= end  # dev: start > end
    to_mint: uint256 = 0
    current_epoch_time: uint256 = self.start_epoch_time
    current_rate: uint256 = self.rate

    # Special case if end is in future (not yet minted) epoch
    if end > current_epoch_time + RATE_REDUCTION_TIME:
        current_epoch_time += RATE_REDUCTION_TIME
        current_rate = current_rate * RATE_DENOMINATOR / RATE_REDUCTION_COEFFICIENT

    assert end <= current_epoch_time + RATE_REDUCTION_TIME  # dev: too far in future

    for i in range(999):  # Curve will not work in 1000 years. Darn!
        if end >= current_epoch_time:
            current_end: uint256 = end
            if current_end > current_epoch_time + RATE_REDUCTION_TIME:
                current_end = current_epoch_time + RATE_REDUCTION_TIME

            current_start: uint256 = start
            if current_start >= current_epoch_time + RATE_REDUCTION_TIME:
                break  # We should never get here but what if...
            elif current_start < current_epoch_time:
                current_start = current_epoch_time

            to_mint += current_rate * (current_end - current_start)

            if start >= current_epoch_time:
                break

        current_epoch_time -= RATE_REDUCTION_TIME
        current_rate = current_rate * RATE_REDUCTION_COEFFICIENT / RATE_DENOMINATOR  # double-division with rounding made rate a bit less => good
        assert current_rate <= INITIAL_RATE  # This should never happen

    return to_mint