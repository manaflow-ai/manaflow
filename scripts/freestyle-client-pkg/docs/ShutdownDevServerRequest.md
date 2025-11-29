# ShutdownDevServerRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**dev_server** | [**DevServerIdentifier**](DevServerIdentifier.md) |  | 

## Example

```python
from freestyle_client.models.shutdown_dev_server_request import ShutdownDevServerRequest

# TODO update the JSON string below
json = "{}"
# create an instance of ShutdownDevServerRequest from a JSON string
shutdown_dev_server_request_instance = ShutdownDevServerRequest.from_json(json)
# print the JSON string representation of the object
print(ShutdownDevServerRequest.to_json())

# convert the object into a dict
shutdown_dev_server_request_dict = shutdown_dev_server_request_instance.to_dict()
# create an instance of ShutdownDevServerRequest from a dict
shutdown_dev_server_request_from_dict = ShutdownDevServerRequest.from_dict(shutdown_dev_server_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


