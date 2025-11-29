# VmTemplatePortsInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**port** | **int** |  | 
**target_port** | **int** |  | 

## Example

```python
from freestyle_client.models.vm_template_ports_inner import VmTemplatePortsInner

# TODO update the JSON string below
json = "{}"
# create an instance of VmTemplatePortsInner from a JSON string
vm_template_ports_inner_instance = VmTemplatePortsInner.from_json(json)
# print the JSON string representation of the object
print(VmTemplatePortsInner.to_json())

# convert the object into a dict
vm_template_ports_inner_dict = vm_template_ports_inner_instance.to_dict()
# create an instance of VmTemplatePortsInner from a dict
vm_template_ports_inner_from_dict = VmTemplatePortsInner.from_dict(vm_template_ports_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


