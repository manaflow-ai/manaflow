# ListGitPermissionSuccess


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**repositories** | [**List[AccessibleRepository]**](AccessibleRepository.md) |  | 

## Example

```python
from freestyle_client.models.list_git_permission_success import ListGitPermissionSuccess

# TODO update the JSON string below
json = "{}"
# create an instance of ListGitPermissionSuccess from a JSON string
list_git_permission_success_instance = ListGitPermissionSuccess.from_json(json)
# print the JSON string representation of the object
print(ListGitPermissionSuccess.to_json())

# convert the object into a dict
list_git_permission_success_dict = list_git_permission_success_instance.to_dict()
# create an instance of ListGitPermissionSuccess from a dict
list_git_permission_success_from_dict = ListGitPermissionSuccess.from_dict(list_git_permission_success_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


