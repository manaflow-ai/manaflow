# TreeEntry


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**path** | **str** |  | 
**sha** | **str** |  | 
**size** | **int** |  | 
**type** | **str** |  | 

## Example

```python
from freestyle_client.models.tree_entry import TreeEntry

# TODO update the JSON string below
json = "{}"
# create an instance of TreeEntry from a JSON string
tree_entry_instance = TreeEntry.from_json(json)
# print the JSON string representation of the object
print(TreeEntry.to_json())

# convert the object into a dict
tree_entry_dict = tree_entry_instance.to_dict()
# create an instance of TreeEntry from a dict
tree_entry_from_dict = TreeEntry.from_dict(tree_entry_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


