# 2023-04-14 - Authorizer Wrapper

Deployment of the `AuthorizerWithAdaptorValidation`, which allows using the AuthorizerAdaptorEntrypoint with the existing Authorizer, before migration to the TimelockAuthorizer. In particular, this allows contracts that require the endpoint (e.g., Gauge Adder V3) to work.

## Useful Files

- [`AuthorizerWithAdaptorValidation` artifact](./artifact/AuthorizerWithAdaptorValidation.json)
