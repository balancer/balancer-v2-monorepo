# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Interfaces

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-balancer-interfaces.svg)](https://www.npmjs.org/package/@balancer-labs/v2-balancer-interfaces)
[![Docs](https://img.shields.io/badge/docs-%F0%9F%93%84-blue)](https://docs.balancer.fi/developers/smart-contracts/apis/balancer-interfaces)

---

This package contains interfaces used in dependent packages. The purpose is to prevent circular dependences (and resulting hardhat issues) by isolating all
interfaces in a single package, which can then be imported by all others.
