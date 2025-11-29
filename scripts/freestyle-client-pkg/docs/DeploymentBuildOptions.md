# DeploymentBuildOptions


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**command** | **str** |  | 
**out_dir** | **str** |  | [optional] 
**env_vars** | **Dict[str, str]** |  | [optional] 

## Example

```python
from freestyle_client.models.deployment_build_options import DeploymentBuildOptions

# TODO update the JSON string below
json = "{}"
# create an instance of DeploymentBuildOptions from a JSON string
deployment_build_options_instance = DeploymentBuildOptions.from_json(json)
# print the JSON string representation of the object
print(DeploymentBuildOptions.to_json())

# convert the object into a dict
deployment_build_options_dict = deployment_build_options_instance.to_dict()
# create an instance of DeploymentBuildOptions from a dict
deployment_build_options_from_dict = DeploymentBuildOptions.from_dict(deployment_build_options_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


