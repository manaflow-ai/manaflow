# HandleExecuteScript400Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**error** | **str** |  | 
**logs** | [**List[FreestyleJavaScriptLog]**](FreestyleJavaScriptLog.md) |  | [optional] 

## Example

```python
from freestyle_client.models.handle_execute_script400_response import HandleExecuteScript400Response

# TODO update the JSON string below
json = "{}"
# create an instance of HandleExecuteScript400Response from a JSON string
handle_execute_script400_response_instance = HandleExecuteScript400Response.from_json(json)
# print the JSON string representation of the object
print(HandleExecuteScript400Response.to_json())

# convert the object into a dict
handle_execute_script400_response_dict = handle_execute_script400_response_instance.to_dict()
# create an instance of HandleExecuteScript400Response from a dict
handle_execute_script400_response_from_dict = HandleExecuteScript400Response.from_dict(handle_execute_script400_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


