# HandleEphemeralDevServer200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**url** | **str** |  | 
**is_new** | **bool** |  | 
**dev_command_running** | **bool** |  | 
**install_command_running** | **bool** |  | 
**mcp_ephemeral_url** | **str** |  | [optional] 
**ephemeral_url** | **str** |  | [optional] 
**vm_id** | **str** |  | [optional] 
**base_id** | **str** |  | [optional] 

## Example

```python
from freestyle_client.models.handle_ephemeral_dev_server200_response import HandleEphemeralDevServer200Response

# TODO update the JSON string below
json = "{}"
# create an instance of HandleEphemeralDevServer200Response from a JSON string
handle_ephemeral_dev_server200_response_instance = HandleEphemeralDevServer200Response.from_json(json)
# print the JSON string representation of the object
print(HandleEphemeralDevServer200Response.to_json())

# convert the object into a dict
handle_ephemeral_dev_server200_response_dict = handle_ephemeral_dev_server200_response_instance.to_dict()
# create an instance of HandleEphemeralDevServer200Response from a dict
handle_ephemeral_dev_server200_response_from_dict = HandleEphemeralDevServer200Response.from_dict(handle_ephemeral_dev_server200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


