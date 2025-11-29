# ListIdentitiesSuccess


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**identities** | [**List[FreestyleIdentity]**](FreestyleIdentity.md) |  | 
**offset** | **int** |  | 
**total** | **int** |  | 

## Example

```python
from freestyle_client.models.list_identities_success import ListIdentitiesSuccess

# TODO update the JSON string below
json = "{}"
# create an instance of ListIdentitiesSuccess from a JSON string
list_identities_success_instance = ListIdentitiesSuccess.from_json(json)
# print the JSON string representation of the object
print(ListIdentitiesSuccess.to_json())

# convert the object into a dict
list_identities_success_dict = list_identities_success_instance.to_dict()
# create an instance of ListIdentitiesSuccess from a dict
list_identities_success_from_dict = ListIdentitiesSuccess.from_dict(list_identities_success_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


