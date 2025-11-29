# FreestyleDeployWebSuccessResponseV2OneOf


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**deployment_id** | **str** |  | 
**project_id** | **str** |  | 
**domains** | **List[str]** |  | [optional] 
**entrypoint** | **str** | The entrypoint file for the website. If not specified we try to automatically detect it. | 

## Example

```python
from freestyle_client.models.freestyle_deploy_web_success_response_v2_one_of import FreestyleDeployWebSuccessResponseV2OneOf

# TODO update the JSON string below
json = "{}"
# create an instance of FreestyleDeployWebSuccessResponseV2OneOf from a JSON string
freestyle_deploy_web_success_response_v2_one_of_instance = FreestyleDeployWebSuccessResponseV2OneOf.from_json(json)
# print the JSON string representation of the object
print(FreestyleDeployWebSuccessResponseV2OneOf.to_json())

# convert the object into a dict
freestyle_deploy_web_success_response_v2_one_of_dict = freestyle_deploy_web_success_response_v2_one_of_instance.to_dict()
# create an instance of FreestyleDeployWebSuccessResponseV2OneOf from a dict
freestyle_deploy_web_success_response_v2_one_of_from_dict = FreestyleDeployWebSuccessResponseV2OneOf.from_dict(freestyle_deploy_web_success_response_v2_one_of_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


