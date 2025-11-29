# DevServerLogsRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**dev_server** | [**DevServerIdentifier**](DevServerIdentifier.md) |  | 
**lines** | **int** |  | [optional] 

## Example

```python
from freestyle_client.models.dev_server_logs_request import DevServerLogsRequest

# TODO update the JSON string below
json = "{}"
# create an instance of DevServerLogsRequest from a JSON string
dev_server_logs_request_instance = DevServerLogsRequest.from_json(json)
# print the JSON string representation of the object
print(DevServerLogsRequest.to_json())

# convert the object into a dict
dev_server_logs_request_dict = dev_server_logs_request_instance.to_dict()
# create an instance of DevServerLogsRequest from a dict
dev_server_logs_request_from_dict = DevServerLogsRequest.from_dict(dev_server_logs_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


