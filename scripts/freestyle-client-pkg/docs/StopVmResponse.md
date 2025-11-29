# StopVmResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** | Short VM ID (5-character alphanumeric) - used for filesystem operations | 

## Example

```python
from freestyle_client.models.stop_vm_response import StopVmResponse

# TODO update the JSON string below
json = "{}"
# create an instance of StopVmResponse from a JSON string
stop_vm_response_instance = StopVmResponse.from_json(json)
# print the JSON string representation of the object
print(StopVmResponse.to_json())

# convert the object into a dict
stop_vm_response_dict = stop_vm_response_instance.to_dict()
# create an instance of StopVmResponse from a dict
stop_vm_response_from_dict = StopVmResponse.from_dict(stop_vm_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


