# ListGitTokensSuccess


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**tokens** | [**List[AccessTokenInfo]**](AccessTokenInfo.md) |  | 

## Example

```python
from freestyle_client.models.list_git_tokens_success import ListGitTokensSuccess

# TODO update the JSON string below
json = "{}"
# create an instance of ListGitTokensSuccess from a JSON string
list_git_tokens_success_instance = ListGitTokensSuccess.from_json(json)
# print the JSON string representation of the object
print(ListGitTokensSuccess.to_json())

# convert the object into a dict
list_git_tokens_success_dict = list_git_tokens_success_instance.to_dict()
# create an instance of ListGitTokensSuccess from a dict
list_git_tokens_success_from_dict = ListGitTokensSuccess.from_dict(list_git_tokens_success_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


