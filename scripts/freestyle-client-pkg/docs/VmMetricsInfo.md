# VmMetricsInfo


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**wall_time_seconds** | **int** |  | 
**billing_day** | **str** |  | 
**is_active_today** | **bool** |  | 

## Example

```python
from freestyle_client.models.vm_metrics_info import VmMetricsInfo

# TODO update the JSON string below
json = "{}"
# create an instance of VmMetricsInfo from a JSON string
vm_metrics_info_instance = VmMetricsInfo.from_json(json)
# print the JSON string representation of the object
print(VmMetricsInfo.to_json())

# convert the object into a dict
vm_metrics_info_dict = vm_metrics_info_instance.to_dict()
# create an instance of VmMetricsInfo from a dict
vm_metrics_info_from_dict = VmMetricsInfo.from_dict(vm_metrics_info_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


