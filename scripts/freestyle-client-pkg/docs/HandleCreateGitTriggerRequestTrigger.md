# HandleCreateGitTriggerRequestTrigger


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**branches** | **List[str]** |  | [optional] 
**globs** | **List[str]** |  | [optional] 
**event** | **str** |  | 

## Example

```python
from freestyle_client.models.handle_create_git_trigger_request_trigger import HandleCreateGitTriggerRequestTrigger

# TODO update the JSON string below
json = "{}"
# create an instance of HandleCreateGitTriggerRequestTrigger from a JSON string
handle_create_git_trigger_request_trigger_instance = HandleCreateGitTriggerRequestTrigger.from_json(json)
# print the JSON string representation of the object
print(HandleCreateGitTriggerRequestTrigger.to_json())

# convert the object into a dict
handle_create_git_trigger_request_trigger_dict = handle_create_git_trigger_request_trigger_instance.to_dict()
# create an instance of HandleCreateGitTriggerRequestTrigger from a dict
handle_create_git_trigger_request_trigger_from_dict = HandleCreateGitTriggerRequestTrigger.from_dict(handle_create_git_trigger_request_trigger_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


