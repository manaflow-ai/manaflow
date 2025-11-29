# ForkVmResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** |  | 
**domains** | **List[str]** |  | 
**console_url** | **str** |  | [optional] 

## Example

```python
from freestyle_client.models.fork_vm_response import ForkVmResponse

# TODO update the JSON string below
json = "{}"
# create an instance of ForkVmResponse from a JSON string
fork_vm_response_instance = ForkVmResponse.from_json(json)
# print the JSON string representation of the object
print(ForkVmResponse.to_json())

# convert the object into a dict
fork_vm_response_dict = fork_vm_response_instance.to_dict()
# create an instance of ForkVmResponse from a dict
fork_vm_response_from_dict = ForkVmResponse.from_dict(fork_vm_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


