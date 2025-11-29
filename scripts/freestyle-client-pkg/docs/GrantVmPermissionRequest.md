# GrantVmPermissionRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**allowed_users** | **List[str]** | List of allowed Linux users. If null, identity can SSH as any user. If specified, identity can only SSH as users in this list. | [optional] 

## Example

```python
from freestyle_client.models.grant_vm_permission_request import GrantVmPermissionRequest

# TODO update the JSON string below
json = "{}"
# create an instance of GrantVmPermissionRequest from a JSON string
grant_vm_permission_request_instance = GrantVmPermissionRequest.from_json(json)
# print the JSON string representation of the object
print(GrantVmPermissionRequest.to_json())

# convert the object into a dict
grant_vm_permission_request_dict = grant_vm_permission_request_instance.to_dict()
# create an instance of GrantVmPermissionRequest from a dict
grant_vm_permission_request_from_dict = GrantVmPermissionRequest.from_dict(grant_vm_permission_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


