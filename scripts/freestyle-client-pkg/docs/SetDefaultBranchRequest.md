# SetDefaultBranchRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**default_branch** | **str** |  | 

## Example

```python
from freestyle_client.models.set_default_branch_request import SetDefaultBranchRequest

# TODO update the JSON string below
json = "{}"
# create an instance of SetDefaultBranchRequest from a JSON string
set_default_branch_request_instance = SetDefaultBranchRequest.from_json(json)
# print the JSON string representation of the object
print(SetDefaultBranchRequest.to_json())

# convert the object into a dict
set_default_branch_request_dict = set_default_branch_request_instance.to_dict()
# create an instance of SetDefaultBranchRequest from a dict
set_default_branch_request_from_dict = SetDefaultBranchRequest.from_dict(set_default_branch_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


