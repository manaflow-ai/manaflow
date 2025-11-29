# Files


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**files** | **Dict[str, str]** | A map of file names to their contents. | 
**commit_message** | **str** |  | 
**author_name** | **str** |  | [optional] 
**author_email** | **str** |  | [optional] 
**type** | **str** |  | 

## Example

```python
from freestyle_client.models.files import Files

# TODO update the JSON string below
json = "{}"
# create an instance of Files from a JSON string
files_instance = Files.from_json(json)
# print the JSON string representation of the object
print(Files.to_json())

# convert the object into a dict
files_dict = files_instance.to_dict()
# create an instance of Files from a dict
files_from_dict = Files.from_dict(files_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


