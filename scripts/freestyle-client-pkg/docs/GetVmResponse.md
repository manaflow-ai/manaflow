# GetVmResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** |  | 
**last_network_activity** | **datetime** |  | [optional] 
**state** | [**VMState**](VMState.md) |  | [optional] 
**cpu_time_seconds** | **float** |  | [optional] 

## Example

```python
from freestyle_client.models.get_vm_response import GetVmResponse

# TODO update the JSON string below
json = "{}"
# create an instance of GetVmResponse from a JSON string
get_vm_response_instance = GetVmResponse.from_json(json)
# print the JSON string representation of the object
print(GetVmResponse.to_json())

# convert the object into a dict
get_vm_response_dict = get_vm_response_instance.to_dict()
# create an instance of GetVmResponse from a dict
get_vm_response_from_dict = GetVmResponse.from_dict(get_vm_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


