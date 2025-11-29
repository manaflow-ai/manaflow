# HandleListGitTriggers200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**triggers** | [**List[GitRepositoryTrigger]**](GitRepositoryTrigger.md) |  | 

## Example

```python
from freestyle_client.models.handle_list_git_triggers200_response import HandleListGitTriggers200Response

# TODO update the JSON string below
json = "{}"
# create an instance of HandleListGitTriggers200Response from a JSON string
handle_list_git_triggers200_response_instance = HandleListGitTriggers200Response.from_json(json)
# print the JSON string representation of the object
print(HandleListGitTriggers200Response.to_json())

# convert the object into a dict
handle_list_git_triggers200_response_dict = handle_list_git_triggers200_response_instance.to_dict()
# create an instance of HandleListGitTriggers200Response from a dict
handle_list_git_triggers200_response_from_dict = HandleListGitTriggers200Response.from_dict(handle_list_git_triggers200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


