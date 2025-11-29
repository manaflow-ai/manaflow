# SystemdConfigInternal


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**enabled** | **bool** |  | [default to True]
**services** | [**List[SystemdUnitSpec]**](SystemdUnitSpec.md) |  | [optional] 
**patched_services** | [**List[SystemdUnitSpecPatch]**](SystemdUnitSpecPatch.md) |  | [optional] 

## Example

```python
from freestyle_client.models.systemd_config_internal import SystemdConfigInternal

# TODO update the JSON string below
json = "{}"
# create an instance of SystemdConfigInternal from a JSON string
systemd_config_internal_instance = SystemdConfigInternal.from_json(json)
# print the JSON string representation of the object
print(SystemdConfigInternal.to_json())

# convert the object into a dict
systemd_config_internal_dict = systemd_config_internal_instance.to_dict()
# create an instance of SystemdConfigInternal from a dict
systemd_config_internal_from_dict = SystemdConfigInternal.from_dict(systemd_config_internal_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


