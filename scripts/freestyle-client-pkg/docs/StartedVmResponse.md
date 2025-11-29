# StartedVmResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** |  | 
**domains** | **List[str]** |  | 
**console_url** | **str** |  | [optional] 

## Example

```python
from freestyle_client.models.started_vm_response import StartedVmResponse

# TODO update the JSON string below
json = "{}"
# create an instance of StartedVmResponse from a JSON string
started_vm_response_instance = StartedVmResponse.from_json(json)
# print the JSON string representation of the object
print(StartedVmResponse.to_json())

# convert the object into a dict
started_vm_response_dict = started_vm_response_instance.to_dict()
# create an instance of StartedVmResponse from a dict
started_vm_response_from_dict = StartedVmResponse.from_dict(started_vm_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


