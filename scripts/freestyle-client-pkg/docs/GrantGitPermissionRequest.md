# GrantGitPermissionRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**permission** | [**AccessLevel**](AccessLevel.md) |  | 

## Example

```python
from freestyle_client.models.grant_git_permission_request import GrantGitPermissionRequest

# TODO update the JSON string below
json = "{}"
# create an instance of GrantGitPermissionRequest from a JSON string
grant_git_permission_request_instance = GrantGitPermissionRequest.from_json(json)
# print the JSON string representation of the object
print(GrantGitPermissionRequest.to_json())

# convert the object into a dict
grant_git_permission_request_dict = grant_git_permission_request_instance.to_dict()
# create an instance of GrantGitPermissionRequest from a dict
grant_git_permission_request_from_dict = GrantGitPermissionRequest.from_dict(grant_git_permission_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


