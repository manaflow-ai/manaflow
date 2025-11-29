# FreestyleNetworkPermissionOneOf


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**query** | **str** |  | 
**behavior** | [**Behavior**](Behavior.md) |  | [optional] [default to Behavior.EXACT]
**action** | **str** |  | 

## Example

```python
from freestyle_client.models.freestyle_network_permission_one_of import FreestyleNetworkPermissionOneOf

# TODO update the JSON string below
json = "{}"
# create an instance of FreestyleNetworkPermissionOneOf from a JSON string
freestyle_network_permission_one_of_instance = FreestyleNetworkPermissionOneOf.from_json(json)
# print the JSON string representation of the object
print(FreestyleNetworkPermissionOneOf.to_json())

# convert the object into a dict
freestyle_network_permission_one_of_dict = freestyle_network_permission_one_of_instance.to_dict()
# create an instance of FreestyleNetworkPermissionOneOf from a dict
freestyle_network_permission_one_of_from_dict = FreestyleNetworkPermissionOneOf.from_dict(freestyle_network_permission_one_of_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


