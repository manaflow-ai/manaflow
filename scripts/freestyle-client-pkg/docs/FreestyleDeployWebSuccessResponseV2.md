# FreestyleDeployWebSuccessResponseV2


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**deployment_id** | **str** |  | 
**project_id** | **str** |  | 
**domains** | **List[str]** |  | [optional] 
**entrypoint** | **str** | The entrypoint file for the website. If not specified we try to automatically detect it. | 

## Example

```python
from freestyle_client.models.freestyle_deploy_web_success_response_v2 import FreestyleDeployWebSuccessResponseV2

# TODO update the JSON string below
json = "{}"
# create an instance of FreestyleDeployWebSuccessResponseV2 from a JSON string
freestyle_deploy_web_success_response_v2_instance = FreestyleDeployWebSuccessResponseV2.from_json(json)
# print the JSON string representation of the object
print(FreestyleDeployWebSuccessResponseV2.to_json())

# convert the object into a dict
freestyle_deploy_web_success_response_v2_dict = freestyle_deploy_web_success_response_v2_instance.to_dict()
# create an instance of FreestyleDeployWebSuccessResponseV2 from a dict
freestyle_deploy_web_success_response_v2_from_dict = FreestyleDeployWebSuccessResponseV2.from_dict(freestyle_deploy_web_success_response_v2_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


