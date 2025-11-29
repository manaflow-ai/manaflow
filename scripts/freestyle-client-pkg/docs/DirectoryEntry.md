# DirectoryEntry

Directory

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** |  | 
**path** | **str** |  | 
**sha** | **str** | The hash / object ID of the directory. | 
**entries** | [**List[DirectoryEntryEntriesInner]**](DirectoryEntryEntriesInner.md) |  | 
**type** | **str** |  | 

## Example

```python
from freestyle_client.models.directory_entry import DirectoryEntry

# TODO update the JSON string below
json = "{}"
# create an instance of DirectoryEntry from a JSON string
directory_entry_instance = DirectoryEntry.from_json(json)
# print the JSON string representation of the object
print(DirectoryEntry.to_json())

# convert the object into a dict
directory_entry_dict = directory_entry_instance.to_dict()
# create an instance of DirectoryEntry from a dict
directory_entry_from_dict = DirectoryEntry.from_dict(directory_entry_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


