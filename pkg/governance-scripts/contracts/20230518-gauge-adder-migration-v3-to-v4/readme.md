# GaugeAdder Migration Coordinator V3->V4

This migration supersedes the V3 --> V4 migrator. `GaugeAdder` V3 was deployed, but since it depended on the `AuthorizerAdaptorEntrypoint` it was not actively used.
`GaugeAdder` V4 brings in dynamic network types, and its interface was refactored with respect to the V3 version.

This contract swaps out the GaugeAdder contract which has permissions to add gauges to the GaugeController for a new version that uses the new authorizer and authorizer adaptor entrypoint.

## Governance proposal

## Deployment
