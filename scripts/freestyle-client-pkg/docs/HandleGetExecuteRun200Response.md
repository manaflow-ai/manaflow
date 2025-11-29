# HandleGetExecuteRun200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**metadata** | [**ExecuteLogEntry**](ExecuteLogEntry.md) |  | 
**code** | [**ExecuteRunInfo**](ExecuteRunInfo.md) |  | [optional] 

## Example

```python
from freestyle_client.models.handle_get_execute_run200_response import HandleGetExecuteRun200Response

# TODO update the JSON string below
json = "{}"
# create an instance of HandleGetExecuteRun200Response from a JSON string
handle_get_execute_run200_response_instance = HandleGetExecuteRun200Response.from_json(json)
# print the JSON string representation of the object
print(HandleGetExecuteRun200Response.to_json())

# convert the object into a dict
handle_get_execute_run200_response_dict = handle_get_execute_run200_response_instance.to_dict()
# create an instance of HandleGetExecuteRun200Response from a dict
handle_get_execute_run200_response_from_dict = HandleGetExecuteRun200Response.from_dict(handle_get_execute_run200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


