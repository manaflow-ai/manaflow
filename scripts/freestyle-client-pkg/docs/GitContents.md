# GitContents


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** |  | 
**path** | **str** |  | 
**sha** | **str** | The hash / object ID of the directory. | 
**size** | **int** |  | 
**content** | **str** | Base64-encoded content. | 
**type** | **str** |  | 
**entries** | [**List[GitContentsDirEntryItem]**](GitContentsDirEntryItem.md) |  | 

## Example

```python
from freestyle_client.models.git_contents import GitContents

# TODO update the JSON string below
json = "{}"
# create an instance of GitContents from a JSON string
git_contents_instance = GitContents.from_json(json)
# print the JSON string representation of the object
print(GitContents.to_json())

# convert the object into a dict
git_contents_dict = git_contents_instance.to_dict()
# create an instance of GitContents from a dict
git_contents_from_dict = GitContents.from_dict(git_contents_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


