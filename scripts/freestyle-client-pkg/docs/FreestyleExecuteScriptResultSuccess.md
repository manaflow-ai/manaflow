# FreestyleExecuteScriptResultSuccess


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**result** | **object** |  | 
**logs** | [**List[FreestyleJavaScriptLog]**](FreestyleJavaScriptLog.md) |  | 

## Example

```python
from freestyle_client.models.freestyle_execute_script_result_success import FreestyleExecuteScriptResultSuccess

# TODO update the JSON string below
json = "{}"
# create an instance of FreestyleExecuteScriptResultSuccess from a JSON string
freestyle_execute_script_result_success_instance = FreestyleExecuteScriptResultSuccess.from_json(json)
# print the JSON string representation of the object
print(FreestyleExecuteScriptResultSuccess.to_json())

# convert the object into a dict
freestyle_execute_script_result_success_dict = freestyle_execute_script_result_success_instance.to_dict()
# create an instance of FreestyleExecuteScriptResultSuccess from a dict
freestyle_execute_script_result_success_from_dict = FreestyleExecuteScriptResultSuccess.from_dict(freestyle_execute_script_result_success_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


