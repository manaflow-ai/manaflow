# DiffFile

A file that was changed in the comparison

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**sha** | **str** | The blob SHA of the file | [optional] 
**filename** | **str** | The file path | 
**status** | [**DiffFileStatus**](DiffFileStatus.md) | The status of the file (added, removed, modified, renamed, copied, changed, unchanged) | 
**additions** | **int** | Number of lines added | 
**deletions** | **int** | Number of lines deleted | 
**changes** | **int** | Total number of changes (additions + deletions) | 
**previous_filename** | **str** | Previous filename (for renamed/copied files) | [optional] 

## Example

```python
from freestyle_client.models.diff_file import DiffFile

# TODO update the JSON string below
json = "{}"
# create an instance of DiffFile from a JSON string
diff_file_instance = DiffFile.from_json(json)
# print the JSON string representation of the object
print(DiffFile.to_json())

# convert the object into a dict
diff_file_dict = diff_file_instance.to_dict()
# create an instance of DiffFile from a dict
diff_file_from_dict = DiffFile.from_dict(diff_file_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


