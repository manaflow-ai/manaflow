# GitRepositoryTrigger


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**repository_id** | **str** |  | 
**trigger** | [**HandleCreateGitTriggerRequestTrigger**](HandleCreateGitTriggerRequestTrigger.md) |  | 
**action** | [**HandleCreateGitTriggerRequestAction**](HandleCreateGitTriggerRequestAction.md) |  | 
**managed** | **bool** |  | 
**id** | **str** |  | 
**created_at** | **datetime** |  | 

## Example

```python
from freestyle_client.models.git_repository_trigger import GitRepositoryTrigger

# TODO update the JSON string below
json = "{}"
# create an instance of GitRepositoryTrigger from a JSON string
git_repository_trigger_instance = GitRepositoryTrigger.from_json(json)
# print the JSON string representation of the object
print(GitRepositoryTrigger.to_json())

# convert the object into a dict
git_repository_trigger_dict = git_repository_trigger_instance.to_dict()
# create an instance of GitRepositoryTrigger from a dict
git_repository_trigger_from_dict = GitRepositoryTrigger.from_dict(git_repository_trigger_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


