# ReadFileResponseContent


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**content** | **str** |  | 
**kind** | **str** |  | 
**files** | **List[str]** |  | 

## Example

```python
from freestyle_client.models.read_file_response_content import ReadFileResponseContent

# TODO update the JSON string below
json = "{}"
# create an instance of ReadFileResponseContent from a JSON string
read_file_response_content_instance = ReadFileResponseContent.from_json(json)
# print the JSON string representation of the object
print(ReadFileResponseContent.to_json())

# convert the object into a dict
read_file_response_content_dict = read_file_response_content_instance.to_dict()
# create an instance of ReadFileResponseContent from a dict
read_file_response_content_from_dict = ReadFileResponseContent.from_dict(read_file_response_content_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


