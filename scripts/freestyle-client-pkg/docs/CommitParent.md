# CommitParent


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**sha** | **str** | The commit&#39;s hash ID | 

## Example

```python
from freestyle_client.models.commit_parent import CommitParent

# TODO update the JSON string below
json = "{}"
# create an instance of CommitParent from a JSON string
commit_parent_instance = CommitParent.from_json(json)
# print the JSON string representation of the object
print(CommitParent.to_json())

# convert the object into a dict
commit_parent_dict = commit_parent_instance.to_dict()
# create an instance of CommitParent from a dict
commit_parent_from_dict = CommitParent.from_dict(commit_parent_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


