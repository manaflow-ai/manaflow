# FreestyleCloudstateDeploySuccessResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**deployment_id** | **str** |  | 
**cloudstate_database_id** | **str** |  | 

## Example

```python
from freestyle_client.models.freestyle_cloudstate_deploy_success_response import FreestyleCloudstateDeploySuccessResponse

# TODO update the JSON string below
json = "{}"
# create an instance of FreestyleCloudstateDeploySuccessResponse from a JSON string
freestyle_cloudstate_deploy_success_response_instance = FreestyleCloudstateDeploySuccessResponse.from_json(json)
# print the JSON string representation of the object
print(FreestyleCloudstateDeploySuccessResponse.to_json())

# convert the object into a dict
freestyle_cloudstate_deploy_success_response_dict = freestyle_cloudstate_deploy_success_response_instance.to_dict()
# create an instance of FreestyleCloudstateDeploySuccessResponse from a dict
freestyle_cloudstate_deploy_success_response_from_dict = FreestyleCloudstateDeploySuccessResponse.from_dict(freestyle_cloudstate_deploy_success_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


