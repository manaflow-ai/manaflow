# CommitTree


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**sha** | **str** | The tree&#39;s hash ID | 

## Example

```python
from freestyle_client.models.commit_tree import CommitTree

# TODO update the JSON string below
json = "{}"
# create an instance of CommitTree from a JSON string
commit_tree_instance = CommitTree.from_json(json)
# print the JSON string representation of the object
print(CommitTree.to_json())

# convert the object into a dict
commit_tree_dict = commit_tree_instance.to_dict()
# create an instance of CommitTree from a dict
commit_tree_from_dict = CommitTree.from_dict(commit_tree_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


