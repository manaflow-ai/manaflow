# FreestyleCloudstateDeployConfiguration


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**domains** | **List[str]** | ID of the project to deploy, if not provided will create a new project | [optional] 
**env_vars** | **Dict[str, str]** | The environment variables that the cloudstate deploy can access | [optional] 
**cloudstate_database_id** | **str** |  | [optional] 

## Example

```python
from freestyle_client.models.freestyle_cloudstate_deploy_configuration import FreestyleCloudstateDeployConfiguration

# TODO update the JSON string below
json = "{}"
# create an instance of FreestyleCloudstateDeployConfiguration from a JSON string
freestyle_cloudstate_deploy_configuration_instance = FreestyleCloudstateDeployConfiguration.from_json(json)
# print the JSON string representation of the object
print(FreestyleCloudstateDeployConfiguration.to_json())

# convert the object into a dict
freestyle_cloudstate_deploy_configuration_dict = freestyle_cloudstate_deploy_configuration_instance.to_dict()
# create an instance of FreestyleCloudstateDeployConfiguration from a dict
freestyle_cloudstate_deploy_configuration_from_dict = FreestyleCloudstateDeployConfiguration.from_dict(freestyle_cloudstate_deploy_configuration_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


