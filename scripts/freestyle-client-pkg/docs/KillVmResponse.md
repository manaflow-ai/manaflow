# KillVmResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** | Short VM ID (5-character alphanumeric) - used for filesystem operations | 

## Example

```python
from freestyle_client.models.kill_vm_response import KillVmResponse

# TODO update the JSON string below
json = "{}"
# create an instance of KillVmResponse from a JSON string
kill_vm_response_instance = KillVmResponse.from_json(json)
# print the JSON string representation of the object
print(KillVmResponse.to_json())

# convert the object into a dict
kill_vm_response_dict = kill_vm_response_instance.to_dict()
# create an instance of KillVmResponse from a dict
kill_vm_response_from_dict = KillVmResponse.from_dict(kill_vm_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


