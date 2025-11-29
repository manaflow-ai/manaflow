# SuspendVmResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** |  | 

## Example

```python
from freestyle_client.models.suspend_vm_response import SuspendVmResponse

# TODO update the JSON string below
json = "{}"
# create an instance of SuspendVmResponse from a JSON string
suspend_vm_response_instance = SuspendVmResponse.from_json(json)
# print the JSON string representation of the object
print(SuspendVmResponse.to_json())

# convert the object into a dict
suspend_vm_response_dict = suspend_vm_response_instance.to_dict()
# create an instance of SuspendVmResponse from a dict
suspend_vm_response_from_dict = SuspendVmResponse.from_dict(suspend_vm_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


