# FileEntry


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** |  | 
**path** | **str** |  | 
**sha** | **str** | The hash / object ID of the file. | 
**size** | **int** |  | 
**type** | **str** |  | 

## Example

```python
from freestyle_client.models.file_entry import FileEntry

# TODO update the JSON string below
json = "{}"
# create an instance of FileEntry from a JSON string
file_entry_instance = FileEntry.from_json(json)
# print the JSON string representation of the object
print(FileEntry.to_json())

# convert the object into a dict
file_entry_dict = file_entry_instance.to_dict()
# create an instance of FileEntry from a dict
file_entry_from_dict = FileEntry.from_dict(file_entry_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


