# SystemdUnitSpecPatch


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** | Unique slug; becomes unit name \&quot;&lt;name&gt;.service\&quot;. | 
**mode** | [**SystemdUnitMode**](SystemdUnitMode.md) | \&quot;oneshot\&quot; (run and exit) or \&quot;service\&quot; (long-running/healing). | [optional] 
**var_exec** | **List[str]** | Executable to run (can specify multiple commands that run sequentially). | [optional] 
**env** | **Dict[str, str]** | Environment variables. | [optional] 
**user** | **str** | Linux user to run the service as. | [optional] 
**group** | **str** | Linux group to run the service in. | [optional] 
**workdir** | **str** | Working directory. | [optional] 
**after** | **List[str]** | Establishes an ordering dependency. The current unit will start only after the units listed in After&#x3D; have started. This is useful for ensuring that certain services are up and running before the current service begins its operation. | [optional] 
**requires** | **List[str]** | Establishes a strong dependency. If the required unit fails to start or stops unexpectedly, the current unit will also be stopped. This ensures that a service critical to the functioning of the current unit is running and stable. Units listed in Requires&#x3D; are activated along with the current unit. If the required unit is not active, systemd will attempt to start it. This directive signifies a tight coupling between services, where the current service cannot function without the required service. | [optional] 
**on_failure** | **List[str]** | Units to activate when this unit enters a failed state. This is useful for triggering recovery actions, notifications, or cleanup services when the current service fails. | [optional] 
**wanted_by** | **List[str]** | Target used when enabling (default: multi-user.target). | [optional] 
**enable** | **bool** | Whether to enable this service (calls &#x60;systemctl enable &lt;service&gt;&#x60;). When enabled, the service will start automatically at boot. | [optional] 
**timeout_sec** | **int** | Overall start/stop timeout. | [optional] 
**delete_after_success** | **bool** | For oneshot: remove unit on success. | [optional] 
**ready_signal** | **bool** | Use sd_notify; maps to Type&#x3D;notify. | [optional] 
**watchdog_sec** | **int** | Enable systemd watchdog (seconds). | [optional] 
**restart_policy** | [**SystemdRestartPolicy**](SystemdRestartPolicy.md) | Restart semantics (service mode). | [optional] 

## Example

```python
from freestyle_client.models.systemd_unit_spec_patch import SystemdUnitSpecPatch

# TODO update the JSON string below
json = "{}"
# create an instance of SystemdUnitSpecPatch from a JSON string
systemd_unit_spec_patch_instance = SystemdUnitSpecPatch.from_json(json)
# print the JSON string representation of the object
print(SystemdUnitSpecPatch.to_json())

# convert the object into a dict
systemd_unit_spec_patch_dict = systemd_unit_spec_patch_instance.to_dict()
# create an instance of SystemdUnitSpecPatch from a dict
systemd_unit_spec_patch_from_dict = SystemdUnitSpecPatch.from_dict(systemd_unit_spec_patch_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


