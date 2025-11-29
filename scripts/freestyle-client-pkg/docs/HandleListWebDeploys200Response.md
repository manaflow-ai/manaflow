# HandleListWebDeploys200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**entries** | [**List[DeploymentLogEntry]**](DeploymentLogEntry.md) |  | 
**total** | **int** |  | 
**offset** | **int** |  | 

## Example

```python
from freestyle_client.models.handle_list_web_deploys200_response import HandleListWebDeploys200Response

# TODO update the JSON string below
json = "{}"
# create an instance of HandleListWebDeploys200Response from a JSON string
handle_list_web_deploys200_response_instance = HandleListWebDeploys200Response.from_json(json)
# print the JSON string representation of the object
print(HandleListWebDeploys200Response.to_json())

# convert the object into a dict
handle_list_web_deploys200_response_dict = handle_list_web_deploys200_response_instance.to_dict()
# create an instance of HandleListWebDeploys200Response from a dict
handle_list_web_deploys200_response_from_dict = HandleListWebDeploys200Response.from_dict(handle_list_web_deploys200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


