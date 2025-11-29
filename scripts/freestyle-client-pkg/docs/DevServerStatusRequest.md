# DevServerStatusRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**dev_server** | [**DevServerIdentifier**](DevServerIdentifier.md) |  | 

## Example

```python
from freestyle_client.models.dev_server_status_request import DevServerStatusRequest

# TODO update the JSON string below
json = "{}"
# create an instance of DevServerStatusRequest from a JSON string
dev_server_status_request_instance = DevServerStatusRequest.from_json(json)
# print the JSON string representation of the object
print(DevServerStatusRequest.to_json())

# convert the object into a dict
dev_server_status_request_dict = dev_server_status_request_instance.to_dict()
# create an instance of DevServerStatusRequest from a dict
dev_server_status_request_from_dict = DevServerStatusRequest.from_dict(dev_server_status_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


