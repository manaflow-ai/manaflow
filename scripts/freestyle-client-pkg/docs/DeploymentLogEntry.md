# DeploymentLogEntry


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**deployment_id** | **str** |  | 
**account_id** | **str** |  | 
**provisioned_at** | **datetime** |  | 
**timeout** | **str** |  | 
**state** | [**DeploymentState**](DeploymentState.md) |  | 
**deployed_at** | **datetime** |  | [optional] 
**domains** | **List[str]** |  | 
**env_vars** | **Dict[str, str]** |  | 

## Example

```python
from freestyle_client.models.deployment_log_entry import DeploymentLogEntry

# TODO update the JSON string below
json = "{}"
# create an instance of DeploymentLogEntry from a JSON string
deployment_log_entry_instance = DeploymentLogEntry.from_json(json)
# print the JSON string representation of the object
print(DeploymentLogEntry.to_json())

# convert the object into a dict
deployment_log_entry_dict = deployment_log_entry_instance.to_dict()
# create an instance of DeploymentLogEntry from a dict
deployment_log_entry_from_dict = DeploymentLogEntry.from_dict(deployment_log_entry_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


