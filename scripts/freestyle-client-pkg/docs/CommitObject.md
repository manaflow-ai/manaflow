# CommitObject

Commit object

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**author** | [**Signature**](Signature.md) | The author of the commit | 
**committer** | [**Signature**](Signature.md) | The committer | 
**message** | **str** | The commit message | 
**tree** | [**CommitTree**](CommitTree.md) | The ID of the tree pointed to by this commit | 
**parents** | [**List[CommitParent]**](CommitParent.md) | Parent commit(s) of this commit | 
**sha** | **str** | The commit&#39;s hash ID | 

## Example

```python
from freestyle_client.models.commit_object import CommitObject

# TODO update the JSON string below
json = "{}"
# create an instance of CommitObject from a JSON string
commit_object_instance = CommitObject.from_json(json)
# print the JSON string representation of the object
print(CommitObject.to_json())

# convert the object into a dict
commit_object_dict = commit_object_instance.to_dict()
# create an instance of CommitObject from a dict
commit_object_from_dict = CommitObject.from_dict(commit_object_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


