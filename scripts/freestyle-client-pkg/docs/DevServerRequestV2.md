# DevServerRequestV2


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
**repo_id** | **str** |  | [optional] 
**git_ref** | **str** |  | [optional] 
**force_new** | **bool** | By default dev servers will find a matching session, with forceNew is true it will always create a new one | [optional] 

## Example

```python
from freestyle_client.models.dev_server_request_v2 import DevServerRequestV2

# TODO update the JSON string below
json = "{}"
# create an instance of DevServerRequestV2 from a JSON string
dev_server_request_v2_instance = DevServerRequestV2.from_json(json)
# print the JSON string representation of the object
print(DevServerRequestV2.to_json())

# convert the object into a dict
dev_server_request_v2_dict = dev_server_request_v2_instance.to_dict()
# create an instance of DevServerRequestV2 from a dict
dev_server_request_v2_from_dict = DevServerRequestV2.from_dict(dev_server_request_v2_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


