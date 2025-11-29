# Tree


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**path** | **str** |  | 
**sha** | **str** |  | 
**type** | **str** |  | 

## Example

```python
from freestyle_client.models.tree import Tree

# TODO update the JSON string below
json = "{}"
# create an instance of Tree from a JSON string
tree_instance = Tree.from_json(json)
# print the JSON string representation of the object
print(Tree.to_json())

# convert the object into a dict
tree_dict = tree_instance.to_dict()
# create an instance of Tree from a dict
tree_from_dict = Tree.from_dict(tree_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


