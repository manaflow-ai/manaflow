# HandleDevServerStatus200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**installing** | **bool** |  | 
**dev_running** | **bool** |  | 

## Example

```python
from freestyle_client.models.handle_dev_server_status200_response import HandleDevServerStatus200Response

# TODO update the JSON string below
json = "{}"
# create an instance of HandleDevServerStatus200Response from a JSON string
handle_dev_server_status200_response_instance = HandleDevServerStatus200Response.from_json(json)
# print the JSON string representation of the object
print(HandleDevServerStatus200Response.to_json())

# convert the object into a dict
handle_dev_server_status200_response_dict = handle_dev_server_status200_response_instance.to_dict()
# create an instance of HandleDevServerStatus200Response from a dict
handle_dev_server_status200_response_from_dict = HandleDevServerStatus200Response.from_dict(handle_dev_server_status200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


