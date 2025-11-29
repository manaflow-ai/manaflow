# WaitVmResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** | Short VM ID (5-character alphanumeric) - used for filesystem operations | 
**exit_status** | **str** |  | 

## Example

```python
from freestyle_client.models.wait_vm_response import WaitVmResponse

# TODO update the JSON string below
json = "{}"
# create an instance of WaitVmResponse from a JSON string
wait_vm_response_instance = WaitVmResponse.from_json(json)
# print the JSON string representation of the object
print(WaitVmResponse.to_json())

# convert the object into a dict
wait_vm_response_dict = wait_vm_response_instance.to_dict()
# create an instance of WaitVmResponse from a dict
wait_vm_response_from_dict = WaitVmResponse.from_dict(wait_vm_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


