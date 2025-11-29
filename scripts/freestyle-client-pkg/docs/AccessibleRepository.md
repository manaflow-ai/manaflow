# AccessibleRepository

Identical to [`RepositoryInfo`], but with the permissions field added.

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** |  | 
**name** | **str** |  | [optional] 
**account_id** | **str** |  | 
**permissions** | [**AccessLevel**](AccessLevel.md) |  | 
**visibility** | [**Visibility**](Visibility.md) |  | 

## Example

```python
from freestyle_client.models.accessible_repository import AccessibleRepository

# TODO update the JSON string below
json = "{}"
# create an instance of AccessibleRepository from a JSON string
accessible_repository_instance = AccessibleRepository.from_json(json)
# print the JSON string representation of the object
print(AccessibleRepository.to_json())

# convert the object into a dict
accessible_repository_dict = accessible_repository_instance.to_dict()
# create an instance of AccessibleRepository from a dict
accessible_repository_from_dict = AccessibleRepository.from_dict(accessible_repository_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


