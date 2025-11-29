# DevServerWatchFilesRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**dev_server** | [**DevServerIdentifier**](DevServerIdentifier.md) |  | 

## Example

```python
from freestyle_client.models.dev_server_watch_files_request import DevServerWatchFilesRequest

# TODO update the JSON string below
json = "{}"
# create an instance of DevServerWatchFilesRequest from a JSON string
dev_server_watch_files_request_instance = DevServerWatchFilesRequest.from_json(json)
# print the JSON string representation of the object
print(DevServerWatchFilesRequest.to_json())

# convert the object into a dict
dev_server_watch_files_request_dict = dev_server_watch_files_request_instance.to_dict()
# create an instance of DevServerWatchFilesRequest from a dict
dev_server_watch_files_request_from_dict = DevServerWatchFilesRequest.from_dict(dev_server_watch_files_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


