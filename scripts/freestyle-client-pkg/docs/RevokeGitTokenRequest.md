# RevokeGitTokenRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**token_id** | **str** |  | 

## Example

```python
from freestyle_client.models.revoke_git_token_request import RevokeGitTokenRequest

# TODO update the JSON string below
json = "{}"
# create an instance of RevokeGitTokenRequest from a JSON string
revoke_git_token_request_instance = RevokeGitTokenRequest.from_json(json)
# print the JSON string representation of the object
print(RevokeGitTokenRequest.to_json())

# convert the object into a dict
revoke_git_token_request_dict = revoke_git_token_request_instance.to_dict()
# create an instance of RevokeGitTokenRequest from a dict
revoke_git_token_request_from_dict = RevokeGitTokenRequest.from_dict(revoke_git_token_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


