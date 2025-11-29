# VmInfo


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** |  | 
**state** | [**VMState**](VMState.md) |  | 
**metrics** | [**VmMetricsInfo**](VmMetricsInfo.md) |  | [optional] 
**created_at** | **datetime** |  | [optional] 
**last_network_activity** | **datetime** |  | [optional] 
**cpu_time_seconds** | **float** |  | [optional] 

## Example

```python
from freestyle_client.models.vm_info import VmInfo

# TODO update the JSON string below
json = "{}"
# create an instance of VmInfo from a JSON string
vm_info_instance = VmInfo.from_json(json)
# print the JSON string representation of the object
print(VmInfo.to_json())

# convert the object into a dict
vm_info_dict = vm_info_instance.to_dict()
# create an instance of VmInfo from a dict
vm_info_from_dict = VmInfo.from_dict(vm_info_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


