# ExecuteRunInfo


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**code** | **str** |  | 
**node_modules** | **Dict[str, str]** |  | 

## Example

```python
from freestyle_client.models.execute_run_info import ExecuteRunInfo

# TODO update the JSON string below
json = "{}"
# create an instance of ExecuteRunInfo from a JSON string
execute_run_info_instance = ExecuteRunInfo.from_json(json)
# print the JSON string representation of the object
print(ExecuteRunInfo.to_json())

# convert the object into a dict
execute_run_info_dict = execute_run_info_instance.to_dict()
# create an instance of ExecuteRunInfo from a dict
execute_run_info_from_dict = ExecuteRunInfo.from_dict(execute_run_info_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


