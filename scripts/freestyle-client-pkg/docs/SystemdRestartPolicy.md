# SystemdRestartPolicy


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**policy** | [**SystemdRestartPolicyKind**](SystemdRestartPolicyKind.md) | \&quot;no\&quot; | \&quot;on-failure\&quot; | \&quot;always\&quot; | \&quot;on-abnormal\&quot; | 
**restart_sec** | **int** |  | [optional] 
**start_limit_burst** | **int** |  | [optional] 
**start_limit_interval_sec** | **int** |  | [optional] 

## Example

```python
from freestyle_client.models.systemd_restart_policy import SystemdRestartPolicy

# TODO update the JSON string below
json = "{}"
# create an instance of SystemdRestartPolicy from a JSON string
systemd_restart_policy_instance = SystemdRestartPolicy.from_json(json)
# print the JSON string representation of the object
print(SystemdRestartPolicy.to_json())

# convert the object into a dict
systemd_restart_policy_dict = systemd_restart_policy_instance.to_dict()
# create an instance of SystemdRestartPolicy from a dict
systemd_restart_policy_from_dict = SystemdRestartPolicy.from_dict(systemd_restart_policy_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


