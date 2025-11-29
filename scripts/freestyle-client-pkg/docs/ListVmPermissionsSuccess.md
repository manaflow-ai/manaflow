# ListVmPermissionsSuccess


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**permissions** | [**List[VmPermission]**](VmPermission.md) |  | 
**offset** | **int** |  | 
**total** | **int** |  | 

## Example

```python
from freestyle_client.models.list_vm_permissions_success import ListVmPermissionsSuccess

# TODO update the JSON string below
json = "{}"
# create an instance of ListVmPermissionsSuccess from a JSON string
list_vm_permissions_success_instance = ListVmPermissionsSuccess.from_json(json)
# print the JSON string representation of the object
print(ListVmPermissionsSuccess.to_json())

# convert the object into a dict
list_vm_permissions_success_dict = list_vm_permissions_success_instance.to_dict()
# create an instance of ListVmPermissionsSuccess from a dict
list_vm_permissions_success_from_dict = ListVmPermissionsSuccess.from_dict(list_vm_permissions_success_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


