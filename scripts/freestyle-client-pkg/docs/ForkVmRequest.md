# ForkVmRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**idle_timeout_seconds** | **int** |  | [optional] 
**ports** | [**List[PortMapping]**](PortMapping.md) | Optional list of ports to expose externally. If not provided, port 3000 will be exposed on port 443 by default. Pass an empty array to disable external ports. Only ports 8081 and 443 can be configured externally for now. Any target port is allowed. | [optional] 
**ready_signal_timeout_seconds** | **int** | Whether the api request should wait for the VM to be ready before returning. By default, the VM is considered ready when the serial console is ready for login. | [optional] [default to true]
**wait_for_ready_signal** | **bool** | How long to wait for the ready signal before timing out. Defaults to 120 seconds if not provided. | [optional] 
**workdir** | **str** | Optional working directory for the VM. File system and shell commands will be executed in this directory. | [optional] 
**persistence** | [**VmPersistence**](VmPersistence.md) | Persistence strategy for the VM. If not provided, defaults to &#39;sticky&#39; with priority 5. | [optional] 

## Example

```python
from freestyle_client.models.fork_vm_request import ForkVmRequest

# TODO update the JSON string below
json = "{}"
# create an instance of ForkVmRequest from a JSON string
fork_vm_request_instance = ForkVmRequest.from_json(json)
# print the JSON string representation of the object
print(ForkVmRequest.to_json())

# convert the object into a dict
fork_vm_request_dict = fork_vm_request_instance.to_dict()
# create an instance of ForkVmRequest from a dict
fork_vm_request_from_dict = ForkVmRequest.from_dict(fork_vm_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


