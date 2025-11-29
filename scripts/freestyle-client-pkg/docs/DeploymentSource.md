# DeploymentSource


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**files** | [**Dict[str, FreestyleFile]**](FreestyleFile.md) |  | 
**kind** | **str** |  | 
**url** | **str** |  | 
**branch** | **str** |  | [optional] 
**dir** | **str** |  | [optional] 

## Example

```python
from freestyle_client.models.deployment_source import DeploymentSource

# TODO update the JSON string below
json = "{}"
# create an instance of DeploymentSource from a JSON string
deployment_source_instance = DeploymentSource.from_json(json)
# print the JSON string representation of the object
print(DeploymentSource.to_json())

# convert the object into a dict
deployment_source_dict = deployment_source_instance.to_dict()
# create an instance of DeploymentSource from a dict
deployment_source_from_dict = DeploymentSource.from_dict(deployment_source_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


