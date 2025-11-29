# FreestyleExecuteScriptParams


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**script** | **str** | The JavaScript or TypeScript script to execute | 
**config** | [**FreestyleExecuteScriptParamsConfiguration**](FreestyleExecuteScriptParamsConfiguration.md) |  | [optional] 

## Example

```python
from freestyle_client.models.freestyle_execute_script_params import FreestyleExecuteScriptParams

# TODO update the JSON string below
json = "{}"
# create an instance of FreestyleExecuteScriptParams from a JSON string
freestyle_execute_script_params_instance = FreestyleExecuteScriptParams.from_json(json)
# print the JSON string representation of the object
print(FreestyleExecuteScriptParams.to_json())

# convert the object into a dict
freestyle_execute_script_params_dict = freestyle_execute_script_params_instance.to_dict()
# create an instance of FreestyleExecuteScriptParams from a dict
freestyle_execute_script_params_from_dict = FreestyleExecuteScriptParams.from_dict(freestyle_execute_script_params_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


