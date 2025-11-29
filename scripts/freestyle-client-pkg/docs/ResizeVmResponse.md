# ResizeVmResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**size_mb** | **int** |  | 

## Example

```python
from freestyle_client.models.resize_vm_response import ResizeVmResponse

# TODO update the JSON string below
json = "{}"
# create an instance of ResizeVmResponse from a JSON string
resize_vm_response_instance = ResizeVmResponse.from_json(json)
# print the JSON string representation of the object
print(ResizeVmResponse.to_json())

# convert the object into a dict
resize_vm_response_dict = resize_vm_response_instance.to_dict()
# create an instance of ResizeVmResponse from a dict
resize_vm_response_from_dict = ResizeVmResponse.from_dict(resize_vm_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


