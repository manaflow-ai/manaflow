# BranchInfo


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** |  | 
**commit** | **str** | The latest commit ID on this branch. Null if the branch is empty. | [optional] 

## Example

```python
from freestyle_client.models.branch_info import BranchInfo

# TODO update the JSON string below
json = "{}"
# create an instance of BranchInfo from a JSON string
branch_info_instance = BranchInfo.from_json(json)
# print the JSON string representation of the object
print(BranchInfo.to_json())

# convert the object into a dict
branch_info_dict = branch_info_instance.to_dict()
# create an instance of BranchInfo from a dict
branch_info_from_dict = BranchInfo.from_dict(branch_info_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


