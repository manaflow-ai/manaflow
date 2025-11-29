# VmPermission

Full VM permission record

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** |  | 
**vm_id** | **str** |  | 
**identity_id** | **str** |  | 
**allowed_users** | **List[str]** |  | [optional] 
**granted_at** | **datetime** |  | 
**granted_by** | **str** |  | 

## Example

```python
from freestyle_client.models.vm_permission import VmPermission

# TODO update the JSON string below
json = "{}"
# create an instance of VmPermission from a JSON string
vm_permission_instance = VmPermission.from_json(json)
# print the JSON string representation of the object
print(VmPermission.to_json())

# convert the object into a dict
vm_permission_dict = vm_permission_instance.to_dict()
# create an instance of VmPermission from a dict
vm_permission_from_dict = VmPermission.from_dict(vm_permission_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


