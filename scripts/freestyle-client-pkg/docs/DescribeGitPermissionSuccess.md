# DescribeGitPermissionSuccess


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**identity** | **str** |  | 
**repo** | **str** |  | 
**access_level** | [**AccessLevel**](AccessLevel.md) |  | [optional] 

## Example

```python
from freestyle_client.models.describe_git_permission_success import DescribeGitPermissionSuccess

# TODO update the JSON string below
json = "{}"
# create an instance of DescribeGitPermissionSuccess from a JSON string
describe_git_permission_success_instance = DescribeGitPermissionSuccess.from_json(json)
# print the JSON string representation of the object
print(DescribeGitPermissionSuccess.to_json())

# convert the object into a dict
describe_git_permission_success_dict = describe_git_permission_success_instance.to_dict()
# create an instance of DescribeGitPermissionSuccess from a dict
describe_git_permission_success_from_dict = DescribeGitPermissionSuccess.from_dict(describe_git_permission_success_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


