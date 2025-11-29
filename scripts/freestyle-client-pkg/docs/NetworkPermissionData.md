# NetworkPermissionData


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**query** | **str** |  | 
**behavior** | [**Behavior**](Behavior.md) |  | [optional] [default to Behavior.EXACT]

## Example

```python
from freestyle_client.models.network_permission_data import NetworkPermissionData

# TODO update the JSON string below
json = "{}"
# create an instance of NetworkPermissionData from a JSON string
network_permission_data_instance = NetworkPermissionData.from_json(json)
# print the JSON string representation of the object
print(NetworkPermissionData.to_json())

# convert the object into a dict
network_permission_data_dict = network_permission_data_instance.to_dict()
# create an instance of NetworkPermissionData from a dict
network_permission_data_from_dict = NetworkPermissionData.from_dict(network_permission_data_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


