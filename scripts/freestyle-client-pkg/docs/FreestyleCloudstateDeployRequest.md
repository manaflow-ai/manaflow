# FreestyleCloudstateDeployRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**classes** | **str** |  | 
**config** | [**FreestyleCloudstateDeployConfiguration**](FreestyleCloudstateDeployConfiguration.md) |  | [optional] 

## Example

```python
from freestyle_client.models.freestyle_cloudstate_deploy_request import FreestyleCloudstateDeployRequest

# TODO update the JSON string below
json = "{}"
# create an instance of FreestyleCloudstateDeployRequest from a JSON string
freestyle_cloudstate_deploy_request_instance = FreestyleCloudstateDeployRequest.from_json(json)
# print the JSON string representation of the object
print(FreestyleCloudstateDeployRequest.to_json())

# convert the object into a dict
freestyle_cloudstate_deploy_request_dict = freestyle_cloudstate_deploy_request_instance.to_dict()
# create an instance of FreestyleCloudstateDeployRequest from a dict
freestyle_cloudstate_deploy_request_from_dict = FreestyleCloudstateDeployRequest.from_dict(freestyle_cloudstate_deploy_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


