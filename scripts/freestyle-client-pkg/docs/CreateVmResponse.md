# CreateVmResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** |  | 
**domains** | **List[str]** |  | 
**console_url** | **str** |  | [optional] 

## Example

```python
from freestyle_client.models.create_vm_response import CreateVmResponse

# TODO update the JSON string below
json = "{}"
# create an instance of CreateVmResponse from a JSON string
create_vm_response_instance = CreateVmResponse.from_json(json)
# print the JSON string representation of the object
print(CreateVmResponse.to_json())

# convert the object into a dict
create_vm_response_dict = create_vm_response_instance.to_dict()
# create an instance of CreateVmResponse from a dict
create_vm_response_from_dict = CreateVmResponse.from_dict(create_vm_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


