# OptimizeVmResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** |  | 
**message** | **str** |  | 

## Example

```python
from freestyle_client.models.optimize_vm_response import OptimizeVmResponse

# TODO update the JSON string below
json = "{}"
# create an instance of OptimizeVmResponse from a JSON string
optimize_vm_response_instance = OptimizeVmResponse.from_json(json)
# print the JSON string representation of the object
print(OptimizeVmResponse.to_json())

# convert the object into a dict
optimize_vm_response_dict = optimize_vm_response_instance.to_dict()
# create an instance of OptimizeVmResponse from a dict
optimize_vm_response_from_dict = OptimizeVmResponse.from_dict(optimize_vm_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


