# ResizeVmRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**size_mb** | **int** |  | 

## Example

```python
from freestyle_client.models.resize_vm_request import ResizeVmRequest

# TODO update the JSON string below
json = "{}"
# create an instance of ResizeVmRequest from a JSON string
resize_vm_request_instance = ResizeVmRequest.from_json(json)
# print the JSON string representation of the object
print(ResizeVmRequest.to_json())

# convert the object into a dict
resize_vm_request_dict = resize_vm_request_instance.to_dict()
# create an instance of ResizeVmRequest from a dict
resize_vm_request_from_dict = ResizeVmRequest.from_dict(resize_vm_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


