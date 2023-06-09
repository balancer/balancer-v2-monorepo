import { expect } from 'chai';
import { BigNumber, ContractReceipt } from 'ethers';
import { Interface, LogDescription } from 'ethers/lib/utils';

// Ported from @openzeppelin/test-helpers to use with Ethers. The Test Helpers don't
// yet have Typescript typings, so we're being lax about them here.
// See https://github.com/OpenZeppelin/openzeppelin-test-helpers/issues/122

/* eslint-disable @typescript-eslint/no-explicit-any */

export function inReceipt(receipt: ContractReceipt, eventName: string, eventArgs = {}): any {
  if (receipt.events == undefined) {
    throw new Error('No events found in receipt');
  }

  const events = receipt.events.filter((e) => e.event === eventName);
  expect(events.length > 0).to.equal(true, `No '${eventName}' events found`);

  const exceptions: Array<string> = [];
  const event = events.find(function (e) {
    for (const [k, v] of Object.entries(eventArgs)) {
      try {
        if (e.args == undefined) {
          throw new Error('Event has no arguments');
        }

        contains(e.args, k, v);
      } catch (error) {
        exceptions.push(error);
        return false;
      }
    }
    return true;
  });

  if (event === undefined) {
    // Each event entry may have failed to match for different reasons,
    // throw the first one
    throw exceptions[0];
  }

  return event;
}

/**
 * Throws error if the given receipt does not contain a set of events with specific arguments.
 * Expecting a specific amount of events from a particular address is optional.
 * @param receipt Receipt to analyze.
 * @param emitter Interface of the contract emitting the event(s).
 * @param eventName Name of the event(s).
 * @param eventArgs Arguments of the event(s). This does not need to be a complete list; as long as the event contains
 *  the specified ones, the function will not throw.
 * @param address Contract address that emits the event(s). If undefined, the logs will not be filtered by address.
 * @param amount Number of expected events that match all the specified conditions. If not specified, at least one is
 *  expected.
 * @returns First matching event if the amount is not specified; all matching events otherwise.
 */
export function inIndirectReceipt(
  receipt: ContractReceipt,
  emitter: Interface,
  eventName: string,
  eventArgs = {},
  address?: string,
  amount?: number
): any {
  const expectedEvents = arrayFromIndirectReceipt(receipt, emitter, eventName, address);
  if (amount === undefined) {
    expect(expectedEvents.length > 0).to.equal(true, `No '${eventName}' events found`);
  } else {
    expect(expectedEvents.length).to.equal(
      amount,
      `${expectedEvents.length} '${eventName}' events found; expected ${amount}`
    );
  }

  const exceptions: Array<string> = [];
  const filteredEvents = expectedEvents.filter(function (e) {
    for (const [k, v] of Object.entries(eventArgs)) {
      try {
        if (e.args == undefined) {
          throw new Error('Event has no arguments');
        }

        contains(e.args, k, v);
      } catch (error) {
        exceptions.push(error);
        return false;
      }
    }
    return true;
  });

  // Each event entry may have failed to match for different reasons; in case of failure we throw the first one.
  if (amount === undefined) {
    // If amount is undefined, we don't care about the number of events. If no events were found, we throw.
    if (filteredEvents.length === 0) {
      throw exceptions[0];
    }
    return filteredEvents[0]; // In this case we just return the first appearance. This is backwards compatible.
  } else {
    // If amount was defined, we want the filtered events length to match the events length. If it doesn't, we throw.
    if (filteredEvents.length !== expectedEvents.length) {
      throw exceptions[0];
    }
    return filteredEvents; // In this case we care about all of the events, so we return them all.
  }
}

export function notEmitted(receipt: ContractReceipt, eventName: string): void {
  if (receipt.events != undefined) {
    const events = receipt.events.filter((e) => e.event === eventName);
    expect(events.length > 0).to.equal(false, `'${eventName}' event found`);
  }
}

function arrayFromIndirectReceipt(
  receipt: ContractReceipt,
  emitter: Interface,
  eventName: string,
  address?: string
): any[] {
  const decodedEvents = receipt.logs
    .filter((log) => (address ? log.address.toLowerCase() === address.toLowerCase() : true))
    .map((log) => {
      try {
        return emitter.parseLog(log);
      } catch {
        return undefined;
      }
    })
    .filter((e): e is LogDescription => e !== undefined);

  return decodedEvents.filter((event) => event.name === eventName);
}

function contains(args: { [key: string]: any | undefined }, key: string, value: any) {
  expect(key in args).to.equal(true, `Event argument '${key}' not found`);

  if (value === null) {
    expect(args[key]).to.equal(null, `expected event argument '${key}' to be null but got ${args[key]}`);
  } else if (BigNumber.isBigNumber(args[key]) || BigNumber.isBigNumber(value)) {
    const actual = BigNumber.isBigNumber(args[key]) ? args[key].toString() : args[key];
    const expected = BigNumber.isBigNumber(value) ? value.toString() : value;

    expect(args[key]).to.equal(value, `expected event argument '${key}' to have value ${expected} but got ${actual}`);
  } else {
    expect(args[key]).to.be.deep.equal(
      value,
      `expected event argument '${key}' to have value ${value} but got ${args[key]}`
    );
  }
}
