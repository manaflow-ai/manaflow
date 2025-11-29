# Git


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**url** | **str** |  | 
**branch** | **str** |  | [optional] 
**dir** | **str** |  | [optional] 
**commit_message** | **str** |  | 
**author_name** | **str** |  | [optional] 
**author_email** | **str** |  | [optional] 
**type** | **str** |  | 

## Example

```python
from freestyle_client.models.git import Git

# TODO update the JSON string below
json = "{}"
# create an instance of Git from a JSON string
git_instance = Git.from_json(json)
# print the JSON string representation of the object
print(Git.to_json())

# convert the object into a dict
git_dict = git_instance.to_dict()
# create an instance of Git from a dict
git_from_dict = Git.from_dict(git_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


