# FreestyleDeployWebPayloadV2


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**source** | [**DeploymentSource**](DeploymentSource.md) |  | 
**config** | [**FreestyleDeployWebConfiguration**](FreestyleDeployWebConfiguration.md) |  | 

## Example

```python
from freestyle_client.models.freestyle_deploy_web_payload_v2 import FreestyleDeployWebPayloadV2

# TODO update the JSON string below
json = "{}"
# create an instance of FreestyleDeployWebPayloadV2 from a JSON string
freestyle_deploy_web_payload_v2_instance = FreestyleDeployWebPayloadV2.from_json(json)
# print the JSON string representation of the object
print(FreestyleDeployWebPayloadV2.to_json())

# convert the object into a dict
freestyle_deploy_web_payload_v2_dict = freestyle_deploy_web_payload_v2_instance.to_dict()
# create an instance of FreestyleDeployWebPayloadV2 from a dict
freestyle_deploy_web_payload_v2_from_dict = FreestyleDeployWebPayloadV2.from_dict(freestyle_deploy_web_payload_v2_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


