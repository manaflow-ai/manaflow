# GitCommitPushResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**committed** | **bool** |  | 
**pushed** | **bool** |  | 

## Example

```python
from freestyle_client.models.git_commit_push_response import GitCommitPushResponse

# TODO update the JSON string below
json = "{}"
# create an instance of GitCommitPushResponse from a JSON string
git_commit_push_response_instance = GitCommitPushResponse.from_json(json)
# print the JSON string representation of the object
print(GitCommitPushResponse.to_json())

# convert the object into a dict
git_commit_push_response_dict = git_commit_push_response_instance.to_dict()
# create an instance of GitCommitPushResponse from a dict
git_commit_push_response_from_dict = GitCommitPushResponse.from_dict(git_commit_push_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


