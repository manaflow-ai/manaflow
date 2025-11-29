# UpdateDevServerConfigRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**dev_command** | **str** |  | [optional] 
**install_command** | **str** |  | [optional] 
**timeout** | **int** |  | [optional] 
**env_vars** | **Dict[str, str]** |  | [optional] 
**ports** | [**List[PortConfig]**](PortConfig.md) |  | [optional] 
**preset** | [**DevServerPreset**](DevServerPreset.md) |  | [optional] [default to DevServerPreset.AUTO]
**systemd** | [**SystemdConfigInternal**](SystemdConfigInternal.md) |  | [optional] 
**users** | [**List[LinuxUserSpec]**](LinuxUserSpec.md) |  | [optional] 
**groups** | [**List[LinuxGroupSpec]**](LinuxGroupSpec.md) |  | [optional] 
**additional_files** | [**Dict[str, FreestyleFile]**](FreestyleFile.md) |  | [optional] 
**web_terminal** | **bool** |  | [optional] 
**web_vscode** | **bool** |  | [optional] 
**additional_repositories** | [**List[AdditionalRepository]**](AdditionalRepository.md) |  | [optional] 
**branch** | **str** |  | [optional] 

## Example

```python
from freestyle_client.models.update_dev_server_config_request import UpdateDevServerConfigRequest

# TODO update the JSON string below
json = "{}"
# create an instance of UpdateDevServerConfigRequest from a JSON string
update_dev_server_config_request_instance = UpdateDevServerConfigRequest.from_json(json)
# print the JSON string representation of the object
print(UpdateDevServerConfigRequest.to_json())

# convert the object into a dict
update_dev_server_config_request_dict = update_dev_server_config_request_instance.to_dict()
# create an instance of UpdateDevServerConfigRequest from a dict
update_dev_server_config_request_from_dict = UpdateDevServerConfigRequest.from_dict(update_dev_server_config_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


