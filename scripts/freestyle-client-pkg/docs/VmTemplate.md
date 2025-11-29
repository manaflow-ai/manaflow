# VmTemplate


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**snapshot_id** | **str** | Optional snapshot ID to create a VM from. If provided, the new VM will be created from the specified snapshot. Cannot be used together with fork_vm_id or docker_image. | [optional] 
**rootfs_size_mb** | **int** | Size of the ext4 rootfs in MB. Defaults to 16000MB if not provided. | [optional] [default to 16000]
**workdir** | **str** | Optional working directory for the VM. If not provided, the default to &#39;/&#39; | [optional] 
**idle_timeout_seconds** | **int** | Idle timeout in seconds. If set, the VM will be automatically suspended after this many seconds of no network activity. Defaults to 300 seconds (5 minutes) if not provided or the last used timeout for the forked VM. | [optional] 
**wait_for_ready_signal** | **bool** |  | [optional] 
**ready_signal_timeout_seconds** | **int** |  | [optional] 
**persistence** | [**VmPersistence**](VmPersistence.md) | Persistence strategy for the VM. If not provided, defaults to &#39;sticky&#39; with priority 5. | [optional] 
**ports** | [**List[VmTemplatePortsInner]**](VmTemplatePortsInner.md) | Optional list of ports to expose externally. If not provided, port 3000 will be exposed on port 443 by default. Pass an empty array to disable external ports. Only ports 8081 and 443 can be configured externally for now. Any target port is allowed. | [optional] 
**systemd** | [**SystemdConfig**](SystemdConfig.md) |  | [optional] 
**users** | [**List[LinuxUserSpec]**](LinuxUserSpec.md) | Linux users to create on VM startup | [optional] 
**groups** | [**List[LinuxGroupSpec]**](LinuxGroupSpec.md) | Linux groups to create on VM startup | [optional] 
**additional_files** | [**Dict[str, FreestyleFile]**](FreestyleFile.md) |  | [optional] 
**git_repos** | [**List[GitRepositorySpec]**](GitRepositorySpec.md) |  | [optional] 
**discriminator** | **str** | Optional discriminator to differentiate snapshots with otherwise identical configurations | [optional] 

## Example

```python
from freestyle_client.models.vm_template import VmTemplate

# TODO update the JSON string below
json = "{}"
# create an instance of VmTemplate from a JSON string
vm_template_instance = VmTemplate.from_json(json)
# print the JSON string representation of the object
print(VmTemplate.to_json())

# convert the object into a dict
vm_template_dict = vm_template_instance.to_dict()
# create an instance of VmTemplate from a dict
vm_template_from_dict = VmTemplate.from_dict(vm_template_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


