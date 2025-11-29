# GitCommitPushRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**dev_server** | [**DevServerIdentifier**](DevServerIdentifier.md) |  | 
**message** | **str** |  | 

## Example

```python
from freestyle_client.models.git_commit_push_request import GitCommitPushRequest

# TODO update the JSON string below
json = "{}"
# create an instance of GitCommitPushRequest from a JSON string
git_commit_push_request_instance = GitCommitPushRequest.from_json(json)
# print the JSON string representation of the object
print(GitCommitPushRequest.to_json())

# convert the object into a dict
git_commit_push_request_dict = git_commit_push_request_instance.to_dict()
# create an instance of GitCommitPushRequest from a dict
git_commit_push_request_from_dict = GitCommitPushRequest.from_dict(git_commit_push_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


