# GitContentsDirEntryItem


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** |  | 
**path** | **str** |  | 
**sha** | **str** | The hash / object ID of the directory. | 
**size** | **int** |  | 
**type** | **str** |  | 
**entries** | [**List[DirectoryEntryEntriesInner]**](DirectoryEntryEntriesInner.md) |  | 

## Example

```python
from freestyle_client.models.git_contents_dir_entry_item import GitContentsDirEntryItem

# TODO update the JSON string below
json = "{}"
# create an instance of GitContentsDirEntryItem from a JSON string
git_contents_dir_entry_item_instance = GitContentsDirEntryItem.from_json(json)
# print the JSON string representation of the object
print(GitContentsDirEntryItem.to_json())

# convert the object into a dict
git_contents_dir_entry_item_dict = git_contents_dir_entry_item_instance.to_dict()
# create an instance of GitContentsDirEntryItem from a dict
git_contents_dir_entry_item_from_dict = GitContentsDirEntryItem.from_dict(git_contents_dir_entry_item_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


