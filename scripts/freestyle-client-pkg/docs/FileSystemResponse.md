# FileSystemResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**content** | **str** |  | 
**files** | [**List[FileInfo]**](FileInfo.md) |  | 

## Example

```python
from freestyle_client.models.file_system_response import FileSystemResponse

# TODO update the JSON string below
json = "{}"
# create an instance of FileSystemResponse from a JSON string
file_system_response_instance = FileSystemResponse.from_json(json)
# print the JSON string representation of the object
print(FileSystemResponse.to_json())

# convert the object into a dict
file_system_response_dict = file_system_response_instance.to_dict()
# create an instance of FileSystemResponse from a dict
file_system_response_from_dict = FileSystemResponse.from_dict(file_system_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


