# StartVmRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**idle_timeout_seconds** | **int** |  | [optional] 
**ready_signal_timeout_seconds** | **int** |  | [optional] 
**wait_for_ready_signal** | **bool** |  | [optional] 

## Example

```python
from freestyle_client.models.start_vm_request import StartVmRequest

# TODO update the JSON string below
json = "{}"
# create an instance of StartVmRequest from a JSON string
start_vm_request_instance = StartVmRequest.from_json(json)
# print the JSON string representation of the object
print(StartVmRequest.to_json())

# convert the object into a dict
start_vm_request_dict = start_vm_request_instance.to_dict()
# create an instance of StartVmRequest from a dict
start_vm_request_from_dict = StartVmRequest.from_dict(start_vm_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


