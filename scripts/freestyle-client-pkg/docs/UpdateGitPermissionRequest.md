# UpdateGitPermissionRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**permission** | [**AccessLevel**](AccessLevel.md) |  | 

## Example

```python
from freestyle_client.models.update_git_permission_request import UpdateGitPermissionRequest

# TODO update the JSON string below
json = "{}"
# create an instance of UpdateGitPermissionRequest from a JSON string
update_git_permission_request_instance = UpdateGitPermissionRequest.from_json(json)
# print the JSON string representation of the object
print(UpdateGitPermissionRequest.to_json())

# convert the object into a dict
update_git_permission_request_dict = update_git_permission_request_instance.to_dict()
# create an instance of UpdateGitPermissionRequest from a dict
update_git_permission_request_from_dict = UpdateGitPermissionRequest.from_dict(update_git_permission_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


