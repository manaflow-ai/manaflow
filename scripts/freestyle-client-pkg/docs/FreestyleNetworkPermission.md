# FreestyleNetworkPermission


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**query** | **str** |  | 
**behavior** | [**Behavior**](Behavior.md) |  | [optional] [default to Behavior.EXACT]
**action** | **str** |  | 

## Example

```python
from freestyle_client.models.freestyle_network_permission import FreestyleNetworkPermission

# TODO update the JSON string below
json = "{}"
# create an instance of FreestyleNetworkPermission from a JSON string
freestyle_network_permission_instance = FreestyleNetworkPermission.from_json(json)
# print the JSON string representation of the object
print(FreestyleNetworkPermission.to_json())

# convert the object into a dict
freestyle_network_permission_dict = freestyle_network_permission_instance.to_dict()
# create an instance of FreestyleNetworkPermission from a dict
freestyle_network_permission_from_dict = FreestyleNetworkPermission.from_dict(freestyle_network_permission_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


