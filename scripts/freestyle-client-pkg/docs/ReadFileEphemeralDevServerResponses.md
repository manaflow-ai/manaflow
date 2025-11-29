# ReadFileEphemeralDevServerResponses


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**content** | [**ReadFileResponseContent**](ReadFileResponseContent.md) |  | 
**exists** | **bool** |  | 
**path** | **str** |  | 

## Example

```python
from freestyle_client.models.read_file_ephemeral_dev_server_responses import ReadFileEphemeralDevServerResponses

# TODO update the JSON string below
json = "{}"
# create an instance of ReadFileEphemeralDevServerResponses from a JSON string
read_file_ephemeral_dev_server_responses_instance = ReadFileEphemeralDevServerResponses.from_json(json)
# print the JSON string representation of the object
print(ReadFileEphemeralDevServerResponses.to_json())

# convert the object into a dict
read_file_ephemeral_dev_server_responses_dict = read_file_ephemeral_dev_server_responses_instance.to_dict()
# create an instance of ReadFileEphemeralDevServerResponses from a dict
read_file_ephemeral_dev_server_responses_from_dict = ReadFileEphemeralDevServerResponses.from_dict(read_file_ephemeral_dev_server_responses_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


