# HandleExecuteScript200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**result** | **object** |  | 
**logs** | [**List[FreestyleJavaScriptLog]**](FreestyleJavaScriptLog.md) |  | 

## Example

```python
from freestyle_client.models.handle_execute_script200_response import HandleExecuteScript200Response

# TODO update the JSON string below
json = "{}"
# create an instance of HandleExecuteScript200Response from a JSON string
handle_execute_script200_response_instance = HandleExecuteScript200Response.from_json(json)
# print the JSON string representation of the object
print(HandleExecuteScript200Response.to_json())

# convert the object into a dict
handle_execute_script200_response_dict = handle_execute_script200_response_instance.to_dict()
# create an instance of HandleExecuteScript200Response from a dict
handle_execute_script200_response_from_dict = HandleExecuteScript200Response.from_dict(handle_execute_script200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


