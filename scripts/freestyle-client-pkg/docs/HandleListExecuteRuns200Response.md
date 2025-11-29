# HandleListExecuteRuns200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**entries** | [**List[ExecuteLogEntry]**](ExecuteLogEntry.md) |  | 
**total** | **int** |  | 
**offset** | **int** |  | 

## Example

```python
from freestyle_client.models.handle_list_execute_runs200_response import HandleListExecuteRuns200Response

# TODO update the JSON string below
json = "{}"
# create an instance of HandleListExecuteRuns200Response from a JSON string
handle_list_execute_runs200_response_instance = HandleListExecuteRuns200Response.from_json(json)
# print the JSON string representation of the object
print(HandleListExecuteRuns200Response.to_json())

# convert the object into a dict
handle_list_execute_runs200_response_dict = handle_list_execute_runs200_response_instance.to_dict()
# create an instance of HandleListExecuteRuns200Response from a dict
handle_list_execute_runs200_response_from_dict = HandleListExecuteRuns200Response.from_dict(handle_list_execute_runs200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


