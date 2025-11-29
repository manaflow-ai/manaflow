# BranchDetails


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**default** | **bool** |  | 
**name** | **str** |  | 
**target** | **str** |  | [optional] 

## Example

```python
from freestyle_client.models.branch_details import BranchDetails

# TODO update the JSON string below
json = "{}"
# create an instance of BranchDetails from a JSON string
branch_details_instance = BranchDetails.from_json(json)
# print the JSON string representation of the object
print(BranchDetails.to_json())

# convert the object into a dict
branch_details_dict = branch_details_instance.to_dict()
# create an instance of BranchDetails from a dict
branch_details_from_dict = BranchDetails.from_dict(branch_details_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


