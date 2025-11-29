# FreestyleDeployWebConfiguration


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**domains** | **List[str]** |  | [optional] 
**entrypoint** | **str** |  | [optional] 
**env_vars** | **Dict[str, str]** |  | [optional] 
**node_modules** | **Dict[str, str]** |  | [optional] 
**timeout** | **int** |  | [optional] 
**server_start_check** | **bool** |  | [optional] 
**network_permissions** | [**List[FreestyleNetworkPermission]**](FreestyleNetworkPermission.md) |  | [optional] 
**build** | [**DeploymentBuildOptions**](DeploymentBuildOptions.md) |  | [optional] 
**var_await** | **bool** |  | [optional] 

## Example

```python
from freestyle_client.models.freestyle_deploy_web_configuration import FreestyleDeployWebConfiguration

# TODO update the JSON string below
json = "{}"
# create an instance of FreestyleDeployWebConfiguration from a JSON string
freestyle_deploy_web_configuration_instance = FreestyleDeployWebConfiguration.from_json(json)
# print the JSON string representation of the object
print(FreestyleDeployWebConfiguration.to_json())

# convert the object into a dict
freestyle_deploy_web_configuration_dict = freestyle_deploy_web_configuration_instance.to_dict()
# create an instance of FreestyleDeployWebConfiguration from a dict
freestyle_deploy_web_configuration_from_dict = FreestyleDeployWebConfiguration.from_dict(freestyle_deploy_web_configuration_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


