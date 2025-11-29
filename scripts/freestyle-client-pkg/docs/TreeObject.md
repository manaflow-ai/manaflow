# TreeObject

Tree object

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**tree** | [**List[TreeEntry]**](TreeEntry.md) | The tree&#39;s entries | 
**sha** | **str** | The tree&#39;s hash ID | 

## Example

```python
from freestyle_client.models.tree_object import TreeObject

# TODO update the JSON string below
json = "{}"
# create an instance of TreeObject from a JSON string
tree_object_instance = TreeObject.from_json(json)
# print the JSON string representation of the object
print(TreeObject.to_json())

# convert the object into a dict
tree_object_dict = tree_object_instance.to_dict()
# create an instance of TreeObject from a dict
tree_object_from_dict = TreeObject.from_dict(tree_object_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


