# FreestyleExecuteScriptParamsConfiguration


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**env_vars** | **Dict[str, str]** | The environment variables to set for the script | [optional] 
**node_modules** | **Dict[str, str]** | The node modules to install for the script | [optional] 
**tags** | **List[str]** | Tags for you to organize your scripts, useful for tracking what you&#39;re running | [optional] [default to []]
**timeout** | **int** | The script timeout | [optional] 
**peer_dependency_resolution** | **bool** | If false, we&#39;ll not resolve peer dependencies for the packages given, this can speed up execute performance, but will break packages with peers unless the peers are manually specified. | [optional] [default to True]
**network_permissions** | [**List[FreestyleNetworkPermission]**](FreestyleNetworkPermission.md) |  | [optional] 
**custom_headers** | **Dict[str, str]** | These headers will be added to every fetch request made through the script | [optional] 
**proxy** | **str** | Proxy all outgoing requests through this URL | [optional] 

## Example

```python
from freestyle_client.models.freestyle_execute_script_params_configuration import FreestyleExecuteScriptParamsConfiguration

# TODO update the JSON string below
json = "{}"
# create an instance of FreestyleExecuteScriptParamsConfiguration from a JSON string
freestyle_execute_script_params_configuration_instance = FreestyleExecuteScriptParamsConfiguration.from_json(json)
# print the JSON string representation of the object
print(FreestyleExecuteScriptParamsConfiguration.to_json())

# convert the object into a dict
freestyle_execute_script_params_configuration_dict = freestyle_execute_script_params_configuration_instance.to_dict()
# create an instance of FreestyleExecuteScriptParamsConfiguration from a dict
freestyle_execute_script_params_configuration_from_dict = FreestyleExecuteScriptParamsConfiguration.from_dict(freestyle_execute_script_params_configuration_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


