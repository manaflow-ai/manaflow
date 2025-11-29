# FreestyleFile


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**content** | **str** | The content of the file | 
**encoding** | **str** | The encoding of the file. Either **utf-8** or **base64** | [optional] 

## Example

```python
from freestyle_client.models.freestyle_file import FreestyleFile

# TODO update the JSON string below
json = "{}"
# create an instance of FreestyleFile from a JSON string
freestyle_file_instance = FreestyleFile.from_json(json)
# print the JSON string representation of the object
print(FreestyleFile.to_json())

# convert the object into a dict
freestyle_file_dict = freestyle_file_instance.to_dict()
# create an instance of FreestyleFile from a dict
freestyle_file_from_dict = FreestyleFile.from_dict(freestyle_file_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


