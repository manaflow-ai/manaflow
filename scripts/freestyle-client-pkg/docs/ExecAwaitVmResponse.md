# ExecAwaitVmResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**stdout** | **str** |  | [optional] 
**stderr** | **str** |  | [optional] 
**status_code** | **int** |  | [optional] 

## Example

```python
from freestyle_client.models.exec_await_vm_response import ExecAwaitVmResponse

# TODO update the JSON string below
json = "{}"
# create an instance of ExecAwaitVmResponse from a JSON string
exec_await_vm_response_instance = ExecAwaitVmResponse.from_json(json)
# print the JSON string representation of the object
print(ExecAwaitVmResponse.to_json())

# convert the object into a dict
exec_await_vm_response_dict = exec_await_vm_response_instance.to_dict()
# create an instance of ExecAwaitVmResponse from a dict
exec_await_vm_response_from_dict = ExecAwaitVmResponse.from_dict(exec_await_vm_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


