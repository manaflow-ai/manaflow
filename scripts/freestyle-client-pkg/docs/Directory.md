# Directory


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** |  | 
**path** | **str** |  | 
**sha** | **str** | The hash / object ID of the directory. | 
**entries** | [**List[GitContentsDirEntryItem]**](GitContentsDirEntryItem.md) |  | 
**type** | **str** |  | 

## Example

```python
from freestyle_client.models.directory import Directory

# TODO update the JSON string below
json = "{}"
# create an instance of Directory from a JSON string
directory_instance = Directory.from_json(json)
# print the JSON string representation of the object
print(Directory.to_json())

# convert the object into a dict
directory_dict = directory_instance.to_dict()
# create an instance of Directory from a dict
directory_from_dict = Directory.from_dict(directory_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


