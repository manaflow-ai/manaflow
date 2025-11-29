# HandleCreateGitTriggerRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**trigger** | [**HandleCreateGitTriggerRequestTrigger**](HandleCreateGitTriggerRequestTrigger.md) |  | 
**action** | [**HandleCreateGitTriggerRequestAction**](HandleCreateGitTriggerRequestAction.md) |  | 

## Example

```python
from freestyle_client.models.handle_create_git_trigger_request import HandleCreateGitTriggerRequest

# TODO update the JSON string below
json = "{}"
# create an instance of HandleCreateGitTriggerRequest from a JSON string
handle_create_git_trigger_request_instance = HandleCreateGitTriggerRequest.from_json(json)
# print the JSON string representation of the object
print(HandleCreateGitTriggerRequest.to_json())

# convert the object into a dict
handle_create_git_trigger_request_dict = handle_create_git_trigger_request_instance.to_dict()
# create an instance of HandleCreateGitTriggerRequest from a dict
handle_create_git_trigger_request_from_dict = HandleCreateGitTriggerRequest.from_dict(handle_create_git_trigger_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


