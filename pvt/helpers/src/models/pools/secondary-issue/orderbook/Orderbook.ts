import { ethers } from 'hardhat';
import { BigNumber, BigNumberish, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { EditOrder, CancelOrder, OrderRef, TradeFetch, OrderBookRef } from './types';

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
        const sender = params.from || this.balancerManager;
        const orderbook = sender ? this.instance.connect(sender) : this.instance;
        return orderbook.getOrderRef();
    }

    async editOrder(params: EditOrder): Promise<BigNumberish> {
        const sender = params.from || this.balancerManager;
        const orderbook = sender ? this.instance.connect(sender) : this.instance;
        return orderbook.editOrder(params.ref, params.price, params.amount);
    }

    async cancelOrder(params: CancelOrder): Promise<BigNumberish> {
        const sender = params.from || this.balancerManager;
        const orderbook = sender ? this.instance.connect(sender) : this.instance;
        return orderbook.cancelOrder(params.ref);
    }

    async getTrades(params: OrderRef): Promise<BigNumberish[]> {
        const sender = params.from || this.balancerManager;
        const orderbook = sender ? this.instance.connect(sender) : this.instance;
        return orderbook.getTrades();
    }

    async getOrder(params: OrderBookRef): Promise<BigNumberish[]> {
        const sender = params.from || this.balancerManager;
        const orderbook = sender ? this.instance.connect(sender) : this.instance;
        return orderbook.getOrder(params.ref);
    }

    async getTrade(params: TradeFetch): Promise<any> {
        const sender = params.from || this.balancerManager;
        const orderbook = sender ? this.instance.connect(sender) : this.instance;
        return orderbook.getTrade(params.from?.address, params.tradeId);
    }
}