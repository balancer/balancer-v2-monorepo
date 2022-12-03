import { ethers } from 'hardhat';
import { BigNumber, BigNumberish, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { EditOrder, CancelOrder, OrderRef } from './types';

export default class Orderbook {

    instance: Contract;
    balancerManager: SignerWithAddress;
    security: string;
    currency: string;

    constructor(
        instance: Contract,
        balancerManager: SignerWithAddress,
        security: string,
        currency: string
    ){
        this.instance = instance;
        this.balancerManager = balancerManager;
        this.security = security;
        this.currency = currency;
    }

    async getOrderRef(params: OrderRef): Promise<BigNumberish[]> {
        return this.instance.getOrderRef();
    }

    async editOrder(params: EditOrder): Promise<BigNumberish> {
        return this.instance.editOrder(params.ref, params.price, params.amount);
    }

    async cancelOrder(params: CancelOrder): Promise<BigNumberish> {
        return this.instance.cancelOrder(params.ref);
    }

}