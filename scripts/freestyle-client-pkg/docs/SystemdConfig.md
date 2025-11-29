# SystemdConfig


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**services** | [**List[SystemdUnitSpec]**](SystemdUnitSpec.md) |  | [optional] 
**patched_services** | [**List[SystemdUnitSpecPatch]**](SystemdUnitSpecPatch.md) |  | [optional] 

## Example

```python
from freestyle_client.models.systemd_config import SystemdConfig

# TODO update the JSON string below
json = "{}"
# create an instance of SystemdConfig from a JSON string
systemd_config_instance = SystemdConfig.from_json(json)
# print the JSON string representation of the object
print(SystemdConfig.to_json())

# convert the object into a dict
systemd_config_dict = systemd_config_instance.to_dict()
# create an instance of SystemdConfig from a dict
systemd_config_from_dict = SystemdConfig.from_dict(systemd_config_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


