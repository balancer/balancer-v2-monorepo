
from slither import Slither
from slither.core.declarations import Contract
from typing import List

contracts = Slither(".", ignore_compile=True)

def _check_access_controls(
    contract: Contract, modifiers_access_controls: List[str], whitelist: List[str]
):
    print(f"### Check {contract} access controls")
    no_bug_found = True
    for function in contract.functions_entry_points:
        if function.is_constructor:
            continue
        if function.view:
            continue

        if not function.modifiers or (
            not any((str(x) in modifiers_access_controls) for x in function.modifiers)
        ):
            if not function.name in whitelist:
                print(f"\t- {function.canonical_name} should have an non re-eentrant modifier")
                no_bug_found = False
    if no_bug_found:
        print("\t- No bug found")


_check_access_controls(
    contracts.get_contract_from_name("Vault"),
    ["nonReentrant"],
    ["batchSwapGivenIn", "batchSwapGivenOut","queryBatchSwapGivenIn","queryBatchSwapGivenOut", "queryBatchSwapHelper"],
)