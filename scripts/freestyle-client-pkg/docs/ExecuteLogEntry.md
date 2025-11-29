# ExecuteLogEntry


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**deployment** | **str** |  | 
**account_id** | **str** |  | 
**provisioned_at** | **datetime** |  | 
**started_at** | **datetime** |  | [optional] 
**duration** | **str** |  | [optional] 
**state** | [**ExecuteRunState**](ExecuteRunState.md) |  | 
**env_vars** | **Dict[str, str]** |  | 

## Example

```python
from freestyle_client.models.execute_log_entry import ExecuteLogEntry

# TODO update the JSON string below
json = "{}"
# create an instance of ExecuteLogEntry from a JSON string
execute_log_entry_instance = ExecuteLogEntry.from_json(json)
# print the JSON string representation of the object
print(ExecuteLogEntry.to_json())

# convert the object into a dict
execute_log_entry_dict = execute_log_entry_instance.to_dict()
# create an instance of ExecuteLogEntry from a dict
execute_log_entry_from_dict = ExecuteLogEntry.from_dict(execute_log_entry_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


